#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${SIMULATOR_NAME:-iPhone 17 Pro}"
BUNDLE_ID="com.example.hotwiredemo"

open -a Simulator
xcrun simctl boot "$APP_NAME" 2>/dev/null || true
xcrun simctl bootstatus booted -b

cd "$ROOT/ios"
xcodegen generate --spec project.yml
xcodebuild \
  -project HotwireDemo.xcodeproj \
  -scheme HotwireDemo \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=$APP_NAME,OS=latest" \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl install booted "build/Build/Products/Debug-iphonesimulator/HotwireDemo.app"
xcrun simctl launch booted "$BUNDLE_ID"
