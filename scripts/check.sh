#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

curl -fsS "$BASE_URL/health"
printf '\n'
for path in / /detail /modal /assets/plotline.js /configurations/ios_v1.json /configurations/android_v1.json; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$path")"
  printf '%-36s %s\n' "$path" "$code"
done
