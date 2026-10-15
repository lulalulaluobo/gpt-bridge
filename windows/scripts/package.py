#!/usr/bin/env python3
"""Build the Windows x64 tray app and a checksum-verified, self-contained runtime ZIP."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
DESKTOP = PROJECT.parent / 'desktop'
VERSION = '0.11'
INPUTS = (
    ('node-v24.9.0-win-x64.zip', 'https://nodejs.org/dist/v24.9.0/node-v24.9.0-win-x64.zip',
     '6873514c3e6a012917cc6f95ce48a6289253370d025f1b69db290d70feebfa6e'),
    ('tunnel-client-v0.0.16-windows-amd64.zip',
     'https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-windows-amd64.zip',
     'edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6'),
)


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def clear_generated(directory):
    resolved = directory.resolve()
    allowed = [PROJECT / 'build', PROJECT / 'dist']
    if not any(root.resolve() in resolved.parents for root in allowed):
        raise ValueError('Refusing to remove a directory outside the generated build/dist children.')
    if directory.exists():
        shutil.rmtree(directory)


def compiler():
    return Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'


def compile_app(destination, tests=False, entry=None):
    sources = sorted((PROJECT / 'Sources').glob('*.cs'))
    target = destination / ('tunnel-client.exe' if entry else 'WindowsTests.exe' if tests else 'gpt-bridge.exe')
    if tests or entry:
        sources += sorted((PROJECT / 'Tests').glob('*.cs'))
    refs = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
            'System.Security.dll', 'System.Web.Extensions.dll']
    command = [str(compiler()), '/nologo', '/utf8output', '/optimize+', '/platform:x64',
               '/target:' + ('exe' if tests or entry else 'winexe'), '/out:' + str(target),
               '/main:GptBridge.' + (entry or ('WindowsTests' if tests else 'Program'))]
    if not tests and not entry:
        command += ['/win32manifest:' + str(PROJECT / 'Resources/app.manifest')]
    command += ['/reference:' + ref for ref in refs] + [str(source) for source in sources]
    subprocess.run(command, check=True)
    shutil.copy2(PROJECT / 'Resources/app.config', str(target) + '.config')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-only', action='store_true', help='Compile UI only, without downloading the runtime.')
    parser.add_argument('--test', action='store_true', help='Compile and run isolated Windows integration tests.')
    parser.add_argument('--test-resources', type=Path, help='Also test method library queries with this packaged resources directory.')
    parser.add_argument('--check', action='store_true', help='Only verify the cached official runtime archives.')
    args = parser.parse_args()
    if os.name != 'nt':
        raise SystemExit('Build this edition on 64-bit Windows with .NET Framework 4.8 and Python 3.11+.')
    build = PROJECT / 'build'
    build.mkdir(exist_ok=True)
    if args.test:
        target = compile_app(build, tests=True)
        fake = build / 'fake-runtime'
        fake.mkdir(exist_ok=True)
        compile_app(fake, entry='FakeTunnel')
        subprocess.run([str(target)] + (['--resources', str(args.test_resources.resolve())] if args.test_resources else []), check=True)
        return
    app = PROJECT / 'dist/gpt-bridge'
    app.mkdir(parents=True, exist_ok=True)
    if args.app_only:
        print(compile_app(app))
        return
    downloads = build / 'downloads'
    downloads.mkdir(exist_ok=True)
    spec = importlib.util.spec_from_file_location('verified_archives', DESKTOP / 'scripts/bootstrap-runtime.py')
    archive_tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(archive_tools)
    for name, url, checksum in INPUTS:
        archive = downloads / name
        if not archive.is_file() or digest(archive) != checksum:
            if args.check:
                raise SystemExit('Missing or invalid cached archive: ' + name)
            partial = archive.with_suffix('.partial')
            print('Downloading ' + name, flush=True)
            try:
                with urllib.request.urlopen(url, timeout=60) as response, partial.open('wb') as stream:
                    shutil.copyfileobj(response, stream)
                if digest(partial) != checksum:
                    raise ValueError('Official archive SHA-256 mismatch: ' + name)
                partial.replace(archive)
            finally:
                partial.unlink(missing_ok=True)
        print('Verified ' + name, flush=True)
    if args.check:
        return
    inputs = build / 'runtime-input'
    clear_generated(inputs)
    inputs.mkdir()
    for name, _, _ in INPUTS:
        archive_tools.unpack_zip(downloads / name, inputs)
    node_input = inputs / 'node-v24.9.0-win-x64'
    tunnel = inputs / 'tunnel-client.exe'
    if not tunnel.is_file():
        raise ValueError('Windows tunnel bundle is incomplete.')
    runtime = build / 'runtime'
    clear_generated(runtime)
    bin_dir = runtime / 'bin'
    dc = runtime / 'dc'
    bin_dir.mkdir(parents=True)
    dc.mkdir()
    shutil.copy2(node_input / 'node.exe', bin_dir / 'node.exe')
    shutil.copy2(tunnel, bin_dir / 'tunnel-client.exe')
    if (inputs / 'cloudflared.exe').exists():
        shutil.copy2(inputs / 'cloudflared.exe', bin_dir / 'cloudflared.exe')
    for name in ('package.json', 'package-lock.json'):
        shutil.copy2(DESKTOP / 'runtime' / name, dc / name)
    env = dict(os.environ)
    # Do not read the user's npm configuration or install from a live dependency tree.
    for name in list(env):
        if name.lower().startswith('npm_config_'):
            del env[name]
    for name in ('npmrc-user', 'npmrc-global'):
        (build / name).touch()
    env.update({'NPM_CONFIG_USERCONFIG': str(build / 'npmrc-user'),
                'NPM_CONFIG_GLOBALCONFIG': str(build / 'npmrc-global'),
                'NPM_CONFIG_CACHE': str(build / 'npm-cache')})
    subprocess.run([str(node_input / 'node.exe'), str(node_input / 'node_modules/npm/bin/npm-cli.js'),
                    'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=dc, env=env, check=True)
    pdf = dc / 'node_modules/@wonderwhy-er/desktop-commander/dist/tools/pdf/markdown.js'
    text = pdf.read_text(encoding='utf-8')
    marker = '    // Return cached result if available'
    guard = """    if (process.env.MACBRIDGE_NO_BROWSER_DOWNLOAD === '1') {
        const system = findSystemChrome();
        if (system) return system;
        throw new Error('PDF generation requires Google Chrome. Install Chrome to use this optional feature.');
    }
"""
    if text.count(marker) != 1 or text.count('export function ensureChromeAvailable() {') != 1:
        raise ValueError('Pinned Desktop Commander no-browser patch no longer matches.')
    text = text.replace(marker, guard + marker).replace('export function ensureChromeAvailable() {',
        "export function ensureChromeAvailable() {\n    if (process.env.MACBRIDGE_NO_BROWSER_DOWNLOAD === '1') return;")
    pdf.write_text(text, encoding='utf-8')
    clear_generated(app)
    app.mkdir()
    compile_app(app)
    resources = app / 'resources'
    shutil.copytree(runtime, resources / 'runtime')
    shutil.copytree(DESKTOP / 'bridge', resources / 'bridge')
    licenses = resources / 'Licenses'
    licenses.mkdir()
    shutil.copy2(node_input / 'LICENSE', licenses / 'Node-LICENSE.txt')
    for file in inputs.iterdir():
        if file.is_file() and any(token in file.name.lower() for token in ('license', 'notice', 'spdx')):
            shutil.copy2(file, licenses / file.name)
    dependencies = []
    for file in sorted((dc / 'node_modules').rglob('package.json')):
        try:
            data = json.loads(file.read_text(encoding='utf-8'))
            if data.get('name') and data.get('version'):
                dependencies.append({key: data.get(key, 'See package license') for key in ('name', 'version', 'license')})
        except (ValueError, OSError):
            pass
    (licenses / 'dependencies.json').write_text(json.dumps(dependencies, indent=2), encoding='utf-8')
    (licenses / 'NOTICE.txt').write_text('gpt-bridge bundles Node.js 24.9.0, OpenAI tunnel-client 0.0.16, '
        'and Desktop Commander 0.2.52. Dependency licenses remain alongside their packages.\n'
        'Downstream change: disable automatic Chrome acquisition; PDF writing tools are not exposed.\n', encoding='utf-8')
    (resources / 'build-manifest.json').write_text(json.dumps({'product': 'gpt-bridge', 'appVersion': VERSION,
        'architecture': 'windows-x64', 'featureRelease': 'method-library.20261015',
        'features': ['method_library', 'obsidian_query', 'open_application'],
        'appSHA256': digest(app / 'gpt-bridge.exe'),
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PROJECT.parent, text=True).strip(),
        'bridgeSHA256': {file.name: digest(file) for file in sorted((resources / 'bridge').iterdir()) if file.is_file()},
        'node': '24.9.0', 'tunnelClient': '0.0.16', 'dc': '0.2.52',
        'lockSHA256': digest(dc / 'package-lock.json'), 'nodeSHA256': digest(bin_dir / 'node.exe'),
        'tunnelSHA256': digest(tunnel), 'downloads': INPUTS, 'signing': 'unsigned personal preview'}, indent=2), encoding='utf-8')
    shutil.copy2(PROJECT / 'README.md', app / '使用说明.md')
    output = PROJECT / ('dist/gpt-bridge-' + VERSION + '-windows-x64.zip')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file in sorted(app.rglob('*')):
            if file.is_file():
                bundle.write(file, file.relative_to(app.parent))
    output.with_suffix('.zip.sha256').write_text(digest(output) + '  ' + output.name + '\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
