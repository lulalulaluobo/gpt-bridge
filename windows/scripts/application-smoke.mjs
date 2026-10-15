// Real Windows App Paths resolution and GUI-free executable launch, using a temporary registration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { launchApplication } from '../../desktop/bridge/application-launch.mjs';
import { windowsObsidianExecutable } from '../../desktop/bridge/windows-applications.mjs';
import { windows, runPowerShell } from '../../desktop/bridge/platform.mjs';

assert(windows);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bridge launch's 中文 ")));
const name = `BridgeLaunchProbe-${randomUUID()}.exe`;
const executable = path.join(root, name), marker = path.join(root, 'launched.txt');
const key = `Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`;
const source = path.join(root, 'Probe.cs');
fs.writeFileSync(source, `using System; using System.IO; public class Probe {
  [STAThread] public static void Main(string[] args) {
    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launched.txt"), "launched:" + args.Length);
  }
}`);
try {
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:winexe', '/out:' + executable, source]);
  runPowerShell(`$value = [Console]::In.ReadToEnd() | ConvertFrom-Json;
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($value.key);
    try { $key.SetValue('', $value.executable) } finally { $key.Dispose() }`, { key, executable });
  await assert.rejects(launchApplication({ app: name }, false), /disabled/);
  assert(!fs.existsSync(marker));
  assert.equal((await launchApplication({ app: name }, true)).status, 'launch_requested');
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'launched:0');
  await assert.rejects(launchApplication({ app: 'Missing-' + randomUUID() }, true), /Application not found/);
  assert.equal(windowsObsidianExecutable(() => JSON.stringify(executable)), executable);
  assert.throws(() => windowsObsidianExecutable(() => 'null'), /Obsidian CLI unavailable/);
  const realHome = os.userInfo().homedir;
  const previousHome = process.env.HOME, previousProfile = process.env.USERPROFILE;
  try {
    process.env.HOME = process.env.USERPROFILE = path.join(root, 'isolated-home');
    const localData = JSON.parse(runPowerShell("[Environment]::GetFolderPath('LocalApplicationData') | ConvertTo-Json -Compress", null, realHome));
    assert.equal(localData.toLowerCase(), path.join(realHome, 'AppData/Local').toLowerCase());
    fs.unlinkSync(marker);
    await launchApplication({ app: name }, true);
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'launched:0');
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
  }
  console.log('PASS: Windows registered app launch, command gate, Unicode/spaces, zero arguments, missing app and CLI discovery errors.');
} finally {
  runPowerShell(`$key = [Console]::In.ReadToEnd() | ConvertFrom-Json;
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($key, $false);`, key);
  assert(path.basename(root).startsWith('bridge launch'));
  fs.rmSync(root, { recursive: true, force: true });
}
