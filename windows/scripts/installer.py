#!/usr/bin/env python3
"""Create one Windows Setup EXE from the existing package.py output."""
import argparse
from pathlib import Path
import shutil
import subprocess
import urllib.request
from package import PROJECT, VERSION, compiler, digest

INNO_VERSION = '6.7.3'
INNO_SHA256 = '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732'
INNO_URL = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe'


def prepare_compiler():
    downloads = PROJECT / 'build/downloads'
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / ('innosetup-' + INNO_VERSION + '.exe')
    if not archive.exists() or digest(archive) != INNO_SHA256:
        partial = archive.with_suffix('.partial')
        try:
            with urllib.request.urlopen(INNO_URL, timeout=60) as response, partial.open('wb') as output:
                shutil.copyfileobj(response, output)
            if digest(partial) != INNO_SHA256:
                raise ValueError('Inno Setup SHA-256 mismatch.')
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    destination = PROJECT / ('build/inno-' + INNO_VERSION)
    # Official portable mode: no system install, associations, or uninstall entry.
    subprocess.run([str(archive), '/PORTABLE=1', '/CURRENTUSER', '/VERYSILENT',
                    '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/TASKS=',
                    '/DIR=' + str(destination)], check=True)
    return destination / 'ISCC.exe'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-build', action='store_true', help='Build an isolated installer for installation tests.')
    args = parser.parse_args()
    app = PROJECT / 'dist/gpt-bridge'
    for relative in ('gpt-bridge.exe', 'resources/build-manifest.json', 'resources/runtime/bin/node.exe'):
        if not (app / relative).is_file():
            raise SystemExit('Run python windows/scripts/package.py first; missing ' + relative)
    shutil.copy2(PROJECT / 'README.md', app / '使用说明.md')
    build = PROJECT / ('build/installer-test' if args.test_build else 'build/installer')
    build.mkdir(parents=True, exist_ok=True)
    guard = build / 'installer-guard.exe'
    command = [str(compiler()), '/nologo', '/optimize+', '/target:exe', '/platform:x64',
               '/out:' + str(guard), str(PROJECT / 'Installer/Guard.cs')]
    if args.test_build:
        command.append('/define:INSTALLER_TEST')
    subprocess.run(command, check=True)
    output = build if args.test_build else PROJECT / 'dist'
    command = [str(prepare_compiler()), '/Qp', '/DAppSource=' + str(app),
               '/DBuildSource=' + str(build), '/DOutputDirectory=' + str(output),
               '/DAppVersion=' + VERSION]
    if args.test_build:
        command.append('/DInstallerTest=1')
    command.append(str(PROJECT / 'Installer/setup.iss'))
    subprocess.run(command, check=True)
    name = 'gpt-bridge-installer-test' if args.test_build else 'gpt-bridge-' + VERSION + '-windows-x64-setup'
    setup = output / (name + '.exe')
    setup.with_suffix('.exe.sha256').write_text(digest(setup) + '  ' + setup.name + '\n', encoding='utf-8')
    print(setup, flush=True)


if __name__ == '__main__':
    main()
