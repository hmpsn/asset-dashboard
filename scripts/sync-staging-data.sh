#!/bin/bash
# Sync production data to staging on Render
#
# Prerequisites:
#   - Render CLI installed: brew install render
#   - Authenticated: render login
#
# Usage:
#   ./scripts/sync-staging-data.sh
#
# What it does:
#   1. SSH into production, tar the DATA_DIR
#   2. Download the tarball
#   3. SSH into staging, upload and extract
#
# Alternatively, if you don't have Render CLI, you can use the
# Render dashboard's "Shell" tab to manually copy files.

set -euo pipefail

PROD_SERVICE="asset-dashboard"
STAGING_SERVICE="asset-dashboard-staging"
DATA_DIR="/var/data/asset-dashboard"
TEMP_FILE="/tmp/asset-dashboard-data-sync.tar.gz"

echo "📦 Syncing data from production → staging"
echo ""

# Check for render CLI
if ! command -v render &> /dev/null; then
  echo "❌ Render CLI not found. Install with: brew install render"
  echo ""
  echo "Manual alternative:"
  echo "  1. Go to Render Dashboard → $PROD_SERVICE → Shell"
  echo "  2. Run: tar czf /tmp/data-export.tar.gz -C $DATA_DIR ."
  echo "  3. Download the file"
  echo "  4. Go to $STAGING_SERVICE → Shell"
  echo "  5. Upload and run: tar xzf /tmp/data-export.tar.gz -C $DATA_DIR"
  exit 1
fi

echo "1/3  Creating snapshot on production..."
render ssh "$PROD_SERVICE" --command "tar czf /tmp/data-export.tar.gz -C $DATA_DIR ."

echo "2/3  Downloading snapshot..."
render scp "$PROD_SERVICE:/tmp/data-export.tar.gz" "$TEMP_FILE"

echo "3/3  Uploading to staging..."
render scp "$TEMP_FILE" "$STAGING_SERVICE:/tmp/data-export.tar.gz"
render ssh "$STAGING_SERVICE" --command "tar xzf /tmp/data-export.tar.gz -C $DATA_DIR && rm /tmp/data-export.tar.gz"

rm -f "$TEMP_FILE"

echo ""
echo "✅ Staging data synced from production"
echo "   Restart staging service to pick up changes."
