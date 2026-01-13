# Claude Code Orchestrator API

Base URL: `http://localhost:3456`

All endpoints (except `/health`) require authentication:
```
Authorization: Bearer <AGENT_API_SECRET>
```

---

## Table of Contents

- [Health](#health)
- [Clients](#clients)
- [Features](#features)
- [Jobs](#jobs)
- [Interactive Task Jobs](#interactive-task-jobs)
- [Ralph Loop Jobs](#ralph-loop-jobs)
- [PRD Mode (Ralph Wiggum)](#prd-mode-ralph-wiggum)
- [Queue](#queue)
- [Repository Management](#repository-management)

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

## Features

### POST /features/:featureId/generate-tasks
Generate a PRD and development tasks for a feature using AI.

This endpoint:
1. Fetches the feature details from the database
2. Uses Claude to generate a PRD with user stories
3. Creates todos in the database for each task
4. Stores the PRD on the feature record

**Request Body:**
```json
{
  "clearExisting": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clearExisting` | boolean | No | If true, deletes existing todos before creating new ones |

**Response:**
```json
{
  "featureId": "uuid",
  "featureTitle": "User Authentication",
  "prd": {
    "overview": "A comprehensive user authentication system...",
    "userStories": [
      {
        "id": "US-1",
        "title": "User Registration",
        "description": "As a new user, I want to create an account...",
        "acceptanceCriteria": [
          "Email validation is performed",
          "Password meets strength requirements"
        ]
      }
    ],
    "outOfScope": ["Social login", "2FA"],
    "technicalNotes": "Use bcrypt for password hashing..."
  },
  "tasks": [
    {
      "title": "Implement registration endpoint",
      "description": "Create POST /auth/register...",
      "orderIndex": 0
    }
  ],
  "todosCreated": 5
}
```

**Errors:**
| Code | Description |
|------|-------------|
| 404 | Feature not found |
| 500 | PRD generation failed |

---

## Jobs

There are three job types:

| Type | Description |
|------|-------------|
| `code` | Creates a PR with code changes. Non-interactive, runs to completion. |
| `task` | Interactive Q&A/research session. No code modifications. Uses MCP tools. |
| `ralph` | Ralph Wiggum loop - iterates Claude until completion or max iterations. Creates a single PR at the end. |

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
| `jobType` | string | No | `"code"` (default), `"task"`, or `"ralph"` |
| `featureId` | string | No | Feature UUID |
| `repositoryId` | string | No | Repository UUID |
| `title` | string | No | Job title |
| `createdByTeamMemberId` | string | No | Team member UUID |
| `maxIterations` | number | No | Ralph only: max iterations (1-100, default: 10) |
| `completionPromise` | string | No | Ralph only: string that signals completion (default: `<promise>COMPLETE</promise>`) |
| `feedbackCommands` | string[] | No | Ralph only: deprecated, Claude runs tests itself |
| `prdMode` | boolean | No | Ralph only: enable PRD mode for story-based development |
| `prd` | object | No | Ralph PRD mode: PRD object with stories. If omitted with `prdMode: true`, loads from `featureId` |

\* Either `clientId` OR `githubOrg`/`githubRepo` is required.
\** Required for `code` jobs. Auto-generated for `task` and `ralph` jobs.

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

## Ralph Loop Jobs

Ralph jobs (`jobType: "ralph"`) run Claude in a loop until completion. Each iteration:
1. Reads progress from previous iterations
2. Runs Claude with the task
3. Runs feedback commands (tests, lint) if configured
4. Updates progress file
5. Checks for completion promise

A single commit and PR are created at the end with all accumulated changes.

### GET /jobs/:id/iterations
Get iteration history for a ralph job.

**Response:**
```json
{
  "jobId": "uuid",
  "currentIteration": 3,
  "maxIterations": 10,
  "completionReason": "promise_detected",
  "iterations": [
    {
      "id": "uuid",
      "iterationNumber": 1,
      "startedAt": "2026-01-09T10:00:00Z",
      "completedAt": "2026-01-09T10:05:00Z",
      "exitCode": 0,
      "error": null,
      "promiseDetected": false,
      "outputSummary": "Created initial scaffold...",
      "feedbackResults": [
        { "command": "npm test", "exitCode": 0, "passed": true }
      ]
    }
  ]
}
```

### POST /jobs/:id/stop
Gracefully stop a ralph job after the current iteration completes. The job will create a PR with partial work.

**Response:**
```json
{
  "id": "uuid",
  "message": "Stop requested - job will complete after current iteration and create PR with partial work"
}
```

**Errors:**
| Code | Description |
|------|-------------|
| 400 | Not a ralph job, or job not running |
| 404 | Job not found |

### Completion Reasons

| Reason | Description |
|--------|-------------|
| `promise_detected` | Claude output `<promise>COMPLETE</promise>` (all stories done) |
| `max_iterations` | Reached maximum iterations without completion |
| `manual_stop` | User called `/jobs/:id/stop` |
| `iteration_error` | An iteration failed after retry |

---

## PRD Mode (Ralph Wiggum)

PRD mode is an autonomous development pattern where Claude works through user stories independently. Named after the original "Ralph" pattern, it follows these principles:

- **Claude runs everything** - tests, linting, commits, story updates
- **Orchestrator just loops** - until `<promise>COMPLETE</promise>` signal or max iterations
- **Fresh context per iteration** - each iteration is a new Claude session
- **Progress persisted in files** - `prd.json` and `progress.txt` in the worktree

### How It Works

1. **Setup**: Orchestrator writes `prd.json` and `progress.txt` to the worktree
2. **Iteration Loop**:
   - Claude reads `prd.json` to find next incomplete story (`passes: false`)
   - Claude reads `progress.txt` to learn from previous iterations
   - Claude implements the story, runs quality checks (typecheck, lint, test)
   - If checks pass, Claude commits and updates `prd.json` to set `passes: true`
   - Claude appends learnings to `progress.txt`
3. **Completion**: When all stories have `passes: true`, Claude outputs `<promise>COMPLETE</promise>`
4. **PR Creation**: Orchestrator pushes all commits and creates a PR

### Key Files in Worktree

| File | Purpose |
|------|---------|
| `prd.json` | Stories with completion status - Claude updates this |
| `progress.txt` | Learnings and patterns - Claude appends to this |

### PRD Object Structure

```json
{
  "title": "User Authentication System",
  "description": "Implement secure user authentication",
  "stories": [
    {
      "id": 1,
      "title": "User registration",
      "description": "Allow new users to create accounts",
      "acceptanceCriteria": [
        "Email validation",
        "Password strength requirements"
      ],
      "passes": false
    },
    {
      "id": 2,
      "title": "User login",
      "description": "Allow existing users to log in",
      "acceptanceCriteria": [
        "JWT token generation",
        "Invalid credentials handling"
      ],
      "passes": false
    }
  ]
}
```

### What Claude Does Each Iteration

1. Reads `prd.json` and `progress.txt`
2. Installs dependencies if needed (checks for node_modules, etc.)
3. Picks highest priority story where `passes: false`
4. Implements the story
5. Runs quality checks (discovers commands from package.json, etc.)
6. If checks fail: fixes issues and re-runs until they pass
7. If checks pass: commits with message `feat: [Story ID] - [Story Title]`
8. Updates `prd.json` to set story's `passes: true`
9. Appends progress and learnings to `progress.txt`
10. If all stories complete: outputs `<promise>COMPLETE</promise>`

### PRD Progress Tracking

The job's `prd_progress` field tracks:

```json
{
  "currentStoryId": null,
  "completedStoryIds": [1, 2],
  "commits": [
    {
      "storyId": 1,
      "sha": "abc123...",
      "message": "feat: 1 - User registration",
      "timestamp": "2026-01-09T10:05:00Z"
    }
  ]
}
```

### Side Effects on Completion

When a PRD job completes successfully:
- All todos linked to the feature are updated to status `"done"`
- Feature's `feature_workflow_stage_id` is updated to "Ready for Review"

### Branch Name Generation

If no `branchName` is provided but a `featureId` is:
- Branch name is auto-generated from feature title and type
- Format: `{type-prefix}/{slug}` (e.g., `feature/user-authentication`, `fix/login-bug`)
- Type prefixes: `feature`, `fix`, `func`, `cosmetic`

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

## Example: Ralph Loop Workflow

```bash
# 1. Create a ralph job with feedback commands
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "14cddf8f-ce78-4b49-9eb4-9d17a7d1f568",
    "prompt": "Implement a user authentication system with login, logout, and session management. Include tests. Output RALPH_COMPLETE when done.",
    "branchName": "feature/auth-system",
    "jobType": "ralph",
    "maxIterations": 10,
    "completionPromise": "RALPH_COMPLETE",
    "feedbackCommands": ["npm test", "npm run lint"]
  }'

# Response:
# {
#   "id": "abc123",
#   "status": "queued",
#   "jobType": "ralph",
#   "maxIterations": 10,
#   "completionPromise": "RALPH_COMPLETE"
# }

# 2. Monitor iterations
curl "http://localhost:3456/jobs/abc123/iterations" \
  -H "Authorization: Bearer $SECRET"

# 3. (Optional) Stop early if needed
curl -X POST http://localhost:3456/jobs/abc123/stop \
  -H "Authorization: Bearer $SECRET"

# 4. Check final job status
curl "http://localhost:3456/jobs/abc123" \
  -H "Authorization: Bearer $SECRET"

# Response includes:
# - completion_reason: "promise_detected" | "max_iterations" | "manual_stop"
# - total_iterations: number of iterations completed
# - pr_url: link to created PR
```

---

## Example: PRD Mode Workflow (Full Flow)

The recommended workflow is to first generate a PRD from a feature, then run a Ralph job.

```bash
# Step 1: Generate PRD and tasks from a feature
curl -X POST http://localhost:3456/features/FEATURE_ID/generate-tasks \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'

# Response:
# {
#   "featureId": "abc123",
#   "featureTitle": "User Authentication",
#   "prd": { ... },
#   "tasks": [ ... ],
#   "todosCreated": 5
# }

# Step 2: Start a Ralph PRD job using the feature (PRD/todos loaded automatically)
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "featureId": "abc123",
    "prompt": "Implement the feature according to the PRD.",
    "jobType": "ralph",
    "maxIterations": 20,
    "prdMode": true
  }'

# Response (branch name auto-generated from feature):
# {
#   "id": "job456",
#   "status": "queued",
#   "jobType": "ralph",
#   "prdMode": true,
#   "branchName": "feature/user-authentication",
#   "maxIterations": 20
# }

# Step 3: Monitor iterations
curl "http://localhost:3456/jobs/job456/iterations" \
  -H "Authorization: Bearer $SECRET"

# Step 4: Check job status and progress
curl "http://localhost:3456/jobs/job456" \
  -H "Authorization: Bearer $SECRET"

# Response includes:
# {
#   "status": "running",
#   "prd_progress": {
#     "completedStoryIds": [1, 2],
#     "commits": [
#       { "storyId": 1, "sha": "abc123", "message": "feat: 1 - User registration" },
#       { "storyId": 2, "sha": "def456", "message": "feat: 2 - User login" }
#     ]
#   }
# }

# When complete:
# - PR is created with all commits
# - Feature todos are updated to status "done"
# - Feature workflow stage is updated to "Ready for Review"
```

### Alternative: Provide PRD Directly

You can also provide the PRD object directly instead of using a feature:

```bash
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "14cddf8f-ce78-4b49-9eb4-9d17a7d1f568",
    "prompt": "Implement the auth system as described in the PRD.",
    "branchName": "feature/auth-system",
    "jobType": "ralph",
    "maxIterations": 15,
    "prdMode": true,
    "prd": {
      "title": "User Authentication",
      "description": "Complete auth system",
      "stories": [
        {
          "id": 1,
          "title": "User registration endpoint",
          "description": "POST /auth/register with email/password",
          "acceptanceCriteria": ["Email validation", "Password hashing"],
          "passes": false
        },
        {
          "id": 2,
          "title": "User login endpoint",
          "description": "POST /auth/login returns JWT",
          "acceptanceCriteria": ["JWT generation", "Error handling"],
          "passes": false
        }
      ]
    }
  }'
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
