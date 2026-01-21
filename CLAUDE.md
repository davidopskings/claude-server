# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun run dev      # Start development server with bun --hot
bun run dev:tsx  # Alternative: tsx watch (if bun --hot has issues)
bun run build    # TypeScript compilation to dist/
bun start        # Run compiled server from dist/index.js
```

Note: npm/pnpm/yarn are blocked by preinstall check - use bun only.

Server runs on port 3456 by default (configurable via PORT env var).

## Prerequisites

- **Bun** - package manager and runtime
- **Claude CLI** - must be installed and authenticated (`claude --version` to check)
- **Git** - authenticated with GitHub (for cloning/pushing)

## Local Testing

1. Copy `.env.example` to `.env` and fill in:
   - `AGENT_API_SECRET` - any secret string for auth
   - `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` - from Supabase project
   - `REPOS_DIR` and `WORKTREES_DIR` - local paths for git repos

2. Start the server: `bun run dev`

3. Test with curl:
```bash
curl http://localhost:3456/health
curl -H "Authorization: Bearer YOUR_SECRET" http://localhost:3456/clients
```

## Connection to OpsKings OS

The `opskings-operating-system` web app connects to this server via HTTP API:
- Set `AGENTS_API_URL=http://localhost:3456` in the OS `.env`
- Set `AGENTS_API_SECRET` to match `AGENT_API_SECRET` here
- The OS web app calls endpoints like `/jobs`, `/features/:id/spec/start` etc.

## Architecture Overview

claude-server is an autonomous software development agent server that orchestrates AI-powered code generation through multiple execution models.

### Core Processing Pipeline

```
HTTP Request → Queue (queue.ts) → Runner → Git Operations → PR Creation
                   ↓
              DB Queries (Supabase)
```

### Job Types

| Type | Runner | Purpose |
|------|--------|---------|
| `code` | `runner.ts:runJob` | One-shot Claude execution, commits & creates PR |
| `task` | `runner.ts:runJob` | Interactive session with stdin/stdout exchange |
| `ralph` | `runner.ts:runRalphJob` | Iterative development loop with feedback commands |
| `spec` | `spec/runner.ts:runSpecJob` | 6-phase specification pipeline |

### Spec-Kit Pipeline (6 Phases)

Sequential phases for feature specification:
1. **Constitution** - Extract codebase coding standards
2. **Specify** - Generate WHAT & WHY spec document
3. **Clarify** - Identify ambiguities (requires human answers)
4. **Plan** - Generate HOW architecture document
5. **Analyze** - LLM quality gate with auto-improve loop
6. **Tasks** - Break into atomic implementation tasks

### Key Modules

- `src/index.ts` - Express server, API routes, authentication
- `src/queue.ts` - Job dispatcher, concurrency control (MAX_CONCURRENT_JOBS)
- `src/runner.ts` - Standard/Ralph/Task job execution
- `src/spec/` - Spec-Kit pipeline (phases.ts, runner.ts, judge.ts, improve.ts)
- `src/db/` - Supabase client, queries, types
- `src/git.ts` - Bare repo + worktree management
- `src/memory/` - Cross-session context learning
- `src/agents/` - Multi-agent orchestration (Conductor pattern)
- `src/skills/` - Reusable skill library
- `src/scheduling/` - ML-based token prediction
- `src/observability/` - Distributed tracing

### Git Pattern

Uses bare repositories + worktrees for job isolation:
- Bare repos stored in `REPOS_DIR`
- Each job gets isolated worktree in `WORKTREES_DIR`
- Enables parallel work on same repository

### Ralph Iteration Loop

```
For each iteration:
  1. Build prompt with progress context
  2. Run Claude iteration
  3. Check for completion promise token
  4. Run feedback commands (npm test, lint)
  5. Record iteration to DB
  6. Update .ralph-progress.md
  7. Check cancellation status → graceful stop if cancelled
```

### Authentication

All API endpoints require Bearer token authentication via `AGENT_API_SECRET` env var.

## Environment Variables

```
PORT                  # Server port (default: 3456)
AGENT_API_SECRET      # Required authentication token
MAX_CONCURRENT_JOBS   # Queue concurrency (default: 2)
REPOS_DIR             # Bare repository storage path
WORKTREES_DIR         # Working directory storage path
CLAUDE_BIN            # Path to Claude CLI binary
```

## Code Quality

**Linting/Formatting:** Uses Biome (not ESLint/Prettier)
```bash
bun biome check src/           # Check for issues
bun biome check --write src/   # Auto-fix issues
```

Rules: tabs for indentation, double quotes, no `any` types allowed.

**Type Checking:**
```bash
bun tsc --noEmit   # Check types without emitting
```

## Current Status (Jan 2026)

### Working
- Core job runners (code, task, ralph, spec)
- Git worktree isolation
- Queue management
- API endpoints
- MCP server integration

### Database Schema
All migrations have been applied. Schema includes:
- `agent_memory` table - for cross-session learning
- `spec_output`, `spec_phase` columns on `features` and `agent_jobs` tables
- `agent_job_iterations` table - for Ralph loop tracking

Migrations are managed in: `opskings-operating-system/packages/db/src/migrations/`

To regenerate types after schema changes:
```bash
cd /path/to/opskings-operating-system
supabase gen types typescript --local > /tmp/types.ts
cp /tmp/types.ts apps/web/src/utils/supabase/database.types.ts
cp /tmp/types.ts ../claude-server/src/types/supabase.ts
```

### Implementation Gaps (Stub/Placeholder)
These modules exist but may need completion:
- `src/memory/` - Memory layer (uses `agent_memory` table)
- `src/agents/` - Multi-agent conductor pattern
- `src/skills/` - Skill library system
- `src/scheduling/` - Token prediction
- `src/observability/` - Distributed tracing

## Notes for Claude Sessions

1. **Use bun, not npm** - preinstall script blocks npm/pnpm/yarn
2. **No `any` types** - Use proper types or `unknown` with type guards
3. **Database types** - Generated from Supabase in OS repo, copied here as `src/types/supabase.ts`
4. **Migrations belong in OS repo** - Don't add migrations here
5. **Check biome before committing** - `bun biome check src/`
