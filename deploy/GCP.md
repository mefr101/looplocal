# Hosting LoopLocal on Google Cloud (Always Free e2-micro)

This puts LoopLocal on a free, always-on Google Cloud server with a disk that keeps your data. It takes about an hour the first time. It is the same setup as `deploy/ORACLE.md` (the app and Caddy in Docker on one Ubuntu VM, free HTTPS), so only the cloud console steps differ.

**Before you start**
- You need a credit or debit card. Google uses it to verify you. Always Free resources are not charged, but stay inside the limits below.
- You need a web address: a domain or subdomain you control, a free one from DuckDNS (duckdns.org), or the `<ip>.sslip.io` trick (shared by many people, so it can hit certificate rate limits).
- **Always Free limits to stay inside** (check Google's "Free Cloud Features" page for the current terms):
  - One `e2-micro` VM per month, **only in** `us-west1` (Oregon), `us-central1` (Iowa) or `us-east1` (South Carolina).
  - Up to 30 GB of **standard persistent disk** (not SSD, not balanced).
  - 1 GB of outbound traffic per month from North America. That is plenty for a school-sized site, but photos add up if the site gets busy.
  - The VM needs an external IP. An IP attached to a running VM is free; a reserved IP left unattached is charged.
- Set a **budget alert** (step 1) so a mistake can't surprise you.

---

## 1. Create the account and a project
1. Go to **console.cloud.google.com** and sign in with a Google account.
2. Accept the terms and activate the free account if asked (this is where the card goes). A free trial credit may be offered; you can ignore it, since the VM below is Always Free either way.
3. Click the project picker at the top and choose **New project**. Name it `looplocal` and click **Create**. Make sure it is selected.
4. Set a budget alert: **Menu (☰) > Billing > Budgets & alerts > Create budget**. Name it `safety`, set the amount to **$1**, keep the default alert thresholds, and save.
5. Enable the Compute API: **Menu > Compute Engine > VM instances**. If it says "Enable", click it and wait a minute.

## 2. Create the server
**Compute Engine > VM instances > Create instance.** Fill in the form from the top:

| Field | Value |
|---|---|
| Name | `looplocal` |
| Region | `us-central1`, `us-west1` or `us-east1` (pick the closest to your users) |
| Zone | any zone in that region |
| Machine configuration | **General purpose > E2 > Machine type: `e2-micro`** (shows 2 vCPU shared, 1 GB memory) |

Then, in the left list of sections:
- **OS and storage > Change:**
  - Operating system: **Ubuntu**; version **Ubuntu 24.04 LTS** (x86/64).
  - Boot disk type: **Standard persistent disk** (not Balanced or SSD, which are not free).
  - Size: **30 GB** (the free maximum). Click **Select**.
- **Networking > Firewall:** tick both **Allow HTTP traffic** and **Allow HTTPS traffic**. This is what opens ports 80 and 443.
- **Networking > Network interfaces > default:** leave **External IPv4 address** on **Ephemeral** for now (you will make it permanent in step 3).
- Leave everything else as it is (no GPUs, no Spot).

Check the price estimate on the right. It should show a monthly cost, with a note that the free tier covers it. Click **Create**. When the VM shows a green check, copy its **External IP**.

## 3. Make the IP permanent
An ephemeral IP can change if you stop the VM, which would break your DNS. Reserve it:
1. **Menu > VPC network > IP addresses**.
2. Find the row for your VM's external IP, open its **Type** and choose **Static** (or use "Reserve" on that row). Name it `looplocal-ip`.
3. Leave it attached to the VM. A static IP in use by a running VM is free. Never leave it unattached.

## 4. Point your address at the server
- **Own domain:** create an `A` record for your (sub)domain pointing to the external IP.
- **DuckDNS:** create a subdomain and set its IP to the external IP.
- **No domain:** use `<ip>.sslip.io`, for example `203.0.113.7.sslip.io`.

Check it with `ping your-address`; it should show your server's IP.

## 5. Connect and copy the code onto the server
The easiest way in is the browser: on the **VM instances** page click **SSH** next to your VM. A terminal window opens (the first time it takes a minute while it creates keys).

Get the project onto the server. If your GitHub repository is public:

```sh
git clone https://github.com/mefr101/looplocal.git looplocal
```

If it is private, either make it public temporarily, or use a personal access token (GitHub > Settings > Developer settings > Fine-grained tokens, read-only on this repo) and clone with `git clone https://YOUR_TOKEN@github.com/mefr101/looplocal.git looplocal`. Delete the token when you're done.

Without GitHub, pack it on your computer (PowerShell, from the project folder) and upload it with the **gear icon > Upload file** button in the browser SSH window:

```powershell
tar --exclude=node_modules --exclude=data --exclude=uploads --exclude=.git -czf looplocal.tgz .
```
Then on the server: `mkdir looplocal && tar -xzf looplocal.tgz -C looplocal`

## 6. One-time server setup
```sh
cd ~/looplocal
sh deploy/setup-vm.sh
```

It installs Docker and adds swap so a 1 GB machine can build the image. It skips the server-side firewall step on Google Cloud, since Google's firewall is outside the VM and step 2 already opened it. When it finishes, **close the SSH window and open a new one** so Docker works without `sudo`.

## 7. Configure
```sh
cd ~/looplocal
cp .env.production.example .env
nano .env
```

Set `DOMAIN` to your address (no `https://`) and `SESSION_SECRET` to a long random string. Make one with `openssl rand -hex 32`. Save in nano with Ctrl+O, Enter, then Ctrl+X. Keep this file private.

## 8. Start it
```sh
docker compose up -d --build
docker compose logs -f
```

The first build takes several minutes on a 1 GB machine and can look stuck; wait for it. Caddy fetches the HTTPS certificate on the first visit, which can take up to a minute. Press Ctrl+C to leave the logs (the site keeps running), then open `https://your-address`.

Create your real organization with **Create an account > Create a new organization**. You become its first admin.

> Do **not** run `database/seed.js` on the live server. It deletes all data and loads fake demo accounts with a public password.

## 9. Backups (do this on day one)
Follow **step 9 and "Restoring a backup" in `deploy/ORACLE.md`** exactly; they are the same here. Two differences:
- The home folder is `/home/YOUR_USERNAME`, not `/home/ubuntu`. Run `echo $HOME` to see it, and use that path in the cron line.
- To copy backups to your computer, use the browser SSH window's **gear icon > Download file** on a `.tgz` you create with `tar -czf backups.tgz backups`, or install the Google Cloud CLI and use `gcloud compute scp`.

Run `sh deploy/backup-to-host.sh` once now and check that a file appears in `backups/`.

For extra safety, take a disk snapshot now and then: **Compute Engine > Snapshots > Create snapshot**. Note that snapshot storage is billed past a small free amount in some setups, so delete old ones.

## 10. Updating and watching it
Updating, monitoring and monthly upkeep work exactly as in `deploy/ORACLE.md` (steps 10 and 11). Pinging `https://your-address/health` with a free monitor such as UptimeRobot tells you when it goes down.

## Troubleshooting
- **Site won't load:** check that both "Allow HTTP" and "Allow HTTPS" are ticked on the VM (edit the VM to see them), that DNS points to the external IP, and that the containers are up (`docker compose ps`).
- **Certificate error:** DNS isn't pointing at the server yet, or ports 80/443 are blocked. Check `docker compose logs caddy`.
- **Build runs out of memory or the VM freezes:** confirm swap exists with `swapon --show`. If the SSH window drops during the build, reopen it and run `docker compose up -d --build` again.
- **Sign-in doesn't stick:** use the `https://` address. The login cookie is secure-only in production.
- **Unexpected charges:** check you used `e2-micro`, a **Standard** boot disk of 30 GB or less, one of the three free regions, and no unattached static IP.
- **"Database was created by an older version":** see the note under step 10 of `deploy/ORACLE.md`.

## Known limits
Same as Oracle: sessions reset on every restart or update, there is no migration tool, and the free server is small. It comfortably handles a school-sized organization, not thousands of simultaneous users.
