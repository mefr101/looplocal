// Makes a safe copy of the database (and the uploaded photos) while the app keeps running.
// Run it inside the container:  docker compose exec -T app node deploy/backup.mjs
// Copies go in /data/backups. The newest 14 are kept.
import fs from 'node:fs';
import path from 'node:path';
import
{
  DatabaseSync
} from 'node:sqlite';

const dbPath = process.env.DB_PATH || './data/looplocal.db';
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const backupDir = process.argv[2] || path.join(path.dirname(dbPath), 'backups');
const keep = 14;

fs.mkdirSync(backupDir,
{
  recursive: true
});
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(backupDir, `looplocal-${stamp}.db`);

// VACUUM INTO writes a consistent snapshot even while people are using the site.
const db = new DatabaseSync(dbPath);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// Check the copy before trusting it.
const copy = new DatabaseSync(target,
{
  readOnly: true
});
const check = copy.prepare('PRAGMA integrity_check').get().integrity_check;
copy.close();
if (check !== 'ok')
{
  fs.rmSync(target);
  console.error(`Backup failed its integrity check: ${check}`);
  process.exit(1);
}

// Photos: copy any that are not in the backup folder yet (they are never edited, only added).
const photoDir = path.join(backupDir, 'uploads');
fs.mkdirSync(photoDir,
{
  recursive: true
});
let photos = 0;
if (fs.existsSync(uploadDir))
{
  for (const name of fs.readdirSync(uploadDir))
  {
    const from = path.join(uploadDir, name);
    const to = path.join(photoDir, name);
    if (fs.statSync(from).isFile() && !fs.existsSync(to))
    {
      fs.copyFileSync(from, to);
      photos += 1;
    }
  }
}

// Keep only the newest copies of the database.
const old = fs.readdirSync(backupDir).filter((name) => /^looplocal-.*\.db$/.test(name)).sort().slice(0, -keep);
for (const name of old) fs.rmSync(path.join(backupDir, name));

console.log(`Backed up to ${target} (${photos} new photo${photos === 1 ? '' : 's'}, ${old.length} old backup${old.length === 1 ? '' : 's'} removed).`);
