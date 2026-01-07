#!/bin/bash
set -e

# ============================================
# Claude Code Orchestrator - DigitalOcean Setup
# ============================================
# Run this script on a fresh Ubuntu 24.04 droplet
# Usage: curl -sSL <raw-url> | bash
# ============================================

echo "=== Claude Code Orchestrator Setup ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

# Variables
DEPLOY_USER="deploy"
APP_DIR="/home/$DEPLOY_USER/claude-code-orchestrator"
REPOS_DIR="/home/$DEPLOY_USER/repos"
WORKTREES_DIR="/home/$DEPLOY_USER/worktrees"

# 1. System updates
echo "=== Updating system ==="
apt update && apt upgrade -y

# 2. Install Node.js 20
echo "=== Installing Node.js ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install Git
echo "=== Installing Git ==="
apt install -y git

# 4. Install GitHub CLI
echo "=== Installing GitHub CLI ==="
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt update && apt install -y gh

# 5. Install Claude Code
echo "=== Installing Claude Code ==="
npm install -g @anthropic-ai/claude-code

# 6. Create deploy user
echo "=== Creating deploy user ==="
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash $DEPLOY_USER
fi

# 7. Create directories
echo "=== Creating directories ==="
mkdir -p $REPOS_DIR $WORKTREES_DIR
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER

# 8. Create systemd service
echo "=== Creating systemd service ==="
cat > /etc/systemd/system/claude-agent.service << 'EOF'
[Unit]
Description=Claude Code Agent
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/claude-code-orchestrator
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
EnvironmentFile=/home/deploy/claude-code-orchestrator/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# 9. Install nginx (optional, for reverse proxy)
echo "=== Installing Nginx ==="
apt install -y nginx

cat > /etc/nginx/sites-available/claude-agent << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3456/health;
        proxy_http_version 1.1;
    }
}
EOF

ln -sf /etc/nginx/sites-available/claude-agent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Switch to deploy user:"
echo "   su - deploy"
echo ""
echo "2. Generate SSH key for GitHub:"
echo "   ssh-keygen -t ed25519 -C 'claude-agent'"
echo "   cat ~/.ssh/id_ed25519.pub"
echo "   # Add this key to GitHub (Settings > SSH Keys)"
echo ""
echo "3. Authenticate GitHub CLI:"
echo "   gh auth login"
echo ""
echo "4. Authenticate Claude Code:"
echo "   claude"
echo ""
echo "5. Clone your orchestrator repo:"
echo "   git clone git@github.com:YOUR_ORG/claude-code-orchestrator.git"
echo "   cd claude-code-orchestrator"
echo "   npm install && npm run build"
echo ""
echo "6. Create .env file:"
echo "   cat > .env << 'EOF'"
echo "   SUPABASE_URL=your-supabase-url"
echo "   SUPABASE_KEY=your-supabase-key"
echo "   AGENT_API_SECRET=your-secret-here"
echo "   REPOS_DIR=/home/deploy/repos"
echo "   WORKTREES_DIR=/home/deploy/worktrees"
echo "   MAX_CONCURRENT_JOBS=2"
echo "   PORT=3456"
echo "   EOF"
echo ""
echo "7. Start the service:"
echo "   sudo systemctl enable claude-agent"
echo "   sudo systemctl start claude-agent"
echo ""
echo "8. Check status:"
echo "   sudo systemctl status claude-agent"
echo "   sudo journalctl -u claude-agent -f"
echo ""
echo "9. (Optional) Add SSL with Let's Encrypt:"
echo "   sudo apt install certbot python3-certbot-nginx"
echo "   sudo certbot --nginx -d your-domain.com"
echo ""
