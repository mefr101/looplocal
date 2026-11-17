#!/bin/sh
# Takes a backup inside the app container, then copies every backup out to ./backups on the server.
# From there, copy ./backups somewhere else too (your laptop, cloud storage): a backup on the
# same disk does not protect you if the disk or the whole account is lost.
# Run it by hand, or from cron (see deploy/ORACLE.md).
set -e
cd "$(dirname "$0")/.."
docker compose exec -T app node deploy/backup.mjs
mkdir -p backups
docker compose cp app:/data/backups/. ./backups/
echo "Backups are in $(pwd)/backups"
