# claude-server Architecture

## System Overview

claude-server is an autonomous software development agent that orchestrates AI-powered code generation through multiple execution models.

**Two Real Repos:**
1. `claude-server` - This repo, the agent server
2. `opskings-operating-system` - Web app with feature management + database

```
Feature (from OS Dashboard)
    │
    ▼
┌─────────────────────────────────────┐
│         SPEC-KIT PHASES 1-6         │
│  Constitution → Specify → Clarify   │
│  → Plan → Analyze → Tasks           │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│      RALPH IMPLEMENTATION           │
│   Autonomous loop from tasks        │
└─────────────────────────────────────┘
    │
    ▼
PR Ready for Review
```

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                            │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   OpsKings OS   │  Anthropic API  │   Slack/Discord Webhooks        │
│   (Features)    │  (Claude CLI)   │   (Notifications)               │
└────────┬────────┴────────┬────────┴────────────────┬────────────────┘
         │                 │                          │
         ▼                 ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CLAUDE-SERVER                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │  HTTP API   │───▶│   Queue     │───▶│    Runner               │ │
│  │  (Express)  │    │  (queue.ts) │    │  (runner.ts)            │ │
│  │  Port 3456  │    └─────────────┘    └─────────────────────────┘ │
│  └─────────────┘                                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     JOB RUNNERS                               │  │
│  │                                                               │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │  │
│  │  │  Code Job  │  │  Task Job  │  │      Ralph Job         │  │  │
│  │  │  (1-shot)  │  │(interactive)│  │ (iterative loop)      │  │  │
│  │  └────────────┘  └────────────┘  └────────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                   SPEC-KIT RUNNER                       │  │  │
│  │  │  1. Constitution    4. Plan                             │  │  │
│  │  │  2. Specify         5. Analyze (LLM Judge)             │  │  │
│  │  │  3. Clarify ←Human  6. Tasks                           │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │  Git Ops    │    │  Supabase   │    │  Memory Layer           │ │
│  │  (Worktrees)│    │  (Database) │    │  (Cross-session)        │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   OpsKings OS   │
│   Dashboard     │
│   (Next.js)     │
└─────────────────┘
```

## Data Flow

```
1. User creates feature in OpsKings OS dashboard
2. User moves feature to "spec_ready" workflow stage
3. OS calls claude-server API: POST /features/:id/spec/start
4. Queue accepts job, runner picks it up
5. Spec-Kit phases execute (1-6)
   - Phase 3 (Clarify) may PAUSE for human input
   - OS displays questions, user answers via dashboard
6. Tasks output produced
7. Feature workflow updated to "ready_for_dev"
8. OS triggers Ralph job
9. Ralph implements tasks from spec output
   - Each task: implement → test → commit
   - If stuck: request help via notification
10. All tasks complete → Create PR, notify via webhook
```

## Job Types

| Type | Runner | Description |
|------|--------|-------------|
| `code` | `runJob()` | One-shot Claude execution, commits & creates PR |
| `task` | `runJob()` | Interactive session with stdin/stdout exchange |
| `ralph` | `runRalphJob()` | Iterative loop with feedback commands |
| `spec` | `runSpecJob()` | 6-phase specification pipeline |

## Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| HTTP Server | `src/index.ts` | Express API, routes, auth |
| Queue | `src/queue.ts` | Job dispatcher, concurrency control |
| Runner | `src/runner.ts` | Code/Task/Ralph job execution |
| Spec Runner | `src/spec/runner.ts` | Spec-Kit phase orchestration |
| Spec Phases | `src/spec/phases.ts` | Phase definitions & prompts |
| Judge | `src/spec/judge.ts` | LLM quality gate |
| Improve | `src/spec/improve.ts` | Auto-improve loop |
| Git | `src/git.ts` | Bare repo + worktree management |
| DB Queries | `src/db/queries.ts` | Supabase operations |
| Memory | `src/memory/` | Cross-session learning (pending) |
| Agents | `src/agents/` | Multi-agent orchestration (pending) |

## Git Strategy

Uses bare repositories + worktrees for job isolation:

```
REPOS_DIR/
└── {client_id}/
    └── {repo_name}.git     # Bare repository

WORKTREES_DIR/
└── {job_id}/               # Isolated working copy
    └── {repo_name}/
```

**Benefits**:
- Parallel jobs on same repo
- No conflicts between jobs
- Clean separation
- Easy cleanup

## Authentication

All API endpoints require Bearer token:
```
Authorization: Bearer {AGENT_API_SECRET}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3456) |
| `AGENT_API_SECRET` | Yes | Authentication token |
| `MAX_CONCURRENT_JOBS` | No | Queue concurrency (default: 2) |
| `REPOS_DIR` | Yes | Bare repository storage |
| `WORKTREES_DIR` | Yes | Working directory storage |
| `CLAUDE_BIN` | No | Path to Claude CLI binary |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |

## Integration with OpsKings OS

1. **API Connection**: OS sets `AGENTS_API_URL=http://localhost:3456`
2. **Workflow Triggers**: OS calls API when feature workflow changes
3. **Clarification UI**: OS displays questions, submits answers
4. **Real-time Updates**: Jobs update Supabase, OS subscribes
5. **PR Links**: Job completion returns PR URL to OS
