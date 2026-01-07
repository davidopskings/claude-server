# Claude Code Agent Server API Documentation

Base URL: `http://localhost:3456`

## Authentication

All endpoints (except `/health`) require Bearer token authentication:

```
Authorization: Bearer <AGENT_API_SECRET>
```

---

## System Endpoints

### Health Check

Check server status and Claude CLI authentication.

```
GET /health
```

**Response 200:**
```json
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

---

### Queue Status

Get detailed information about running and queued jobs.

```
GET /queue
```

**Response 200:**
```json
{
  "running": [
    {
      "id": "abc123",
      "clientName": "French Language Solutions",
      "branchName": "feature/quotes-tab",
      "startedAt": "2025-01-07T12:00:00Z",
      "runningFor": "5m 23s"
    }
  ],
  "queued": [
    {
      "id": "def456",
      "clientName": "Outperformers",
      "branchName": "feature/dashboard",
      "position": 1,
      "createdAt": "2025-01-07T12:03:00Z"
    }
  ],
  "maxConcurrent": 2
}
```

---

### Sync Repositories

Fetch latest changes from origin for all bare repositories.

```
POST /sync
```

**Response 200:**
```json
{
  "synced": [
    { "repo": "french-language-solutions", "success": true },
    { "repo": "outperformers", "success": false, "error": "Connection refused" }
  ]
}
```

---

## Client Endpoints

### List Clients

```
GET /clients
```

**Response 200:**
```json
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

---

### Get Client

```
GET /clients/:id
```

**Response 200:**
```json
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

**Response 404:**
```json
{
  "error": "Client not found"
}
```

---

### Create Client

```
POST /clients
```

**Request Body:**
```json
{
  "osClientId": "e897788c-afc6-4218-be48-703f2955cb0f",
  "name": "French Language Solutions",
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "defaultBranch": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name |
| `githubOrg` | string | Yes | GitHub organization |
| `githubRepo` | string | Yes | GitHub repository name |
| `osClientId` | string | No | UUID from OpsKings OS |
| `defaultBranch` | string | No | Default branch (defaults to "main") |

**Response 201:**
```json
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

**Response 409:**
```json
{
  "error": "Client with this org/repo already exists",
  "existingId": "abc123"
}
```

---

### Update Client

```
PATCH /clients/:id
```

**Request Body:**
```json
{
  "name": "FLS Updated",
  "defaultBranch": "develop",
  "osClientId": "new-uuid"
}
```

All fields are optional.

**Response 200:**
```json
{
  "id": "abc123",
  "osClientId": "new-uuid",
  "name": "FLS Updated",
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "defaultBranch": "develop",
  "createdAt": "2025-01-07T12:00:00Z",
  "updatedAt": "2025-01-07T13:00:00Z"
}
```

---

### Delete Client

```
DELETE /clients/:id
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `removeRepo` | boolean | If `true`, also delete the bare repository |

**Response 200:**
```json
{
  "deleted": true,
  "repoRemoved": false
}
```

---

## Job Endpoints

### List Jobs

```
GET /jobs
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Comma-separated status filter (e.g., `queued,running`) |
| `clientId` | string | Filter by client ID |
| `limit` | number | Results per page (default: 50) |
| `offset` | number | Pagination offset (default: 0) |

**Response 200:**
```json
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

---

### Get Job

```
GET /jobs/:id
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `includeMessages` | boolean | Include full message log |

**Response 200:**
```json
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
  "messages": [
    {
      "id": "msg-001",
      "jobId": "job-xyz",
      "type": "stdout",
      "content": "Reading CLAUDE.md...",
      "createdAt": "2025-01-07T12:00:01Z"
    }
  ],
  "createdAt": "2025-01-07T11:59:00Z"
}
```

---

### Create Job

```
POST /jobs
```

**Request Body (by client ID):**
```json
{
  "clientId": "abc123",
  "prompt": "Implement the Quotes tab on the Site detail view...",
  "branchName": "feature/quotes-tab",
  "title": "Add Quotes Tab to Site Detail",
  "osFeatureId": "4e7df575-6bdc-4c38-944b-23a404b391db",
  "osCallbackUrl": "https://os.opskings.com/api/webhooks/agent"
}
```

**Request Body (by GitHub org/repo):**
```json
{
  "githubOrg": "SupportKings",
  "githubRepo": "french-language-solutions",
  "prompt": "Fix the login bug...",
  "branchName": "fix/login-bug",
  "title": "Fix Login Bug"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Task description for Claude |
| `branchName` | string | Yes | Git branch to create |
| `clientId` | string | No* | Client ID |
| `githubOrg` | string | No* | GitHub organization |
| `githubRepo` | string | No* | GitHub repository |
| `title` | string | No | PR title |
| `osFeatureId` | string | No | Feature ID from OpsKings OS |
| `osCallbackUrl` | string | No | Webhook URL for completion |

*Either `clientId` OR `githubOrg`/`githubRepo` is required.

**Response 201:**
```json
{
  "id": "job-xyz",
  "clientId": "abc123",
  "status": "queued",
  "position": 3,
  "branchName": "feature/quotes-tab",
  "createdAt": "2025-01-07T11:59:00Z"
}
```

---

### Cancel Job

```
POST /jobs/:id/cancel
```

**Response 200:**
```json
{
  "id": "job-xyz",
  "status": "cancelled",
  "wasRunning": true
}
```

**Response 400:**
```json
{
  "error": "Job already completed"
}
```

---

### Retry Job

Creates a new job with the same parameters as the original.

```
POST /jobs/:id/retry
```

**Response 201:**
```json
{
  "id": "job-new-xyz",
  "originalJobId": "job-xyz",
  "status": "queued",
  "position": 1
}
```

---

## Webhook Callbacks

When a job completes and `osCallbackUrl` was provided, the server sends a POST request:

**Request:**
```
POST <osCallbackUrl>
Content-Type: application/json
X-Agent-Signature: <hmac-sha256-signature>
```

**Payload:**
```json
{
  "jobId": "job-xyz",
  "osFeatureId": "4e7df575-6bdc-4c38-944b-23a404b391db",
  "status": "completed",
  "prUrl": "https://github.com/SupportKings/french-language-solutions/pull/42",
  "prNumber": 42,
  "filesChanged": 5,
  "error": null,
  "completedAt": "2025-01-07T12:15:00Z"
}
```

The `X-Agent-Signature` header contains an HMAC-SHA256 signature of the payload body, signed with the `WEBHOOK_SECRET` environment variable.

---

## Job Status Values

| Status | Description |
|--------|-------------|
| `queued` | Job is waiting in queue |
| `running` | Job is currently being executed |
| `completed` | Job finished successfully |
| `failed` | Job encountered an error |
| `cancelled` | Job was cancelled by user |

---

## Error Responses

All error responses follow this format:

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
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error |

---

## Example: Complete Workflow

```bash
# 1. Create a client
curl -X POST http://localhost:3456/clients \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Project",
    "githubOrg": "myorg",
    "githubRepo": "myrepo"
  }'

# 2. Create a job
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "githubOrg": "myorg",
    "githubRepo": "myrepo",
    "branchName": "feature/new-feature",
    "title": "Add new feature",
    "prompt": "Add a logout button to the header component"
  }'

# 3. Check job status
curl http://localhost:3456/jobs/JOB_ID \
  -H "Authorization: Bearer your-secret"

# 4. View queue status
curl http://localhost:3456/queue \
  -H "Authorization: Bearer your-secret"
```
