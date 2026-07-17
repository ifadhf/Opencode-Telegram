#!/usr/bin/env bash
# Deterministic deploy for the opencode-tele service.
#
# Builds in this workspace repo, then ships a PURE ARTIFACT to /opt
# (compiled dist/ + prod-only node_modules + package manifests) and restarts
# the systemd user service. /opt is NOT a git checkout — never `git pull` there;
# always deploy with this script. The deployed /opt/.env is never touched.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # the Opencode-Telegram repo root
DST="/opt/opencode-telegram"

echo "==> build (tsc)"
npm --prefix "$SRC" run build

echo "==> sync dist/ -> $DST/dist"
rsync -a --delete "$SRC/dist/" "$DST/dist/"

echo "==> sync package manifests"
cp "$SRC/package.json" "$SRC/package-lock.json" "$DST/"

echo "==> install prod-only deps in /opt"
npm ci --omit=dev --prefix "$DST"

echo "==> restart service"
systemctl --user restart opencode-tele.service

echo "==> wait for OpenCode server on :4097"
for i in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4097/session 2>/dev/null)" = "200" ]; then
    echo "    server up after ${i}s"; break
  fi
  sleep 1
done

echo -n "==> service: "; systemctl --user is-active opencode-tele.service
echo "==> done. /opt = pure artifact (dist + node_modules + package.json + package-lock.json + .env)."
