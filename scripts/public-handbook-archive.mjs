import { crc32, inflateRawSync } from 'node:zlib';

// The only public archive is a fixed offline article, never a user backup.
export const publicHandbookArchive = 'src/BehindRose.Desktop/Assets/workbench/claude-windows-handbook.zip';
export const handbookEntries = [
  'scripts/Backup-ClaudeLocal.ps1', 'scripts/Launch-Claude.ps1', 'scripts/Test-ClaudeNetwork.ps1',
  'images/01-official-reasons.jpg', 'images/02-x-six-days.jpg', 'images/03-google-play-reply.jpg',
  'images/04-ccbaga-post.jpg', 'images/05-clash-proxy.png', 'images/06-clash-settings.png',
  'images/07-windows-proxy.png', 'images/08-windows-proxy-off.png',
  'claude-guide.html', 'claude-guide.md', 'README.txt',
];

// Reject unsupported ZIP features rather than allowing opaque or hidden payloads.
// No extraction, filesystem writes, external programs or network access.
export function readPublicHandbookArchive(data) {
  const fail = () => { throw Error('Invalid public handbook archive.'); };
  if (data.length < 22 || data.length > 4 * 1024 * 1024) fail();
  const end = data.length - 22;
  if (data.readUInt32LE(end) !== 0x06054b50 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || data.readUInt16LE(end + 20)) fail();
  const count = data.readUInt16LE(end + 10), start = data.readUInt32LE(end + 16);
  if (count !== handbookEntries.length || data.readUInt16LE(end + 8) !== count || start + data.readUInt32LE(end + 12) !== end) fail();
  const allowed = new Set(handbookEntries), entries = [];
  let offset = start, localOffset = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) fail();
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
    const checksum = data.readUInt32LE(offset + 16), size = data.readUInt32LE(offset + 24), packed = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
    const mode = data.readUInt32LE(offset + 38) >>> 16;
    if ((flags !== 0 && flags !== 0x800) || ![0, 8].includes(method) || extra || comment || data.readUInt16LE(offset + 34) || ((mode & 0xf000) && (mode & 0xf000) !== 0x8000)) fail();
    if (offset + 46 + nameLength > end || size > 4 * 1024 * 1024 || (total += size) > 8 * 1024 * 1024) fail();
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength), name = nameBytes.toString('utf8');
    if (!allowed.delete(name) || !Buffer.from(name).equals(nameBytes) || data.readUInt32LE(offset + 42) !== localOffset) fail();
    if (localOffset + 30 + nameLength > start || data.readUInt32LE(localOffset) !== 0x04034b50) fail();
    if (data.readUInt16LE(localOffset + 6) !== flags || data.readUInt16LE(localOffset + 8) !== method ||
        data.readUInt32LE(localOffset + 14) !== checksum || data.readUInt32LE(localOffset + 18) !== packed ||
        data.readUInt32LE(localOffset + 22) !== size || data.readUInt16LE(localOffset + 26) !== nameLength || data.readUInt16LE(localOffset + 28)) fail();
    if (!data.subarray(localOffset + 30, localOffset + 30 + nameLength).equals(nameBytes)) fail();
    const from = localOffset + 30 + nameLength;
    if (from + packed > start) fail();
    const compressed = data.subarray(from, from + packed);
    let content;
    try {
      if (method === 0) content = compressed;
      else {
        const result = inflateRawSync(compressed, { maxOutputLength: Math.max(1, size), info: true });
        if (result.engine.bytesWritten !== packed) fail();
        content = result.buffer;
      }
    } catch { fail(); }
    if (content.length !== size || crc32(content) !== checksum) fail();
    entries.push({ name, data: content });
    localOffset = from + packed;
    offset += 46 + nameLength;
  }
  if (offset !== end || localOffset !== start || allowed.size) fail();
  return entries;
}
