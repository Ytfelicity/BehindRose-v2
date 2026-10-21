"""Vendor verified flag-icons 7.5.0 assets without runtime CDN requests."""
import base64, hashlib, json, re, tarfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
cache = root / 'artifacts/visual-assets'
meta = json.loads((cache / 'flag-icons-package.json').read_text(encoding='utf-8-sig'))
data = (cache / 'flag-icons.tgz').read_bytes()
assert meta['version'] == '7.5.0'
assert 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == meta['dist']['integrity']
destination = root / 'src/BehindRose.Desktop/Assets/diagnostics/flags'
destination.mkdir(exist_ok=True)
codes = []
with tarfile.open(cache / 'flag-icons.tgz', 'r:gz') as archive:
    for item in archive.getmembers():
        match = re.fullmatch(r'package/flags/4x3/([a-z]{2})\.svg', item.name)
        if not match or not item.isfile():
            continue
        code = match[1]
        svg = archive.extractfile(item).read()
        assert b'<script' not in svg.lower() and b'<foreignobject' not in svg.lower()
        (destination / (code + '.svg')).write_bytes(svg)
        codes.append(code.upper())
    license_file = next(item for item in archive.getmembers() if item.name.lower() == 'package/license')
    (root / 'licenses/flag-icons-LICENSE.txt').write_bytes(archive.extractfile(license_file).read())
(destination.parent / 'flag-codes.js').write_text("/* flag-icons 7.5.0, MIT; see licenses/flag-icons-LICENSE.txt. */\nwindow.RoseFlagCodes = Object.freeze(" + json.dumps(sorted(codes)) + ");\n", encoding='utf-8')
print(f'Vendored {len(codes)} local flags, verified SHA-512.')
