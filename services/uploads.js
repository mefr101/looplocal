// Saving uploaded images safely. Shared by the organization logo and listing photos.
// A file is identified by its first bytes, never by the name or type the browser claims,
// and is stored under a random name inside the upload folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import
{
  config
} from '../config.js';

const IMAGE_TYPES = [
{
  ext: 'png',
  test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
},
{
  ext: 'jpg',
  test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
},
{
  ext: 'webp',
  test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
}, ];

/** 'png' | 'jpg' | 'webp', or null when the bytes are not one of those images. */
export function detectImageType(buffer)
{
  return IMAGE_TYPES.find((type) => type.test(buffer))?.ext ?? null;
}

/** Write the image as `<prefix>-<random>.<ext>` and return the file name. The caller has already checked the type. */
export function saveImage(prefix, buffer, ext)
{
  const filename = `${prefix}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.mkdirSync(config.uploadDir,
  {
    recursive: true
  });
  fs.writeFileSync(path.join(config.uploadDir, filename), buffer);
  return filename;
}

/** Delete an uploaded file. Only ever touches a file inside the upload folder. */
export function removeUpload(filename)
{
  if (!filename) return;
  fs.rmSync(path.join(config.uploadDir, path.basename(filename)),
  {
    force: true
  });
}
