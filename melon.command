#!/bin/sh
# Melon launcher for macOS and Linux.
#
# On macOS the .command extension makes this double-clickable in Finder; you
# may need to run `chmod +x melon.command` once to allow that.
# On Linux, run it from a terminal: ./melon.command
#
# Everything real lives in scripts/launch.mjs, shared with the Windows .bat.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  [X] Node.js was not found on this machine."
  echo "      Install the LTS build from https://nodejs.org, then run this file again."
  echo
  read -r _ 2>/dev/null
  exit 1
fi

node "$(dirname "$0")/scripts/launch.mjs"
