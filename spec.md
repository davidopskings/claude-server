# Claude Code Agent Server Specification

## Overview

Build a local agent server that runs on a Mac to orchestrate Claude Code sessions for multiple client repositories. The server receives jobs via API from an external system (OpsKings OS), queues them, runs Claude Code CLI (using the Max subscription), and reports results back.

## Goals

1. Run Claude Code autonomously using the Max subscription (via `claude` CLI after `claude login`)
2. Support multiple client repositories with parallel job execution
3. Use git worktrees for isolation (multiple jobs on same repo simultaneously)
4. Provide a REST API for job management
5. Webhook callbacks to external system on job completion
6. Simple SQLite database for persistence

## Architecture

```
External System (OpsKings OS)
         │
         │  HTTPS API calls
         ▼
┌─────────────────────────────────────────┐
│  Agent Server (Mac)                     │
│  ├── Express API (port 3456)            │
│  ├── SQLite database                    │
│  ├── Job queue (in-memory + DB)         │
│  └── Claude Code CLI spawner            │
└─────────────────────────────────────────┘
         │
         ├── ~/repos/*.git (bare repositories)
         └── ~/worktrees/*/* (job working directories)
```

## Directory Structure

```
~/agent-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # Main entry, Express app
│   ├── db.ts              # SQLite setup and queries
│   ├── queue.ts           # Job queue management
│   ├── runner.ts          # Claude Code execution
│   ├── git.ts             # Git/worktree operations
│   └── types.ts           # TypeScript types
├── agent.db               # SQLite database (created at runtime)
└── logs/                  # Job logs directory

~/repos/                   # Bare git repositories
├── french-language-solutions.git/
├── outperformers.git/
└── ...

~/worktrees/               # Git worktrees (per job)
├── french-language-solutions/
│   ├── job-abc123/
│   └── job-def456/
└── ...
```

## Database Schema

```sql
-- Client repository configuration
CREATE TABLE clients (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  os_client_id TEXT UNIQUE,          -- UUID from OpsKings OS
  name TEXT NOT NULL,                -- Human readable name
  github_org TEXT NOT NULL,          -- e.g., "SupportKings"
  github_repo TEXT NOT NULL,         -- e.g., "french-language-solutions"
  default_branch TEXT DEFAULT 'main',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_clients_os_client_id ON clients(os_client_id);
CREATE INDEX idx_clients_github ON clients(github_org, github_repo);

-- Job queue
CREATE TABLE jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  status TEXT DEFAULT 'queued',      -- queued, running, completed, failed, cancelled
  
  -- Task details
  prompt TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  title TEXT,                        -- PR title
  
  -- External references
  os_feature_id TEXT,                -- UUID from OpsKings OS
  os_callback_url TEXT,              -- Webhook URL for completion
  
  -- Execution tracking
  worktree_path TEXT,
  pid INTEGER,                       -- Process ID when running
  started_at TEXT,
  completed_at TEXT,
  
  -- Results
  exit_code INTEGER,
  error TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  files_changed INTEGER,
  
  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_client_id ON jobs(client_id);
CREATE INDEX idx_jobs_os_feature_id ON jobs(os_feature_id);

-- Job message log (Claude Code output)
CREATE TABLE job_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                -- stdout, stderr, system
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_job_messages_job_id ON job_messages(job_id);
```

## API Endpoints

### Authentication

All endpoints require Bearer token authentication:

```
Authorization: Bearer <AGENT_API_SECRET>
```

The secret is set via environment variable `AGENT_API_SECRET`.

### Clients

#### List Clients
```
GET /clients

Response 200:
{
  "clients": [
    {
      "id": "abc123",
      "osClientId": "e897788c-afc6-4218-be48-703f2955cb0f",
      "name": "French Language Solutions",
      "githubOrg": "SupportKings",
      "githubRepo": "french-language-solutions",
      "defaultBranch": "main",
      "repoExists": true,
      "createdAt": "2025-01-07T12:00:00Z"
    }
  ]
}
```

#### Get Client
```
GET /clients/:id

Response 200:
{
  "id": "abc123",
  "osClientId": "e897788c-afc6-4218-be48-703f2955cb0f",
  "name": "French Language Solutions",
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "defaultBranch": "main",
  "repoExists": true,
  "activeJobs": 2,
  "totalJobs": 15,
  "createdAt": "2025-01-07T12:00:00Z"
}
```

#### Create Client
```
POST /clients

Request:
{
  "osClientId": "e897788c-afc6-4218-be48-703f2955cb0f",  // optional
  "name": "French Language Solutions",
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "defaultBranch": "main"  // optional, defaults to "main"
}

Response 201:
{
  "id": "abc123",
  "osClientId": "e897788c-afc6-4218-be48-703f2955cb0f",
  "name": "French Language Solutions",
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "defaultBranch": "main",
  "repoCloned": true,
  "bareRepoPath": "/Users/david/repos/french-language-solutions.git"
}
```

This endpoint also clones the bare repository if it doesn't exist.

#### Update Client
```
PATCH /clients/:id

Request:
{
  "name": "FLS Updated",
  "defaultBranch": "develop"
}

Response 200:
{
  "id": "abc123",
  "name": "FLS Updated",
  ...
}
```

#### Delete Client
```
DELETE /clients/:id

Response 200:
{
  "deleted": true,
  "repoRemoved": false  // bare repo preserved by default
}

Query params:
  ?removeRepo=true  // also delete the bare repository
```

### Jobs

#### List Jobs
```
GET /jobs

Query params:
  ?status=queued,running    // filter by status (comma-separated)
  ?clientId=abc123          // filter by client
  ?limit=50                 // pagination
  ?offset=0

Response 200:
{
  "jobs": [
    {
      "id": "job-xyz",
      "clientId": "abc123",
      "clientName": "French Language Solutions",
      "status": "running",
      "branchName": "feature/quotes-tab",
      "title": "Add Quotes Tab",
      "osFeatureId": "4e7df575-6bdc-4c38-944b-23a404b391db",
      "startedAt": "2025-01-07T12:00:00Z",
      "createdAt": "2025-01-07T11:59:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### Get Job
```
GET /jobs/:id

Query params:
  ?includeMessages=true     // include full message log

Response 200:
{
  "id": "job-xyz",
  "clientId": "abc123",
  "client": {
    "name": "French Language Solutions",
    "githubOrg": "SupportKings",
    "githubRepo": "french-language-solutions"
  },
  "status": "completed",
  "prompt": "Implement the Quotes tab...",
  "branchName": "feature/quotes-tab",
  "title": "Add Quotes Tab",
  "osFeatureId": "4e7df575-6bdc-4c38-944b-23a404b391db",
  "worktreePath": "/Users/david/worktrees/french-language-solutions/job-xyz",
  "startedAt": "2025-01-07T12:00:00Z",
  "completedAt": "2025-01-07T12:15:00Z",
  "exitCode": 0,
  "prUrl": "https://github.com/SupportKings/french-language-solutions/pull/42",
  "prNumber": 42,
  "filesChanged": 5,
  "messages": [  // if includeMessages=true
    {
      "type": "stdout",
      "content": "Reading CLAUDE.md...",
      "createdAt": "2025-01-07T12:00:01Z"
    }
  ],
  "createdAt": "2025-01-07T11:59:00Z"
}
```

#### Create Job
```
POST /jobs

Request (by client ID):
{
  "clientId": "abc123",
  "prompt": "Implement the Quotes tab on the Site detail view...",
  "branchName": "feature/quotes-tab",
  "title": "Add Quotes Tab to Site Detail",  // optional, used for PR
  "osFeatureId": "4e7df575-6bdc-4c38-944b-23a404b391db",  // optional
  "osCallbackUrl": "https://os.opskings.com/api/webhooks/agent"  // optional
}

Request (by GitHub org/repo - auto-creates client if needed):
{
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "prompt": "Fix the login bug...",
  "branchName": "fix/login-bug",
  "title": "Fix Login Bug"
}

Response 201:
{
  "id": "job-xyz",
  "clientId": "abc123",
  "status": "queued",
  "position": 3,  // position in queue
  "branchName": "feature/quotes-tab",
  "createdAt": "2025-01-07T11:59:00Z"
}
```

#### Cancel Job
```
POST /jobs/:id/cancel

Response 200:
{
  "id": "job-xyz",
  "status": "cancelled",
  "wasRunning": true
}

Response 400:
{
  "error": "Job already completed"
}
```

#### Retry Job
```
POST /jobs/:id/retry

Response 201:
{
  "id": "job-new-xyz",  // new job ID
  "originalJobId": "job-xyz",
  "status": "queued",
  "position": 1
}
```

### System

#### Health Check
```
GET /health

Response 200:
{
  "status": "ok",
  "queue": {
    "running": 2,
    "queued": 5,
    "maxConcurrent": 2
  },
  "claude": {
    "authenticated": true,
    "version": "1.0.0"
  }
}
```

#### Queue Status
```
GET /queue

Response 200:
{
  "running": [
    {
      "id": "job-abc",
      "clientName": "French Language Solutions",
      "branchName": "feature/quotes-tab",
      "startedAt": "2025-01-07T12:00:00Z",
      "runningFor": "5m 23s"
    }
  ],
  "queued": [
    {
      "id": "job-def",
      "clientName": "Outperformers",
      "branchName": "feature/dashboard",
      "position": 1,
      "createdAt": "2025-01-07T12:03:00Z"
    }
  ],
  "maxConcurrent": 2
}
```

#### Sync Repos
```
POST /sync

Fetches latest from origin for all bare repositories.

Response 200:
{
  "synced": [
    { "repo": "french-language-solutions", "success": true },
    { "repo": "outperformers", "success": true, "error": null }
  ]
}
```

## Job Execution Flow

### 1. Job Created
- Insert into `jobs` table with status `queued`
- Add job ID to in-memory queue
- Trigger queue processor

### 2. Queue Processor
```typescript
const MAX_CONCURRENT = 2;
let running = 0;

async function processQueue() {
  while (queue.length > 0 && running < MAX_CONCURRENT) {
    const jobId = queue.shift();
    running++;
    runJob(jobId).finally(() => {
      running--;
      processQueue();
    });
  }
}
```

### 3. Run Job
```typescript
async function runJob(jobId: string) {
  const job = await db.getJob(jobId);
  const client = await db.getClient(job.clientId);
  
  // 1. Update status
  await db.updateJob(jobId, { status: 'running', startedAt: new Date() });
  
  // 2. Ensure bare repo exists and is up to date
  await ensureBareRepo(client);
  await fetchOrigin(client);
  
  // 3. Create worktree
  const worktreePath = await createWorktree(client, job);
  await db.updateJob(jobId, { worktreePath });
  
  // 4. Run Claude Code
  const result = await runClaudeCode(job.prompt, worktreePath, jobId);
  
  // 5. If successful, commit and push
  if (result.exitCode === 0) {
    await commitAndPush(worktreePath, job);
    const pr = await createPullRequest(client, job);
    await db.updateJob(jobId, { 
      status: 'completed',
      prUrl: pr.url,
      prNumber: pr.number,
      filesChanged: pr.filesChanged
    });
  } else {
    await db.updateJob(jobId, { 
      status: 'failed',
      error: result.error,
      exitCode: result.exitCode
    });
  }
  
  // 6. Cleanup worktree
  await removeWorktree(client, worktreePath);
  
  // 7. Send webhook callback
  if (job.osCallbackUrl) {
    await sendCallback(job);
  }
}
```

### 4. Claude Code Execution
```typescript
import { spawn } from 'child_process';

function runClaudeCode(prompt: string, cwd: string, jobId: string): Promise<Result> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--print', prompt], {
      cwd,
      env: { 
        ...process.env, 
        HOME: '/Users/david'  // Ensure it finds ~/.claude auth
      }
    });
    
    // Store PID for cancellation
    db.updateJob(jobId, { pid: proc.pid });
    
    proc.stdout.on('data', (data) => {
      const content = data.toString();
      db.addJobMessage(jobId, 'stdout', content);
    });
    
    proc.stderr.on('data', (data) => {
      const content = data.toString();
      db.addJobMessage(jobId, 'stderr', content);
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        error: code !== 0 ? 'Claude Code exited with error' : null
      });
    });
  });
}
```

### 5. Git Operations
```typescript
const REPOS_DIR = '/Users/david/repos';
const WORKTREES_DIR = '/Users/david/worktrees';

async function ensureBareRepo(client: Client): Promise<string> {
  const barePath = `${REPOS_DIR}/${client.githubRepo}.git`;
  
  if (!existsSync(barePath)) {
    execSync(
      `git clone --bare git@github.com:${client.githubOrg}/${client.githubRepo}.git ${barePath}`
    );
  }
  
  return barePath;
}

async function fetchOrigin(client: Client) {
  const barePath = `${REPOS_DIR}/${client.githubRepo}.git`;
  execSync('git fetch origin --prune', { cwd: barePath });
}

async function createWorktree(client: Client, job: Job): Promise<string> {
  const barePath = `${REPOS_DIR}/${client.githubRepo}.git`;
  const worktreePath = `${WORKTREES_DIR}/${client.githubRepo}/${job.id}`;
  
  mkdirSync(dirname(worktreePath), { recursive: true });
  
  execSync(
    `git worktree add -b ${job.branchName} ${worktreePath} origin/${client.defaultBranch}`,
    { cwd: barePath }
  );
  
  return worktreePath;
}

async function commitAndPush(worktreePath: string, job: Job) {
  const message = job.title || `feat: ${job.branchName}`;
  
  execSync(`git add -A`, { cwd: worktreePath });
  
  // Check if there are changes to commit
  try {
    execSync(`git diff --cached --quiet`, { cwd: worktreePath });
    // No changes - still push the branch
  } catch {
    // Has changes - commit them
    execSync(`git commit -m "${message}"`, { cwd: worktreePath });
  }
  
  execSync(`git push -u origin ${job.branchName}`, { cwd: worktreePath });
}

async function removeWorktree(client: Client, worktreePath: string) {
  const barePath = `${REPOS_DIR}/${client.githubRepo}.git`;
  
  try {
    execSync(`git worktree remove --force ${worktreePath}`, { cwd: barePath });
  } catch (err) {
    // Log but don't fail - cleanup can be manual
    console.error(`Failed to remove worktree: ${err.message}`);
  }
}
```

### 6. Pull Request Creation
```typescript
async function createPullRequest(client: Client, job: Job) {
  const worktreePath = `${WORKTREES_DIR}/${client.githubRepo}/${job.id}`;
  
  // Use GitHub CLI
  const result = execSync(
    `gh pr create \
      --title "${job.title || job.branchName}" \
      --body "Automated by Claude Code Agent\n\nFeature ID: ${job.osFeatureId || 'N/A'}" \
      --head ${job.branchName} \
      --base ${client.defaultBranch}`,
    { cwd: worktreePath, encoding: 'utf-8' }
  );
  
  // Parse PR URL from output
  const prUrl = result.trim();
  const prNumber = parseInt(prUrl.split('/').pop());
  
  // Get files changed
  const filesOutput = execSync(
    `gh pr view ${prNumber} --json files --jq '.files | length'`,
    { cwd: worktreePath, encoding: 'utf-8' }
  );
  
  return {
    url: prUrl,
    number: prNumber,
    filesChanged: parseInt(filesOutput.trim())
  };
}
```

### 7. Webhook Callback
```typescript
async function sendCallback(job: Job) {
  if (!job.osCallbackUrl) return;
  
  const payload = {
    jobId: job.id,
    osFeatureId: job.osFeatureId,
    status: job.status,
    prUrl: job.prUrl,
    prNumber: job.prNumber,
    filesChanged: job.filesChanged,
    error: job.error,
    completedAt: job.completedAt
  };
  
  try {
    await fetch(job.osCallbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Signature': sign(payload)  // HMAC signature
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`Webhook failed: ${err.message}`);
  }
}
```

## Configuration

### Environment Variables

```bash
# Required
AGENT_API_SECRET=your-secret-key-here

# Optional
PORT=3456                              # API port (default: 3456)
MAX_CONCURRENT_JOBS=2                  # Max parallel jobs (default: 2)
REPOS_DIR=/Users/david/repos           # Bare repos directory
WORKTREES_DIR=/Users/david/worktrees   # Worktrees directory
HOME=/Users/david                      # For Claude CLI auth
WEBHOOK_SECRET=your-webhook-secret     # For signing callbacks
LOG_LEVEL=info                         # debug, info, warn, error
```

### CLAUDE.md (Global Agent Instructions)

Place at `~/.claude/CLAUDE.md`:

```markdown
# Agent Instructions

You are an autonomous coding agent working for OpsKings development team.

## Working Style
- Read existing code patterns before making changes
- Follow the repository's existing conventions
- Write clean, well-documented code
- Include appropriate error handling

## Git Workflow
- You are already on a feature branch
- Make atomic, focused changes
- Do not commit or push - that's handled externally

## When Stuck
- If requirements are unclear, make reasonable assumptions and document them
- If you encounter errors, try to fix them
- If something seems impossible, explain why in comments

## Testing
- Run existing tests if present: npm test, pnpm test, etc.
- Fix any tests you break
- Add tests for new functionality when appropriate
```

## Running the Server

### Development
```bash
cd ~/agent-server
npm install
npm run dev
```

### Production (with PM2)
```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start npm --name "agent-server" -- start

# Auto-start on boot
pm2 startup
pm2 save

# View logs
pm2 logs agent-server
```

### Keep Mac Awake
```bash
# Prevent sleep while server runs
caffeinate -d -i -s &

# Or use pmset
sudo pmset -c sleep 0 disksleep 0
```

## Network Access

### Option A: Tailscale (Recommended)
```bash
# Install Tailscale
brew install tailscale

# Login and connect
tailscale up

# Your Mac is now accessible at: http://your-mac.tailnet:3456
```

### Option B: Cloudflare Tunnel
```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create tunnel
cloudflared tunnel create agent-server

# Run tunnel
cloudflared tunnel --url http://localhost:3456
```

### Option C: ngrok (Quick Testing)
```bash
ngrok http 3456
```

## Prerequisites

Before running, ensure:

1. **Claude CLI installed and authenticated**
   ```bash
   # Install
   npm install -g @anthropic-ai/claude-code
   
   # Login (uses Max subscription)
   claude login
   
   # Verify
   claude --version
   claude "say hello"
   ```

2. **GitHub CLI installed and authenticated**
   ```bash
   # Install
   brew install gh
   
   # Login
   gh auth login
   
   # Verify
   gh auth status
   ```

3. **SSH keys configured for GitHub**
   ```bash
   # Test connection
   ssh -T git@github.com
   ```

4. **Directories created**
   ```bash
   mkdir -p ~/repos ~/worktrees ~/agent-server/logs
   ```

## Error Handling

### Job Failures
- Jobs that fail are marked with status `failed` and error message
- Worktrees are cleaned up even on failure
- Webhook callback is still sent with failure status

### Cleanup Cron
Add to crontab for orphaned worktree cleanup:
```bash
# Every hour, remove worktrees older than 24 hours with no matching job
0 * * * * find ~/worktrees -mindepth 2 -maxdepth 2 -type d -mtime +1 -exec rm -rf {} \;
```

### Graceful Shutdown
On SIGTERM/SIGINT:
1. Stop accepting new jobs
2. Wait for running jobs to complete (with timeout)
3. Close database connection
4. Exit

## TypeScript Types

```typescript
interface Client {
  id: string;
  osClientId: string | null;
  name: string;
  githubOrg: string;
  githubRepo: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

interface Job {
  id: string;
  clientId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  branchName: string;
  title: string | null;
  osFeatureId: string | null;
  osCallbackUrl: string | null;
  worktreePath: string | null;
  pid: number | null;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
  prUrl: string | null;
  prNumber: number | null;
  filesChanged: number | null;
  createdAt: string;
  updatedAt: string;
}

interface JobMessage {
  id: string;
  jobId: string;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
  createdAt: string;
}

interface CreateJobRequest {
  clientId?: string;
  githubOrg?: string;
  githubRepo?: string;
  prompt: string;
  branchName: string;
  title?: string;
  osFeatureId?: string;
  osCallbackUrl?: string;
}

interface CreateClientRequest {
  osClientId?: string;
  name: string;
  githubOrg: string;
  githubRepo: string;
  defaultBranch?: string;
}

interface WebhookPayload {
  jobId: string;
  osFeatureId: string | null;
  status: Job['status'];
  prUrl: string | null;
  prNumber: number | null;
  filesChanged: number | null;
  error: string | null;
  completedAt: string | null;
}
```

## Package.json

```json
{
  "name": "agent-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.18.2",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.7",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0"
  }
}
```

## Testing the Server

### 1. Start the server
```bash
cd ~/agent-server
AGENT_API_SECRET=test123 npm run dev
```

### 2. Create a client
```bash
curl -X POST http://localhost:3456/clients \
  -H "Authorization: Bearer test123" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Client",
    "githubOrg": "SupportKings",
    "githubRepo": "french-language-solutions"
  }'
```

### 3. Create a job
```bash
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer test123" \
  -H "Content-Type: application/json" \
  -d '{
    "githubOrg": "SupportKings",
    "githubRepo": "french-language-solutions",
    "branchName": "feature/test-agent",
    "title": "Test Agent Job",
    "prompt": "Find a small TODO comment in the codebase and implement it. If there are no TODOs, add a helpful code comment somewhere."
  }'
```

### 4. Check job status
```bash
curl http://localhost:3456/jobs/JOB_ID_HERE \
  -H "Authorization: Bearer test123"
```

### 5. View queue
```bash
curl http://localhost:3456/queue \
  -H "Authorization: Bearer test123"
```