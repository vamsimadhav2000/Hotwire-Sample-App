#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! adb get-state >/dev/null 2>&1; then
  echo "No Android emulator or device is connected." >&2
  echo "Start an emulator first, then run this script again." >&2
  exit 1
fi

cd "$ROOT/android"
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.hotwiredemo/.MainActivity
