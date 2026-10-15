import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const windows = process.platform === 'win32';
export const binaryName = name => windows ? `${name}.exe` : name;
export const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
export const diskRoot = value => samePath(value, path.parse(value).root);
export const powershell = windows ? path.join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe') : null;

export function systemEnv(home = os.homedir()) {
  if (!windows) return { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return { HOME: home, USERPROFILE: home, SystemRoot: systemRoot, WINDIR: systemRoot,
    SystemDrive: path.parse(systemRoot).root.slice(0, 2), ComSpec: path.join(systemRoot, 'System32/cmd.exe'),
    PATH: [path.join(systemRoot, 'System32'), systemRoot, path.dirname(powershell)].join(path.delimiter),
    TEMP: os.tmpdir(), TMP: os.tmpdir(), APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'), LANG: 'en_US.UTF-8' };
}

// Paths and process identities travel over stdin, never through PowerShell source interpolation.
export function runPowerShell(script, value, home = os.homedir()) {
  return execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); " +
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + script],
  { input: JSON.stringify(value), encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: { ...systemEnv(home), PSModulePath: path.join(path.dirname(powershell), 'Modules') },
    maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('应用数据目录的类型异常。');
  if (windows) {
    runPowerShell(`$p = [Console]::In.ReadToEnd() | ConvertFrom-Json;
      $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl = [Security.AccessControl.DirectorySecurity]::new();
      $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false);
      foreach ($id in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id, 'FullControl',
          'ContainerInherit,ObjectInherit', 'None', 'Allow'));
      }
      [IO.Directory]::SetAccessControl($p, $acl);`, directory);
  } else {
    if (info.uid !== process.getuid()) throw new Error('应用数据目录的属主异常。');
    fs.chmodSync(directory, 0o700);
  }
}

export function assertPrivateFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('应用私有文件的类型异常。');
  if (!windows) {
    if (info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error('应用私有文件必须仅属主可读写（0600）。');
    return;
  }
  runPowerShell(`$p = [Console]::In.ReadToEnd() | ConvertFrom-Json;
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    $acl = [IO.File]::GetAccessControl($p);
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Invalid owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid, 'S-1-5-18')) {
        throw 'Application state is accessible to another account'
      }
    }`, file);
}

export function snapshot() {
  const rows = new Map();
  if (windows) {
    const data = JSON.parse(runPowerShell(`@(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object {
      [pscustomobject]@{ pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId;
        started=$_.CreationDate.ToUniversalTime().ToString('o'); executable=$_.ExecutablePath;
        name=$_.Name; commandLine=$_.CommandLine }
    }) | ConvertTo-Json -Compress`, null));
    for (const row of data) rows.set(row.pid, row);
  } else {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,comm='], { encoding: 'utf8' });
    for (const line of output.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/);
      if (m) rows.set(+m[1], { pid: +m[1], parent: +m[2], started: m[3], executable: m[4] });
    }
  }
  return rows;
}

export function terminateTracked(tracked) {
  if (!windows || !tracked.length) return;
  runPowerShell(`$tracked = [Console]::In.ReadToEnd() | ConvertFrom-Json;
    foreach ($identity in $tracked) {
      $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$identity.pid);
      if ($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq $identity.started -and
          $p.ExecutablePath -eq $identity.executable) { Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue }
    }`, [...tracked].reverse());
}
