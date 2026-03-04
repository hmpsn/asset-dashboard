#!/bin/zsh
# Asset Dashboard server — runs the Express backend for alt text + Webflow upload
# Launched automatically by com.hmpsn.assetdashboard launchd agent

export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

cd /Users/joshuahampson/CascadeProjects/asset-dashboard

# Use the project-local tsx
exec ./node_modules/.bin/tsx server/index.ts
