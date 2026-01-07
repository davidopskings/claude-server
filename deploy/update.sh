#!/bin/bash
set -e

# ============================================
# Claude Code Orchestrator - Update Script
# ============================================
# Run this as the deploy user to update the app
# Usage: ./deploy/update.sh
# ============================================

APP_DIR="/home/deploy/claude-code-orchestrator"

echo "=== Updating Claude Code Orchestrator ==="

cd $APP_DIR

# Pull latest changes
echo "Pulling latest changes..."
git pull origin main

# Install dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building..."
npm run build

# Restart service
echo "Restarting service..."
sudo systemctl restart claude-agent

# Check status
echo "Checking status..."
sleep 2
sudo systemctl status claude-agent --no-pager

echo ""
echo "=== Update Complete ==="
