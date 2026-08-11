#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

corepack enable
pnpm install --frozen-lockfile
python3.12 -m pip install --user -r requirements-dev.txt
pnpm test
python3.12 -m pytest -q
pnpm build

if [[ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  pnpm exec cap sync android
  (
    cd android
    ./gradlew assembleDebug
  )
else
  echo "ANDROID_HOME/ANDROID_SDK_ROOT is not configured; skipped APK build."
fi
