# Hosting LoopLocal on Oracle Cloud (Always Free)

This puts LoopLocal on a free, always-on server with a disk that keeps your data. It takes about an hour the first time.

What you end up with: the app and a web server (Caddy) running in Docker on one Ubuntu VM, with a free HTTPS certificate. Accounts, requests, the ledger and uploaded photos live in a Docker volume on the server's disk, so restarts and updates don't lose anything.

**Before you start**
- You need a credit or debit card. Oracle uses it to verify you; Always Free resources are not charged, but stay inside the free limits.
- You need a web address. Either a domain or subdomain you control, or a free one from DuckDNS (duckdns.org). The `<ip>.sslip.io` trick also works, but it is shared by many people and can hit certificate rate limits.
- Oracle can reclaim Always Free servers that sit idle for 7 days (under 20% CPU and network use). Keep off-site backups (step 9) and check the site now and then.
- Always Free machines can only be created in your **home region**, and you can't change it later. Pick the region closest to your users when you sign up.

---

## 1. Create the Oracle account
Sign up at oracle.com/cloud/free. Choose your home region carefully, then wait for the account to be ready.

## 2. Create the server
In the Oracle Cloud console: **Compute > Instances > Create instance**.
- **Image:** Ubuntu 24.04 (or 22.04).
- **Shape:** the "Always Free-eligible" label must be showing.
  - `VM.Standard.E2.1.Micro` (AMD, 1 GB RAM) is easiest to get. It is enough for LoopLocal.
  - `VM.Standard.A1.Flex` (Arm) is faster, but Oracle often says "out of host capacity". The app works on both.
- **Networking:** keep the default network and make sure a public IPv4 address is assigned.
- **SSH keys:** choose "generate a key pair" and download **both** files. Keep the private key safe; you can't download it again.
- **Boot volume:** the default size is fine.

Create it, then copy the instance's **public IP address**.

## 3. Open the web ports in Oracle's network
Open the instance, click its subnet, then its **Security List**, then **Add ingress rules**. Add two rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

## 4. Point your address at the server
- **Own domain:** create an `A` record for your (sub)domain pointing to the public IP.
- **DuckDNS:** create a subdomain and set its IP to the public IP.
- **No domain:** use `<ip>.sslip.io`, for example `203.0.113.7.sslip.io` (nothing to set up).

Check it with `ping your-address`; it should show your server's IP.

## 5. Connect and copy the code onto the server
From Windows PowerShell (replace the key path and IP):

```powershell
ssh -i C:\path\to\your-private-key.key ubuntu@YOUR_SERVER_IP
```

Then get the project onto the server. The simplest way is a private GitHub repository: push the project, then on the server run `git clone <your repo url> looplocal`.

Without GitHub, pack it on your computer and upload it:

```powershell
# On your computer, from the project folder (skips the big folders and your local data):
tar --exclude=node_modules --exclude=data --exclude=uploads --exclude=.git -czf looplocal.tgz .
scp -i C:\path\to\your-private-key.key looplocal.tgz ubuntu@YOUR_SERVER_IP:~
# On the server:
mkdir looplocal && tar -xzf looplocal.tgz -C looplocal
```

## 6. One-time server setup
On the server:

```sh
cd ~/looplocal
sh deploy/setup-vm.sh
```

It installs Docker, opens ports 80 and 443 in the server's own firewall (Oracle's Ubuntu images block them by default, and this is the step people forget), and adds swap so a 1 GB machine can build the image. When it finishes, **log out and back in** so Docker works without `sudo`.

## 7. Configure
```sh
cd ~/looplocal
cp .env.production.example .env
nano .env
```

Set `DOMAIN` to your address (no `https://`) and `SESSION_SECRET` to a long random string. Make one with `openssl rand -hex 32`. Keep this file private.

## 8. Start it
```sh
docker compose up -d --build
docker compose logs -f
```

The first build takes a few minutes. Caddy fetches the HTTPS certificate on the first visit, which can take up to a minute. Press Ctrl+C to leave the logs (the site keeps running), then open `https://your-address`.

Create your real organization with **Create an account > Create a new organization**. You become its first admin.

> Do **not** run `database/seed.js` on the live server. It deletes all data and loads fake demo accounts with a public password.

## 9. Backups (do this on day one)
The database lives in a Docker volume. Back it up daily:

```sh
crontab -e
```
Add this line (it runs at 03:00 every day):
```
0 3 * * * /home/ubuntu/looplocal/deploy/backup-to-host.sh >> /home/ubuntu/backup.log 2>&1
```

This writes dated copies into `~/looplocal/backups` (the newest 14 are kept, photos included). A backup on the same disk doesn't protect you if the server is reclaimed or the account is lost, so also copy it off the server regularly. From your own computer:

```powershell
scp -i C:\path\to\your-private-key.key -r ubuntu@YOUR_SERVER_IP:~/looplocal/backups .
```

Run `sh deploy/backup-to-host.sh` once now and check that a file appears in `backups/`.

### Restoring a backup
```sh
cd ~/looplocal
docker compose stop app
docker compose cp backups/looplocal-DATE.db app:/data/looplocal.db
docker compose cp backups/uploads/. app:/data/uploads/
docker compose run --rm --no-deps -u root app sh -c "rm -f /data/looplocal.db-wal /data/looplocal.db-shm; chown -R node:node /data"
docker compose start app
```

## 10. Updating the site
Put the new code on the server (`git pull`, or upload and unpack over the old folder, keeping `.env`), then:

```sh
cd ~/looplocal
docker compose up -d --build
```

Your data stays in the volume. If a new version changes the database layout, the app stops with "the database was created by an older version". There is no migration tool, so take a backup first and ask for help before updating across a schema change.

## 11. Keeping an eye on it
- `docker compose ps` shows whether both containers are up (the app shows "healthy").
- `docker compose logs --tail 100 app` shows recent errors.
- A free uptime monitor (for example UptimeRobot) pinging `https://your-address/health` tells you when it goes down.
- Once a month: `sudo apt update && sudo apt upgrade -y`, then reboot if it asks.

## Troubleshooting
- **Site won't load at all:** check the Oracle security list rules (step 3), the server's firewall (`sudo iptables -L INPUT -n | grep -E "80|443"`), and that DNS points to the server.
- **Certificate error:** DNS isn't pointing at the server yet, or ports 80/443 are blocked. Check `docker compose logs caddy`.
- **Sign-in doesn't stick:** make sure you are using the `https://` address. The login cookie is secure-only in production.
- **"Out of host capacity" when creating the server:** retry later, try the other shape, or try a different availability domain.
- **"Database was created by an older version":** see the note under step 10.
- **Everyone got signed out after an update:** expected. Sessions are held in memory and reset when the app restarts.

## Known limits
Sessions reset on every restart or update, there is no migration tool, and the free server is small. It comfortably handles a school-sized organization, not thousands of simultaneous users.
