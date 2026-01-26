# Spec-Kit & Ralph Workflow Stage Tasks

This document outlines the work needed in claude-server to support the new granular workflow stages in OpsKings OS.

## Context

OpsKings OS has implemented a comprehensive workflow stage system with the following convention:
- `*5` = Agent running (automated)
- `*6` = Human in the loop
- `*8` = Developer input needed
- `*9` = BA input needed
- `*0` = Complete state

## Tasks Overview

### 1. Update Feature Workflow Stage After Each Phase ✅ CRITICAL

**Location:** `src/spec/runner.ts` (or wherever spec phases execute)

After each spec phase completes, claude-server must update the feature's `featureWorkflowStageId` in the database.

```typescript
// Stage codes to update to after each phase:
const PHASE_COMPLETE_STAGES = {
  constitution: "constitution_complete",  // 52
  specify: "specify_complete",            // 60 (or clarify stages if questions)
  clarify: "clarify_complete",            // 63
  plan: "plan_complete",                  // 64 (or analyze stages)
  analyze: "analyze_complete",            // 73 (or analyze_failed → 72)
  improve: "improve_complete",            // 77
  tasks: "tasks_complete",                // 83 → then spec_complete (84)
};

// When clarify phase has unanswered questions:
// → Set stage to "clarify_waiting" (62)

// When analyze phase fails:
// → Set stage to "analyze_failed" (72)
// → Then "improve_running" (75)
```

**Implementation:**
```typescript
async function updateFeatureWorkflowStage(featureId: string, stageCode: string) {
  // 1. Look up stage ID by code from workflow_stages table
  const stage = await db
    .select()
    .from(workflowStages)
    .where(eq(workflowStages.code, stageCode))
    .where(eq(workflowStages.workflowId, FEATURE_WORKFLOW_ID));

  // 2. Update feature's featureWorkflowStageId
  await db
    .update(features)
    .set({ featureWorkflowStageId: stage.id, updatedAt: Date.now() })
    .where(eq(features.id, featureId));
}
```

---

### 2. Add "improve" Phase to Spec-Kit Pipeline

**Location:** `src/spec/phases/`

Create a new improve phase that:
1. Takes the analyze feedback
2. Revises the plan to fix issues
3. Returns to analyze phase for re-evaluation
4. Loops up to 3 times

**Files to create/modify:**
- `src/spec/phases/improve.ts` - New phase
- `src/spec/runner.ts` - Add improve to phase sequence
- `src/spec/types.ts` - Add improve to SpecPhase type

---

### 3. Update API Endpoints for Phase Triggers

**Location:** `src/routes/features.ts`

The OS will call `/features/:id/spec/phase` with a specific phase. Ensure all phases are supported:

```typescript
const validPhases = [
  "constitution",
  "specify",
  "clarify",
  "plan",
  "analyze",
  "improve",  // NEW
  "tasks"
];
```

---

### 4. Update Ralph to Set Workflow Stages

**Location:** `src/ralph/runner.ts`

Ralph should update feature workflow stage as it progresses:

| Event | Set Stage To |
|-------|--------------|
| Ralph starts | `ralph_running` (135) |
| Ralph needs clarification | `ralph_clarify` (136) |
| PR created, needs dev review | `ralph_dev_review` (138) |
| PR approved, BA review | `ralph_ba_review` (139) |
| PR merged / complete | `ralph_complete` (140) |

---

### 5. Handle "Human in the Loop" Stages

When spec-kit or ralph hits a stage requiring human input:

1. Update feature to appropriate `*_clarify` or `*_waiting` stage
2. Store clarification questions in `spec_output` JSONB
3. Wait for OS to call back with answers via `/features/:id/spec/clarify`
4. Continue to next phase

**Clarification Flow:**
```
Agent runs phase
    ↓
Questions generated?
    ├── No → Continue to next phase
    └── Yes → Set stage to *_clarify/*_waiting
              ↓
         OS shows questions to user
              ↓
         User answers in OS UI
              ↓
         OS calls POST /features/:id/spec/clarify
              ↓
         Agent continues with answers
```

---

### 6. Video Recording for Completed Features (Future)

**Concept:** After Ralph completes a feature, automatically record a demo video.

**Options:**
1. **Chromium MCP** - Use Puppeteer/Playwright via MCP to record browser session
2. **Screen recording** - Use native screen recording APIs
3. **Loom API** - Integrate with Loom for automatic recording

**Proposed Flow:**
```
Ralph completes (140)
    ↓
Feature marked as ready for demo
    ↓
Demo script generated from spec
    ↓
Chromium MCP navigates & records
    ↓
Video uploaded to feature attachments
```

**Tasks:**
- [ ] Add `demo_script` to spec output
- [ ] Create video recording service
- [ ] Integrate with Chromium MCP or Playwright
- [ ] Upload to S3/storage
- [ ] Link to feature in OS

---

## Stage Code Reference

### Spec-Kit Phases (50-84)

| Phase | Running | Clarify | Dev Review | BA Review | Complete |
|-------|---------|---------|------------|-----------|----------|
| Constitution | 51 | - | - | - | 52 |
| Specify | 55 | 56 | 58 | 59 | 60 |
| Clarify | 61 | 62 | - | - | 63 |
| Plan | 65 | 66 | 68 | 69 | 64 |
| Analyze | 71 | - | - | - | 73 (fail: 72) |
| Improve | 75 | 76 | - | - | 77 |
| Tasks | 81 | 82 | - | - | 83 |
| Spec Done | - | - | - | - | 84 |

### Ralph Pipeline (135-140)

| Stage | Code | Order |
|-------|------|-------|
| Running | `ralph_running` | 135 |
| Clarify | `ralph_clarify` | 136 |
| Dev Review | `ralph_dev_review` | 138 |
| BA Review | `ralph_ba_review` | 139 |
| Complete | `ralph_complete` | 140 |

---

## Testing Checklist

- [ ] Constitution phase updates stage to 52 on complete
- [ ] Specify phase updates to 56 if clarifications, 60 if none
- [ ] Clarify phase updates to 62 when waiting, 63 when answered
- [ ] Plan phase updates to 65 running, 64 complete
- [ ] Analyze phase updates to 72 on fail, 73 on pass
- [ ] Improve phase loops back to analyze (max 3 times)
- [ ] Tasks phase updates to 83, then 84 (spec_complete)
- [ ] Ralph updates through 135 → 136 → 138 → 139 → 140
- [ ] OS receives correct stage for visual feedback
- [ ] Error handling shows appropriate error stages

---

## Environment Variables

Ensure these are set:
```bash
DATABASE_URL=postgresql://...
FEATURE_WORKFLOW_ID=e787fde9-4d77-46ca-a032-33bd78c4bd91
```

---

## Related Files in OpsKings OS

- `packages/db/src/migrations/0013_spec_kit_ralph_workflow_stages.sql` - Migration
- `apps/web/src/shared/data/constants.ts` - Stage constants
- `apps/web/src/features/features/actions/handleWorkflowStageChange.ts` - Triggers
- `docs/claude/spec-kit.md` - Full documentation
