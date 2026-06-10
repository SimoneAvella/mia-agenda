#!/usr/bin/env bash
set -euo pipefail

echo "=== Install Python dependencies ==="
# Adjust path if your requirements file is elsewhere
pip install -r requirements.txt

echo "=== Install Node dependencies ==="
cd Frontend_agenda
npm ci

echo "=== Build React app ==="
npm run build
cd ..

echo "=== Build completed ==="
