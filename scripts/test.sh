#!/bin/sh
# Runs the Playwright tests in Playwright's Linux image, the same environment as CI, so WebKit runs
# on any Mac and screenshots match. Needs Docker (e.g. `colima start`). Arguments go to `playwright test`.
set -e
cd "$(dirname "$0")/.."
image=mcr.microsoft.com/playwright:v1.55.1-noble
exec docker run --rm --ipc=host \
  -v "$PWD":/work -v stress-logger-web-node-modules:/work/node_modules -w /work \
  "$image" sh -c 'npm install --no-audit --no-fund --loglevel=error && npx playwright test "$@"' -- "$@"
