// Production behaviour: sign-in behind an HTTPS proxy, and the backup script. Run with: npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-deploy-test-'));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SESSION_SECRET: 'test-secret-for-the-deploy-test',
  DB_PATH: path.join(tmp, 'prod.db'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  RATE_LIMIT_DISABLED: '1',
  PORT: '3931',
};
delete env.TRUST_PROXY;

execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env: { ...env, NODE_ENV: 'development' }, stdio: 'ignore' });
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
fs.writeFileSync(path.join(env.UPLOAD_DIR, 'photo.png'), 'not really a photo');

let server;
after(() =>
{
  server?.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the server may still hold the folder */ }
});

async function waitForServer()
{
  for (let i = 0; i < 50; i += 1)
  {
    try
    {
      if ((await fetch('http://localhost:3931/health')).ok) return;
    }
    catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('server did not start');
}

function login(headers = {})
{
  return fetch('http://localhost:3931/api/auth/login',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'admin@mapleridge.example', password: 'looplocal123' }),
  });
}

describe('production behind an HTTPS proxy', () =>
{
  test('signing in sets a secure session cookie when the proxy says the request was HTTPS', async () =>
  {
    server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
    await waitForServer();

    const response = await login({ 'x-forwarded-proto': 'https' });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /looplocal\.sid=/);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /HttpOnly/i);

    // The cookie works: the next request knows who is signed in.
    const me = await fetch('http://localhost:3931/api/auth/me', { headers: { cookie: cookie.split(';')[0], 'x-forwarded-proto': 'https' } });
    assert.equal((await me.json()).user.email, 'admin@mapleridge.example');
  });

  test('without the proxy header no secure cookie is sent (which is why the proxy setting matters)', async () =>
  {
    const response = await login();
    assert.equal(response.headers.get('set-cookie'), null);
  });
});

describe('backup script', () =>
{
  test('makes a database copy that opens and has the data, plus the photos, and keeps only the newest 14', () =>
  {
    const backups = path.join(tmp, 'backups');
    for (let i = 0; i < 16; i += 1)
    {
      fs.mkdirSync(backups, { recursive: true });
      fs.writeFileSync(path.join(backups, `looplocal-2020-01-${String(i + 1).padStart(2, '0')}-00-00-00.db`), 'old');
    }
    const output = execFileSync(process.execPath, ['deploy/backup.mjs', backups], { cwd: root, env }).toString();
    assert.match(output, /Backed up to/);

    const copies = fs.readdirSync(backups).filter((name) => name.endsWith('.db')).sort();
    assert.equal(copies.length, 14);
    const newest = new DatabaseSync(path.join(backups, copies.at(-1)), { readOnly: true });
    assert.ok(newest.prepare('SELECT COUNT(*) AS n FROM organizations').get().n >= 2);
    newest.close();
    assert.ok(fs.existsSync(path.join(backups, 'uploads', 'photo.png')));
  });
});
