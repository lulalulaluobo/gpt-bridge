#!/usr/bin/env python3
"""Build an arm64 personal-preview app from pinned runtime inputs; never include user state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--node', type=Path, default=project/'build/runtime-input/node-v24.9.0-darwin-arm64/bin/node')
parser.add_argument('--runtime-source', type=Path, default=project/'build/runtime-input',
                    help='Directory containing vendor/tunnel-client-v0.0.16; never read user credentials.')
parser.add_argument('--dmg', action='store_true')
parser.add_argument('--keep-app', action='store_true', help='Keep the generated app after a DMG build for local installation.')
args = parser.parse_args()
stage = project/'build'
runtime = stage/'runtime'
runtime.mkdir(parents=True, exist_ok=True)
(runtime/'bin').mkdir(exist_ok=True)
source = args.runtime_source
args.node = args.node.expanduser().resolve()
if not args.node.is_file():
    parser.error('Node runtime not found. Run python3 scripts/bootstrap-runtime.py first, or pass --node.')
tunnel = source/'vendor/tunnel-client-v0.0.16/tunnel-client'
if not tunnel.is_file():
    parser.error('Tunnel runtime not found. Run python3 scripts/bootstrap-runtime.py first, or pass --runtime-source.')
node_version = subprocess.check_output([str(args.node), '--version'], text=True).strip()
if node_version != 'v24.9.0':
    parser.error('This release requires Node v24.9.0.')
shutil.copy2(args.node, runtime/'bin/node')
shutil.copy2(tunnel, runtime/'bin/tunnel-client')
dc = runtime/'dc'
dc.mkdir(exist_ok=True)
for name in ('package.json', 'package-lock.json'):
    shutil.copy2(project/'runtime'/name, dc/name)
# Install a clean dependency tree using package-lock integrity checks. Never copy the live node_modules.
stamp = hashlib.sha256((dc/'package-lock.json').read_bytes()).hexdigest()
stampfile = runtime/'lock.sha256'
if not stampfile.exists() or stampfile.read_text() != stamp or not (dc/'node_modules').exists():
    npm_cli = args.node.parent.parent/'lib/node_modules/npm/bin/npm-cli.js'
    env = {'PATH': str(args.node.parent)+':/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(stage/'build-home'),
           'NPM_CONFIG_CACHE': str(stage/'npm-cache'), 'NPM_CONFIG_USERCONFIG': str(stage/'npmrc-user'),
           'NPM_CONFIG_GLOBALCONFIG': str(stage/'npmrc-global')}
    (stage/'build-home').mkdir(exist_ok=True)
    for name in ('npmrc-user', 'npmrc-global'):
        (stage/name).touch()
    subprocess.run([str(args.node), str(npm_cli), 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=dc, env=env, check=True)
    stampfile.write_text(stamp)
# A narrow downstream patch: core file/terminal use must not trigger unsolicited Chrome downloads.
pdf = dc/'node_modules/@wonderwhy-er/desktop-commander/dist/tools/pdf/markdown.js'
text = pdf.read_text()
marker = '    // Return cached result if available'
guard = '''    if (process.env.MACBRIDGE_NO_BROWSER_DOWNLOAD === '1') {
        const system = findSystemChrome();
        if (system) return system;
        throw new Error('PDF generation requires Google Chrome. Install Chrome to use this optional feature.');
    }
'''
if guard not in text:
    assert text.count(marker) == 1
    text = text.replace(marker, guard+marker)
    warm = 'export function ensureChromeAvailable() {'
    assert text.count(warm) == 1
    text = text.replace(warm, warm+"\n    if (process.env.MACBRIDGE_NO_BROWSER_DOWNLOAD === '1') return;")
    pdf.write_text(text)

subprocess.run(['swift', 'build', '-c', 'release', '--package-path', str(project)], check=True)
out = project/'dist'
out.mkdir(exist_ok=True)
app = out/'gpt-bridge.app'
if app.exists():
    shutil.rmtree(app)
(app/'Contents/MacOS').mkdir(parents=True)
resources = app/'Contents/Resources'
resources.mkdir()
shutil.copy2(project/'.build/release/MacBridge', app/'Contents/MacOS/MacBridge')
shutil.copy2(project/'Resources/Info.plist', app/'Contents/Info.plist')
shutil.copytree(runtime, resources/'runtime', symlinks=True)
shutil.copytree(project/'bridge', resources/'bridge')
iconset = stage/'AppIcon.iconset'
subprocess.run(['swift', str(project/'scripts/icon.swift'), str(iconset)], check=True)
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(resources/'AppIcon.icns')], check=True)
licenses = resources/'Licenses'
licenses.mkdir()
node_license = args.node.parent.parent/'LICENSE'
shutil.copy2(node_license, licenses/'Node-LICENSE.txt')
for f in tunnel.parent.iterdir():
    if f.is_file() and ('license' in f.name.lower() or 'spdx' in f.name.lower() or 'notice' in f.name.lower()):
        shutil.copy2(f, licenses/f.name)
dependencies = []
for p in sorted((dc/'node_modules').rglob('package.json')):
    try:
        data = json.loads(p.read_text())
        if data.get('name') and data.get('version'):
            dependencies.append({'name': data['name'], 'version': data['version'], 'license': data.get('license', 'See package license')})
    except (ValueError, OSError):
        pass
(licenses/'dependencies.json').write_text(json.dumps(dependencies, indent=2))
(licenses/'NOTICE.txt').write_text('gpt-bridge bundles Node.js, OpenAI tunnel-client 0.0.16 and Desktop Commander 0.2.52.\nDependency license files remain alongside their packages.\nDesktop Commander downstream change: disable automatic Chrome acquisition when MACBRIDGE_NO_BROWSER_DOWNLOAD=1. PDF writing tools are not exposed by gpt-bridge 0.11.\n')
manifest = {'product': 'gpt-bridge', 'architecture': 'arm64', 'appVersion': '0.11', 'dc': '0.2.52',
            'node': node_version,
            'lockSHA256': stamp,
            'nodeSHA256': hashlib.sha256(args.node.read_bytes()).hexdigest(),
            'tunnelSHA256': hashlib.sha256(tunnel.read_bytes()).hexdigest(),
            'signing': 'ad-hoc personal preview, not notarized'}
(resources/'build-manifest.json').write_text(json.dumps(manifest, indent=2))
# Sign nested Mach-O binaries first, including Node native modules. Ad hoc is for local personal testing only.
magics = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'}
for f in resources.rglob('*'):
    if f.is_file() and not f.is_symlink():
        with f.open('rb') as handle:
            magic = handle.read(4)
        if magic in magics:
            subprocess.run(['codesign', '--force', '--sign', '-', str(f)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
if args.dmg:
    image = out/'gpt-bridge-0.11-arm64.dmg'
    dmgroot = stage/'dmg-root'
    if dmgroot.exists(): shutil.rmtree(dmgroot)
    dmgroot.mkdir()
    shutil.copytree(app, dmgroot/'gpt-bridge.app', symlinks=True)
    (dmgroot/'Applications').symlink_to('/Applications')
    shutil.copy2(project/'README.md', dmgroot/'使用说明.md')
    subprocess.run(['hdiutil', 'create', '-volname', 'gpt-bridge', '-srcfolder', str(dmgroot),
                    '-format', 'UDZO', '-ov', str(image)], check=True)
    # A DMG build needs no unpacked copies after packaging; these otherwise appear as duplicate apps.
    lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    generated_apps = [dmgroot/'gpt-bridge.app']
    if not args.keep_app:
        generated_apps.append(app)
    for generated_app in generated_apps:
        subprocess.run([lsregister, '-u', str(generated_app)], check=False, stdout=subprocess.DEVNULL)
    shutil.rmtree(dmgroot)
    if not args.keep_app:
        shutil.rmtree(app)
    print(image)
else:
    print(app)
