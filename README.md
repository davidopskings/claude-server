# claude-server

Autonomous software development agent server. Orchestrates AI-powered code generation through Spec-Kit (specification pipeline) and Ralph (iterative implementation loop).

## Quick Start

```bash
cp .env.example .env   # Fill in required values
bun install
bun run dev             # http://localhost:3456
```

## Tests

```bash
bun test                    # Run all tests
bun test --coverage         # Run with coverage
bun test tests/unit/        # Unit tests only
bun test tests/integration/ # Integration tests only
```

### Coverage

All **pure logic functions** across the codebase are tested (100% of extractable pure functions). Tests replicate pure functions from source modules to avoid requiring database or filesystem mocks.

**Tested via pure function extraction:**
- `src/spec/phases.ts` — 100% functions, 100% lines (directly imported)
- `src/runner.ts` — prompt builders, output parsers, story tracking
- `src/spec/runner.ts` — auto-progression decision logic, output parsing
- `src/queue.ts` — routing, slot calculation, duration formatting
- `src/git.ts` — path generation, branch validation, URL building
- `src/prd.ts` — JSON extraction, context building
- `src/memory/` — recall scoring, formatting, deduplication
- `src/observability/` — span lifecycle, metrics aggregation
- `src/scheduling/` — token prediction, feature extraction
- `src/skills/` — skill detection, template interpolation
- `src/agents/` — agent routing, workflow logic
- `src/mcp/` — tool schemas, parameter handling

**Not unit tested (requires mocking):**
- Database queries (`src/db/`) — ~60+ Supabase query functions
- Git filesystem operations (`src/git.ts`) — clone, worktree, push
- External process spawning — Claude CLI execution
- Express HTTP handlers (`src/index.ts`) — endpoint logic

## Architecture

See [CLAUDE.md](./CLAUDE.md) for full architecture documentation, module descriptions, and development guidelines.
