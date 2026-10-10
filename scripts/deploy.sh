#!/bin/sh
# Deploys the site: pushes main, which runs the GitHub Actions workflow (test, deploy to Pages, smoke), and waits for
# that run to pass. With nothing new to push, it reports the run for what's already there.
set -e
cd "$(dirname "$0")/.."
repo=reergymerej/stress-logger-web

if [ -n "$(git status --porcelain)" ]; then
  echo "There are uncommitted changes. Commit them first." >&2
  exit 1
fi

git push origin main
head=$(git rev-parse HEAD)
# The run can take a few seconds to show up after the push.
run=
for _ in 1 2 3 4 5 6 7 8 9 10; do
  run=$(gh run list -R "$repo" --commit "$head" --limit 1 --json databaseId -q '.[0].databaseId')
  [ -n "$run" ] && break
  sleep 3
done
if [ -z "$run" ]; then
  echo "No GitHub Actions run showed up for $head. Check the repo's Actions." >&2
  exit 1
fi
gh run watch "$run" -R "$repo" --exit-status
