#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js, then rerun this script." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js with npm, then rerun this script." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

export PORT=5002
export CSCFEED_API_URL=http://127.0.0.1:5002

exec npm run start:local
