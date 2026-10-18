#!/bin/bash
# Test de bout en bout dans un vrai navigateur, contre les moteurs SIMULÉS (aucun modèle requis).
#   Prérequis : Node + Playwright (npm i -g playwright && npx playwright install chromium)
set -e
cd "$(dirname "$0")/../.."
python3 tests/e2e/make_fake_mic.py /tmp/fake-mic.wav >/dev/null
DATA=$(mktemp -d)
PORT=${PORT:-8777}
python3 -m relais demo --port "$PORT" --data "$DATA" --server stdlib >/tmp/relais-e2e.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$PORT/api/info" && break; sleep 0.25; done
mkdir -p /tmp/shots
NODE_PATH=$(npm root -g) node tests/e2e/browser.cjs "http://localhost:$PORT" /tmp/shots
echo "Captures : /tmp/shots"
