# Spec-Kit: AI-Powered Specification Generation

Spec-Kit is a 6-phase pipeline that transforms feature requests into detailed, implementation-ready specifications with atomic tasks.

## Overview

```
Feature Request → Constitution → Specify → Clarify → Plan → Analyze → Tasks → Ready for Ralph
```

## Phases

### Phase 1: Constitution (order_index: 55)
**Purpose**: Analyze the codebase to extract coding principles and standards.

**Output**:
- Code style & conventions
- Architecture patterns
- Testing conventions
- Tech stack details
- Existing CLAUDE.md/AGENTS.md guidance

**Trigger**: Feature moves to `spec_ready` stage

### Phase 2: Specify
**Purpose**: Generate detailed specification (WHAT and WHY).

**Output**:
- Overview and purpose
- Functional requirements (REQ-001, REQ-002, etc.)
- Acceptance criteria (Given/When/Then)
- Out of scope items
- Edge cases to handle

### Phase 3: Clarify
**Purpose**: Identify ambiguities and generate clarifying questions.

**Output**:
- Clarification questions with context
- Assumptions being made
- Risks if questions go unanswered

**Human Input Required**: Users must answer questions before proceeding to Plan phase.

**Workflow Stage**: `spec_review` (order_index: 56)

### Phase 4: Plan
**Purpose**: Generate implementation plan (HOW).

**Output**:
- Architecture overview
- Technical decisions with rationale
- File structure (create/modify)
- Database/schema changes
- API changes
- Dependencies

### Phase 5: Analyze
**Purpose**: Validate plan against existing codebase using LLM-as-Judge.

**Output**:
- Pass/fail status
- Issues found (error/warning/info severity)
- Existing patterns to follow
- Reusable code discovered
- Suggestions for improvement

**Quality Criteria Evaluated**:
- Code follows existing patterns
- Error handling is comprehensive
- No hardcoded values that should be config
- Functions are focused and maintainable
- TypeScript types are strict (no 'any')

**Auto-Improve Loop**: If analysis fails, the plan is automatically revised and re-analyzed (max 3 iterations).

**Workflow Stages**:
- `spec_complete` (order_index: 60) - Analysis passed
- `spec_issues` (order_index: 65) - Analysis found issues needing attention

### Phase 6: Tasks
**Purpose**: Break down plan into atomic, implementable tasks.

**Output**:
- Task list with IDs, titles, descriptions
- Files to create/modify per task
- Tests to write
- Dependencies between tasks
- Estimate points (1, 2, 3, 5, 8)
- Critical path
- Parallelizable task groups

**Workflow Stage**: `ready_for_dev` (order_index: 90) - Triggers Ralph

## API Endpoints

### Start Spec-Kit
```
POST /features/:featureId/spec/start
```
Starts spec-kit from the beginning (constitution phase).

### Run Specific Phase
```
POST /features/:featureId/spec/phase
Body: { "phase": "plan" }
```
Run a specific phase (useful for re-running or continuing after clarifications).

### Get Spec Status
```
GET /features/:featureId/spec
```
Returns current phase, spec output, and pending clarifications.

### Submit Clarification
```
POST /features/:featureId/spec/clarifications/:clarificationId
Body: { "response": "User's answer" }
```
Submit an answer to a clarification question.

### List Phases
```
GET /spec/phases
```
Returns all phases with metadata.

## Database Schema

### Features Table Extensions
```sql
ALTER TABLE features ADD COLUMN spec_phase TEXT;
ALTER TABLE features ADD COLUMN spec_output JSONB;
```

### Agent Jobs Table Extensions
```sql
ALTER TABLE agent_jobs ADD COLUMN spec_phase TEXT;
ALTER TABLE agent_jobs ADD COLUMN spec_output JSONB;
```

### Workflow Stages
| ID | Code | Name | Order Index | Description |
|----|------|------|-------------|-------------|
| a1b2c3d4-... | spec_ready | Spec Ready | 55 | Triggers Spec-Kit |
| b2c3d4e5-... | spec_review | Spec Review | 56 | Waiting for clarification answers |
| c3d4e5f6-... | spec_complete | Spec Complete | 60 | Analysis passed |
| d4e5f6a7-... | spec_issues | Spec Issues | 65 | Analysis found issues |
| e5f6a7b8-... | ready_for_dev | Ready for Dev | 90 | Triggers Ralph |

## Integration with OpsKings OS

### Workflow Stage Triggers
When a feature's workflow stage changes in the OS:

1. **spec_ready** → `triggerSpecKit()` starts constitution phase
2. **ready_for_dev** → `triggerRalphJob()` starts implementation

### Clarification UI
The OS provides:
- Display of pending clarification questions
- Text input for answers
- Submit button that calls `submitSpecClarification()`
- Auto-refresh of spec status

### Spec Output Display
Collapsible sections showing:
- Constitution (coding principles)
- Specification (requirements, acceptance criteria)
- Plan (architecture, file structure)
- Tasks (implementation tasks with dependencies)

## LLM-as-Judge Quality Gates

The analyze phase uses an LLM judge to evaluate the implementation plan against quality criteria.

### Default Criteria
```typescript
const DEFAULT_CRITERIA = [
  "Code follows existing patterns in the codebase",
  "Error handling is comprehensive",
  "No hardcoded values that should be config",
  "Functions are focused and under 50 lines",
  "Comments explain 'why', not 'what'",
  "TypeScript types are strict (no 'any')",
  "API calls have proper error boundaries",
];
```

### Per-Client Criteria
Clients can have custom quality criteria stored in the database.

### Auto-Improve Loop
When the judge returns `passed: false`:
1. Collect feedback from the judge
2. Send plan + feedback back to Claude
3. Claude revises the plan
4. Re-run analysis
5. Repeat up to 3 times

## File Structure

```
src/spec/
├── index.ts        # Exports
├── phases.ts       # Phase definitions & prompts
├── runner.ts       # Spec job execution
├── judge.ts        # LLM-as-Judge quality gate
└── improve.ts      # Auto-improve loop
```

## Environment Variables

```bash
CLAUDE_BIN=/path/to/claude     # Claude Code CLI binary
HOME=/Users/username           # Home directory for git operations
```

## Phase Details (Extended)

### Clarify Phase - Human Interaction

When questions are generated, the workflow:

1. Feature moved to `spec_review` workflow stage
2. Job status set to `awaiting_clarification`
3. **OpsKings OS dashboard displays the questions**
4. **System pauses and waits for human response**
5. User answers questions in OS dashboard
6. Answers submitted via API, spec updated
7. Re-run clarify to check for more questions
8. If no more questions, proceed to Plan

**OS Dashboard displays**:
```
🤔 Clarification Needed: {feature_title}

1. Should we support OAuth? Options: A) Email only, B) Google, C) Google+GitHub
2. Password requirements?
3. Session duration?

[Text input for each question]
[Submit button]
```

### Tasks Phase - Output Format

Each task in tasks.md contains:
- **Task number** - Sequential ID
- **Description** - What to implement
- **Files** - Files to create/modify
- **Tests** - Tests to verify completion
- **Commit message** - Conventional commit format
- **Dependencies** - Which tasks must complete first

**Example**:
```markdown
### Task 1: Create User model
**Description**: Create Prisma User model with auth fields
**Files**: prisma/schema.prisma
**Tests**: Schema validation
**Commit**: "feat(auth): add User model"

### Task 2: Generate migration
**Description**: Run prisma migrate
**Files**: prisma/migrations/*
**Depends on**: Task 1
**Commit**: "feat(auth): add User table migration"
```

## Context Persistence (Multi-Day Work)

For large features that span multiple sessions:

1. **Save context at session end**:
   - Completed tasks
   - Files modified
   - Insights/learnings
   - Blockers encountered

2. **Resume prompt generation**:
   - Load previous context
   - Generate continuation prompt for Claude
   - Include completed work summary

3. **Stored in**:
   - `session_contexts` table (if using extended schema)
   - Job metadata field (current implementation)

## Rate Limit Awareness

The spec runner respects Anthropic API limits:
- 40k tokens/minute limit
- ~5 hour daily budget
- Auto-schedules work to avoid hitting limits
- Pauses jobs when budget exhausted

## Priority Scheduling

Jobs can have priority P1-P5 affecting scheduling:
- **P1-P2**: Peak hours (9am-5pm weekdays)
- **P3**: Off-peak preferred (6pm-11pm)
- **P4-P5**: Weekend/overnight acceptable

## Status Values

**Job Status**:
- `queued` - Waiting in queue
- `running` - Currently executing
- `awaiting_clarification` - Paused for human input
- `completed` - Successfully finished
- `failed` - Error occurred
- `cancelled` - Manually cancelled

**Spec Phase**:
- `constitution` - Loading/creating coding principles
- `specify` - Generating WHAT & WHY
- `clarify` - Asking questions
- `plan` - Generating HOW
- `analyze` - Validating plan
- `tasks` - Breaking into units
- `complete` - All phases done
