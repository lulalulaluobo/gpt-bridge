#!/usr/bin/env python3
"""Exercise install, upgrade, running-app protection, and uninstall in an isolated directory."""
import ctypes
import subprocess
import sys
import time
from package import PROJECT, digest


def remove_empty_after_uninstall(target):
    # Inno's final self-deletion can finish just after the launcher exits.
    for attempt in range(100):
        try:
            target.rmdir()
            return
        except FileNotFoundError:
            return
        except OSError as error:
            if error.winerror != 145 or attempt == 99:
                raise
            time.sleep(0.1)


def main():
    build = PROJECT / 'build/installer-test'
    target = build / 'installed 中文'
    if target.exists():
        raise SystemExit('Test destination already exists; inspect it before running again: ' + str(target))
    subprocess.run([sys.executable, str(PROJECT / 'scripts/installer.py'), '--test-build'], check=True)
    setup = build / 'gpt-bridge-installer-test.exe'
    guard = build / 'installer-guard.exe'
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]

    def run(exe, name, *extra):
        return subprocess.run([str(exe), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
                               '/LOG=' + str(build / (name + '.log')), *extra], timeout=180).returncode

    assert subprocess.run([str(guard)]).returncode == 0
    held = kernel.CreateMutexW(None, False, 'Local\\gpt-bridge.installer-test')
    assert held
    try:
        assert subprocess.run([str(guard)]).returncode == 1
        assert run(setup, 'blocked-install', '/DIR=' + str(target)) != 0
        assert not (target / 'gpt-bridge.exe').exists()
    finally:
        kernel.CloseHandle(held)
    assert run(setup, 'install', '/DIR=' + str(target)) == 0
    source = PROJECT / 'dist/gpt-bridge'
    files = [file for file in source.rglob('*') if file.is_file()]
    for file in files:
        assert digest(file) == digest(target / file.relative_to(source)), str(file)
    sentinel = target / 'user-created-file.txt'
    sentinel.write_text('Preserve files that the installer does not own.', encoding='utf-8')
    assert run(setup, 'upgrade', '/DIR=' + str(target)) == 0
    assert sentinel.exists()
    uninstaller = target / 'unins000.exe'
    held = kernel.CreateMutexW(None, False, 'Local\\gpt-bridge.installer-test')
    assert held
    try:
        assert run(uninstaller, 'blocked-uninstall') != 0
        assert (target / 'gpt-bridge.exe').exists()
    finally:
        kernel.CloseHandle(held)
    assert run(uninstaller, 'uninstall') == 0
    assert not (target / 'gpt-bridge.exe').exists()
    assert not (target / 'resources/runtime/bin/node.exe').exists()
    assert sentinel.exists()
    # Only remove the known fixture file, never recursively delete an install path.
    sentinel.unlink()
    remove_empty_after_uninstall(target)
    print('Passed: install, upgrade, uninstall, running-app guards, preserved user file; '
          + str(len(files)) + ' installed file hashes verified.', flush=True)


if __name__ == '__main__':
    main()
