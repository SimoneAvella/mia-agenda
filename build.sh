#!/usr/bin/env bash
set -euo pipefail

# ==== Install Python dependencies ====
echo "=== Install Python dependencies ==="
# requirements.txt is at repository root
pip install -r requirements.txt

# ==== Install Node dependencies ====
echo "=== Install Node dependencies ==="
cd Frontend_agenda
# Use deterministic install (npm ci) and clean any previous install
npm ci

# ==== Clean previous build (if any) ====
echo "=== Clean previous build ==="
rm -rf dist

# ==== Build the React app ====
echo "=== Build React app ==="
npm run build
cd ..

# ==== (Optional) Copy built assets to FastAPI static folder ====
# If FastAPI serves from a different directory (e.g., Backend/static), uncomment the line below:
# cp -R Frontend_agenda/dist/* Backend/static/

echo "=== Build completed ==="
