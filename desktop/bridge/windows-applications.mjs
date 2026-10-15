import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runPowerShell } from './platform.mjs';

const userPowerShell = (script, value) => runPowerShell(script, value, os.userInfo().homedir);

// Names travel over stdin as JSON; no user input is inserted into PowerShell source.
export function launchWindowsApplication(app, run = userPowerShell) {
  run(`$name = [Console]::In.ReadToEnd() | ConvertFrom-Json;
    $apps = @(Get-StartApps | Where-Object { $_.Name -ieq $name });
    if ($apps.Count -gt 1) { throw 'Several installed applications use this name. Use its exact registered executable name.' }
    if ($apps.Count -eq 1) {
      Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('shell:AppsFolder\\' + $apps[0].AppID);
      exit;
    }
    $exe = $name; if (-not $exe.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { $exe += '.exe' }
    foreach ($base in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {
      $key = Get-Item -LiteralPath (Join-Path $base $exe) -ErrorAction SilentlyContinue;
      if ($key) {
        $target = ([string]$key.GetValue('')).Trim('"');
        if ([IO.Path]::IsPathRooted($target) -and [IO.Path]::GetExtension($target) -ieq '.exe' -and [IO.File]::Exists($target)) {
          Start-Process -FilePath $target -WorkingDirectory ([IO.Path]::GetDirectoryName($target)); exit;
        }
      }
    }
    $systemApp = Join-Path (Join-Path $env:SystemRoot 'System32') $exe;
    if ([IO.File]::Exists($systemApp)) { Start-Process -FilePath $systemApp; exit }
    throw 'Application not found. Use its exact Start menu name or registered executable name.';`, app);
}

export function windowsObsidianExecutable(run = userPowerShell) {
  const result = JSON.parse(run(`$folders = [Collections.Generic.List[string]]::new();
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'")) {
      if ($process.ExecutablePath) { $folders.Add([IO.Path]::GetDirectoryName($process.ExecutablePath)) }
    }
    foreach ($base in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
      foreach ($entry in @(Get-ItemProperty -Path ($base + '\\*') -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Obsidian' })) {
        if ($entry.InstallLocation) { $folders.Add($entry.InstallLocation) }
        if ($entry.DisplayIcon -match '^"?(.+\\\\Obsidian\\.exe)"?(?:,\\d+)?$') { $folders.Add([IO.Path]::GetDirectoryName($matches[1])) }
      }
    }
    $folders.Add((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\\Obsidian'));
    $folders.Add((Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Obsidian'));
    foreach ($folder in $folders) {
      $cli = Join-Path $folder 'Obsidian.com';
      if ([IO.Path]::IsPathRooted($cli) -and [IO.File]::Exists($cli) -and [IO.File]::Exists((Join-Path $folder 'Obsidian.exe'))) {
        $cli | ConvertTo-Json -Compress; exit;
      }
    }
    'null';`, null));
  if (typeof result !== 'string' || !path.isAbsolute(result) || !fs.statSync(result).isFile())
    throw new Error('Obsidian CLI unavailable. Install Obsidian with the Windows 1.12.7+ installer, open the target vault and enable Command line interface in Settings.');
  return result;
}
