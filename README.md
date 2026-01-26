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

### Results

```
475 pass, 0 fail
1225 expect() calls
19 test files
```

| Test File | Tests | Covers |
|-----------|------:|--------|
| `unit/runner.test.ts` | 46 | Prompt building, output extraction, story tracking |
| `unit/scheduling.test.ts` | 43 | Token prediction, job features, capacity |
| `unit/spec/phases.test.ts` | 35 | Phase metadata, transitions, prompt builders |
| `unit/memory.test.ts` | 31 | Memory recall, learning, formatting |
| `integration/spec-flow.test.ts` | 26 | Phase flow, state machine, output validation |
| `unit/spec/test-verify.test.ts` | 25 | Test command detection, pattern matching |
| `unit/ralph-spec.test.ts` | 25 | Ralph spec-mode prompt building |
| `unit/observability.test.ts` | 25 | Span tracing, metrics, export |
| `unit/skills.test.ts` | 23 | Skill detection, interpolation, execution |
| `unit/git.test.ts` | 23 | Path generation, branch names, PR formatting |
| `unit/agents.test.ts` | 23 | Agent routing, conductor workflow |
| `unit/queue.test.ts` | 22 | Job routing, slot calculation, cancellation |
| `unit/mcp.test.ts` | 21 | MCP tools/resources schema, parameter handling |
| `integration/api.test.ts` | 21 | API endpoint validation, request/response shapes |
| `unit/spec/auto-progression.test.ts` | 20 | Phase auto-progression, human gates, analyze stops |
| `unit/prd.test.ts` | 20 | JSON extraction, feature context, PRD structure |
| `unit/spec/improve.test.ts` | 18 | Auto-improve loop, plan parsing |
| `unit/spec/judge.test.ts` | 15 | LLM judge criteria, scoring, prompt building |
| `unit/constitution.test.ts` | 13 | Constitution reuse, generation |

### Coverage Notes

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
