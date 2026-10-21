"""Prepare the captured original client. Never imports HTTP headers or cookies."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

# Scripts live in tools/; public/ and asset-manifest.json are at the project root.
ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/king/project/web-cloner/clones/ludoking/assets')
DEST = ROOT / 'public/play'
DEST.mkdir(parents=True, exist_ok=True)
shutil.copytree(SOURCE / 'play', DEST, dirs_exist_ok=True)
shutil.copyfile(SOURCE / 'api/v2/json/get/LK/1.0/7.json', ROOT / 'public/config.json')

def decode(value):
    if len(value) != 22:
        return value
    h = value[:2] + base64.b64decode(value[2:]).hex()
    return '-'.join([h[:8], h[8:12], h[12:16], h[16:20], h[20:]])

missing = []
for config_file in DEST.glob('assets/*/config.*.json'):
    config = json.loads(config_file.read_text())
    versions = config['versions']['import']
    for value, version in zip(versions[::2], versions[1::2]):
        uid = decode(config['uuids'][value]) if isinstance(value, int) else value
        path = config_file.parent.relative_to(DEST) / 'import' / uid[:2] / f'{uid}.{version}.json'
        if not (DEST / path).exists():
            missing.append(str(path))
    versions = config['versions']['native']
    for value, version in zip(versions[::2], versions[1::2]):
        uid = decode(config['uuids'][value]) if isinstance(value, int) else value
        directory = config_file.parent / 'native' / uid[:2]
        if not list(directory.glob(f'{uid}.{version}*')):
            # The only missing captured native is the main-bundle copy of the
            # Roboto font. Its name comes from the corresponding imported pack.
            if uid == 'f27c2f41-486f-4f6c-80df-b59dad00f164':
                missing.append(str(directory.relative_to(DEST) / f'{uid}.{version}/RobotoCondensed-Bold.ttf'))
            else:
                raise SystemExit(f'Native extension needs inspection: {uid}')

def download(path):
    target = DEST / path
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.part')
    url = 'https://ludoking.com/play/' + path
    result = subprocess.run(['curl', '-fsSL', '--retry', '2', '--connect-timeout', '15', '--max-time', '90', url, '-o', str(temporary)], capture_output=True)
    if result.returncode == 0:
        temporary.replace(target)
        return None
    if temporary.exists():
        temporary.unlink()
    return path

print(f'Copied captured game assets. Fetching {len(missing)} missing files.', flush=True)
with ThreadPoolExecutor(max_workers=10) as pool:
    failures = [path for path in pool.map(download, missing) if path]
files = []
for path in sorted(DEST.rglob('*')):
    if path.is_file():
        data = path.read_bytes()
        files.append({'path': str(path.relative_to(DEST)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(ROOT / 'asset-manifest.json').write_text(json.dumps({'source': str(SOURCE / 'play'), 'files': files, 'failed': failures}, indent=2) + '\n')
print(f'{len(files)} game files; {len(failures)} failures.', flush=True)
if failures:
    print('\n'.join(failures))
    sys.exit(1)
