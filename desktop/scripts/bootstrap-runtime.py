#!/usr/bin/env python3
"""Fetch pinned, checksum-verified arm64 build inputs. No application or user state is read."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

NODE_VERSION = '24.9.0'
TUNNEL_VERSION = '0.0.16'
INPUTS = (
    {
        'filename': 'node-v24.9.0-darwin-arm64.tar.gz',
        'url': 'https://nodejs.org/dist/v24.9.0/node-v24.9.0-darwin-arm64.tar.gz',
        'sha256': '961024296c2a8e60daed0784f8b61e0fab5c51d197502a92eff052c72b53209b',
        'checksums': 'https://nodejs.org/dist/v24.9.0/SHASUMS256.txt',
        'destination': 'node-v24.9.0-darwin-arm64',
    },
    {
        'filename': 'tunnel-client-v0.0.16-darwin-arm64.zip',
        'url': 'https://persistent.oaistatic.com/tunnel-client/v0.0.16/tunnel-client-v0.0.16-darwin-arm64.zip',
        'sha256': 'a160820d45089b5253d8d671fe2a689bde0f73d78c135d1497a7b33f28a3ac62',
        'checksums': 'https://github.com/openai/tunnel-client/releases/download/v0.0.16/SHA256SUMS.txt',
        'destination': 'vendor/tunnel-client-v0.0.16',
    },
)


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def safe_path(root, name):
    result = (root / name).resolve()
    if result != root and root not in result.parents:
        raise ValueError('Archive contains a path outside its destination.')
    return result


def unpack_tar(archive, destination):
    root = destination.resolve()
    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle.getmembers():
            target = safe_path(root, member.name)
            if member.isdev() or member.isfifo():
                raise ValueError('Archive contains a special device or pipe.')
            if member.issym():
                safe_path(root, str(target.parent.relative_to(root) / member.linkname))
            elif member.islnk():
                safe_path(root, member.linkname)
        # Inputs are fixed official archives; validate members before extracting into an empty directory.
        if hasattr(tarfile, 'data_filter'):
            bundle.extractall(destination, filter='data')
        else:
            bundle.extractall(destination)


def unpack_zip(archive, destination):
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            safe_path(root, member.filename)
            if (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('ZIP contains a symbolic link.')
        bundle.extractall(destination)


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=project / 'build/runtime-input')
    parser.add_argument('--check', action='store_true', help='Verify cached archives without downloading or extracting.')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    downloads = output / 'downloads'
    if not args.check:
        downloads.mkdir(parents=True, exist_ok=True)
    for item in INPUTS:
        archive = downloads / item['filename']
        if not archive.is_file() or digest(archive) != item['sha256']:
            if args.check:
                raise SystemExit('Missing or invalid cached archive: ' + item['filename'])
            temporary = archive.with_suffix(archive.suffix + '.partial')
            try:
                subprocess.run(['/usr/bin/curl', '--fail', '--location', '--silent', '--show-error', '--retry', '2',
                                '--connect-timeout', '30', '--max-time', '600',
                                '--proto', '=https', '--tlsv1.2', '--output', str(temporary), item['url']], check=True)
                if digest(temporary) != item['sha256']:
                    raise ValueError('SHA-256 mismatch for ' + item['filename'])
                temporary.replace(archive)
            finally:
                temporary.unlink(missing_ok=True)
        print('Verified ' + item['filename'])
        if args.check:
            continue
        with tempfile.TemporaryDirectory(prefix='extract-', dir=output) as temporary:
            unpacked = Path(temporary)
            if archive.suffix == '.zip':
                unpack_zip(archive, unpacked)
                payload = unpacked
            else:
                unpack_tar(archive, unpacked)
                payload = unpacked / item['destination']
            destination = output / item['destination']
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(payload, destination, symlinks=True)
    if args.check:
        return
    tunnel_dir = output / 'vendor/tunnel-client-v0.0.16'
    for name in ('tunnel-client', 'cloudflared'):
        (tunnel_dir / name).chmod(0o755)
    for name in ('LICENSE', 'NOTICE', 'tunnel-client-v0.0.16-darwin-arm64-licenses.txt',
                 'tunnel-client-v0.0.16-darwin-arm64.spdx.json'):
        if not (tunnel_dir / name).is_file():
            raise ValueError('Missing tunnel license material: ' + name)
    node = output / 'node-v24.9.0-darwin-arm64/bin/node'
    actual = subprocess.check_output([str(node), '--version'], text=True).strip()
    if actual != 'v' + NODE_VERSION:
        raise ValueError('Unexpected Node version.')
    (output / 'download-manifest.json').write_text(json.dumps({
        'node': NODE_VERSION, 'tunnelClient': TUNNEL_VERSION, 'architecture': 'darwin-arm64',
        'downloads': INPUTS,
    }, ensure_ascii=False, indent=2) + '\n')
    print('Build inputs ready: ' + str(output))


if __name__ == '__main__':
    main()
