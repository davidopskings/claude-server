# Claude Code Orchestrator API

Base URL: `http://localhost:3456`

All endpoints (except `/health`) require authentication:
```
Authorization: Bearer <AGENT_API_SECRET>
```

---

## Health

### GET /health
Check server status and dependencies.

**Response:**
```json
{
  "status": "ok",
  "queue": {
    "running": 1,
    "queued": 0,
    "maxConcurrent": 2
  },
  "claude": {
    "authenticated": true,
    "version": "2.0.76"
  },
  "git": {
    "authenticated": true
  }
}
```

---

## Clients

### GET /clients
List all clients with their repositories.

**Response:**
```json
{
  "clients": [
    {
      "id": "uuid",
      "name": "Client Name",
      "repositories": [
        {
          "id": "uuid",
          "owner_name": "github-org",
          "repo_name": "repo-name",
          "default_branch": "main"
        }
      ]
    }
  ]
}
```

### GET /clients/:id
Get a specific client with their repository.

**Response:**
```json
{
  "id": "uuid",
  "name": "Client Name",
  "repository": {
    "id": "uuid",
    "owner_name": "github-org",
    "repo_name": "repo-name",
    "default_branch": "main"
  }
}
```

### POST /clients/:id/repository
Add a GitHub repository to a client.

**Request Body:**
```json
{
  "githubOrg": "owner-name",
  "githubRepo": "repo-name",
  "defaultBranch": "main"
}
```

---

## Jobs

There are two job types:

| Type | Description |
|------|-------------|
| `code` | Creates a PR with code changes. Non-interactive, runs to completion. |
| `task` | Interactive Q&A/research session. No code modifications. Uses MCP tools. |

### GET /jobs
List jobs with optional filters.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Comma-separated: `queued,running,completed,failed,cancelled` |
| `clientId` | string | Filter by client UUID |
| `featureId` | string | Filter by feature UUID |
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "jobs": [...],
  "total": 100
}
```

### GET /jobs/:id
Get job details.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `includeMessages` | boolean | Include stdout/stderr/user messages |

**Response:**
```json
{
  "id": "uuid",
  "status": "running",
  "job_type": "task",
  "prompt": "...",
  "branch_name": "feature-branch",
  "client": { "id": "uuid", "name": "Client" },
  "feature": { "id": "uuid", "title": "Feature" },
  "repository": { "id": "uuid", "owner_name": "org", "repo_name": "repo" },
  "messages": [
    { "type": "stdout", "content": "...", "created_at": "..." },
    { "type": "user_input", "content": "...", "created_at": "..." }
  ]
}
```

### POST /jobs
Create a new job.

**Request Body:**
```json
{
  "clientId": "uuid",
  "prompt": "Your task description...",
  "branchName": "feature-x",
  "jobType": "code",
  "featureId": "uuid",
  "repositoryId": "uuid",
  "title": "Job title",
  "createdByTeamMemberId": "uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Task description for Claude |
| `clientId` | string | Yes* | Client UUID |
| `githubOrg` | string | Yes* | Alternative: GitHub org |
| `githubRepo` | string | Yes* | Alternative: GitHub repo |
| `branchName` | string | No** | Git branch name |
| `jobType` | string | No | `"code"` (default) or `"task"` |
| `featureId` | string | No | Feature UUID |
| `repositoryId` | string | No | Repository UUID |
| `title` | string | No | Job title |
| `createdByTeamMemberId` | string | No | Team member UUID |

\* Either `clientId` OR `githubOrg`/`githubRepo` is required.
\** Required for `code` jobs. Auto-generated for `task` jobs.

**Response:**
```json
{
  "id": "uuid",
  "status": "queued",
  "position": 1,
  "branchName": "feature-x",
  "createdAt": "2026-01-07T..."
}
```

### POST /jobs/:id/cancel
Cancel a queued or running job.

**Response:**
```json
{
  "id": "uuid",
  "status": "cancelled",
  "wasRunning": true
}
```

### POST /jobs/:id/retry
Retry a failed job (creates a new job with same prompt).

**Response:**
```json
{
  "id": "new-uuid",
  "originalJobId": "old-uuid",
  "status": "queued",
  "branchName": "feature-x-retry-1736..."
}
```

---

## Interactive Task Jobs

Task jobs (`jobType: "task"`) run in interactive mode, allowing conversation with Claude.

### POST /jobs/:id/message
Send a message to a running interactive task job.

**Request Body:**
```json
{
  "message": "Your response to Claude's question"
}
```

**Response:**
```json
{
  "id": "uuid",
  "messageSent": true
}
```

**Errors:**
| Code | Description |
|------|-------------|
| 400 | Job not running, not a task job, or not accepting messages |
| 404 | Job not found |
| 500 | Failed to send message |

### POST /jobs/:id/complete
End an interactive task job session and mark it as completed.

**Response:**
```json
{
  "id": "uuid",
  "status": "completing"
}
```

The job will be marked as `completed` once Claude finishes processing.

---

## Queue

### GET /queue
Get current queue status.

**Response:**
```json
{
  "running": [
    { "id": "uuid", "title": "...", "started_at": "..." }
  ],
  "queued": [
    { "id": "uuid", "title": "...", "created_at": "..." }
  ],
  "maxConcurrent": 2
}
```

---

## Repository Management

### POST /sync
Fetch latest from origin for all repositories.

**Response:**
```json
{
  "synced": [
    { "repo": "org/repo", "success": true }
  ]
}
```

### POST /repos/clone
Clone all repositories from the database.

**Response:**
```json
{
  "cloned": [
    { "repo": "org/repo", "success": true, "path": "/path/to/repo" }
  ]
}
```

### POST /repos/:id/clone
Clone a specific repository by ID.

**Response:**
```json
{
  "success": true,
  "repo": "org/repo",
  "path": "/path/to/repo"
}
```

---

## Message Types

Job messages have these types:

| Type | Description |
|------|-------------|
| `system` | System messages (job started, completed, etc.) |
| `stdout` | Claude's streaming JSON output |
| `stderr` | Error output |
| `user_input` | Messages sent via `/jobs/:id/message` |

---

## Job Status Values

| Status | Description |
|--------|-------------|
| `queued` | Waiting in queue |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Encountered an error |
| `cancelled` | Cancelled by user |

---

## Example: Code Job Workflow

```bash
# 1. Create a code job
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "14cddf8f-ce78-4b49-9eb4-9d17a7d1f568",
    "prompt": "Add a logout button to the header",
    "branchName": "feature/logout-button",
    "jobType": "code"
  }'

# 2. Poll job status until completed
curl "http://localhost:3456/jobs/JOB_ID" \
  -H "Authorization: Bearer $SECRET"

# Job will create PR automatically when done
```

---

## Example: Interactive Task Workflow

```bash
# 1. Create a task job
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "14cddf8f-ce78-4b49-9eb4-9d17a7d1f568",
    "prompt": "Can you spec me a feature for this client?",
    "jobType": "task"
  }'

# Response: { "id": "abc123", "status": "queued", ... }

# 2. Poll job status / messages
curl "http://localhost:3456/jobs/abc123?includeMessages=true" \
  -H "Authorization: Bearer $SECRET"

# 3. When Claude asks a question, send a response
curl -X POST http://localhost:3456/jobs/abc123/message \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message": "I want an analytics dashboard feature"}'

# 4. Continue conversation as needed...

# 5. When done, complete the session
curl -X POST http://localhost:3456/jobs/abc123/complete \
  -H "Authorization: Bearer $SECRET"
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3456` |
| `AGENT_API_SECRET` | API authentication token | Required |
| `MAX_CONCURRENT_JOBS` | Max parallel jobs | `2` |
| `REPOS_DIR` | Bare repo storage | `~/repos` |
| `WORKTREES_DIR` | Worktree storage | `~/worktrees` |
| `SUPABASE_URL` | Supabase project URL | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | Required |
| `GITHUB_TOKEN` | GitHub PAT for cloning/pushing | Required |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid API secret |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |
