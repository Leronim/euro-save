#!/usr/bin/env bash
set -euo pipefail
cd /opt/euro-save
exec 9>/var/lock/euro-save-deploy.lock
flock -w 240 9
# Persistent state outside the container prevents a second send in the same ISO week.
week="$(TZ=Europe/Nicosia date +%G-%V)"
state_dir=/var/lib/euro-save-weekly
mkdir -p "$state_dir"
if [ -f "$state_dir/$week.sent" ]; then exit 0; fi
docker compose -f docker-compose.prod.yml exec -T app node - < scripts/send-weekly-report.cjs
touch "$state_dir/$week.sent"
