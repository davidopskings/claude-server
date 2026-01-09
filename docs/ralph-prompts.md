# Ralph Loop Prompt Engineering Guide

This guide covers how to write effective prompts for Ralph Wiggum loop jobs, including test-driven development, build validation, and best practices.

---

## How Ralph Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        RALPH JOB FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Create worktree from default branch                         │
│  2. Initialize .ralph-progress.md                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   ITERATION LOOP                        │    │
│  │                                                         │    │
│  │  a. Build prompt = base_prompt + progress_file          │    │
│  │  b. Run Claude (with retry on crash)                    │    │
│  │  c. Check for completion promise                        │    │
│  │  d. Run feedback commands (tests, lint, build)          │    │
│  │  e. Append results to progress file                     │    │
│  │  f. Continue until: promise | max_iterations | error    │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. git add -A && git commit && git push                        │
│  4. gh pr create                                                │
│  5. Cleanup worktree                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prompt Structure

Each iteration, Claude receives:

```markdown
## Ralph Loop Context
- Iteration: {n} of {max}
- To signal completion, output: {completion_promise}

## Previous Progress
{contents of .ralph-progress.md}

## Your Task
{your original prompt}

## Instructions
1. Review the progress above from previous iterations
2. Continue working on the task
3. At the end of your work, include a "## Summary" section describing:
   - What you accomplished this iteration
   - What remains to be done (if anything)
4. If the task is fully complete, output "{completion_promise}" after your summary
5. If feedback commands failed in previous iteration, prioritize fixing those issues
```

---

## The Anatomy of a Good Ralph Prompt

### 1. Clear End State

Tell Claude exactly what "done" looks like:

```
❌ Bad:
"Add user authentication"

✅ Good:
"Implement user authentication with:
- Login endpoint (POST /auth/login)
- Logout endpoint (POST /auth/logout)
- JWT token generation and validation
- Password hashing with bcrypt
- Unit tests for all auth functions
- Integration tests for auth endpoints

Output RALPH_COMPLETE when all of the above are implemented and tests pass."
```

### 2. Explicit Acceptance Criteria

Be specific about what passes:

```
"The task is complete when:
1. All new functions have unit tests
2. npm test passes with 0 failures
3. npm run lint passes with 0 errors
4. TypeScript compiles with no errors
5. README is updated with new endpoints

Output RALPH_COMPLETE only when ALL criteria are met."
```

### 3. Feedback Command Awareness

Tell Claude what feedback commands will run:

```
"After each iteration, these commands will run:
- npm run build (must pass)
- npm test (must pass)
- npm run lint (warnings ok, errors not ok)

If any command fails, fix the issues in the next iteration before continuing with new work."
```

---

## Feedback Commands Configuration

### Basic Setup

```json
{
  "jobType": "ralph",
  "feedbackCommands": ["npm test"]
}
```

### Comprehensive Setup

```json
{
  "jobType": "ralph",
  "feedbackCommands": [
    "npm run build",
    "npm test",
    "npm run lint"
  ]
}
```

### With Type Checking

```json
{
  "feedbackCommands": [
    "npm run typecheck",
    "npm run build",
    "npm test -- --coverage",
    "npm run lint"
  ]
}
```

### Order Matters

Put fast-failing commands first:
1. **Type check** - catches type errors quickly
2. **Build** - catches compilation errors
3. **Lint** - catches style issues
4. **Tests** - validates functionality (slowest)

---

## Example Prompts by Task Type

### 1. Test-Driven Development

```
Implement a shopping cart module using TDD.

Requirements:
- Cart class with add, remove, updateQuantity, getTotal methods
- Item validation (positive quantities, valid prices)
- Tax calculation (8.5% rate)
- Discount codes support (percentage and fixed amount)

Process:
1. Write failing tests first
2. Implement minimal code to pass tests
3. Refactor if needed
4. Repeat for each feature

The task is complete when:
- All requirements have corresponding tests
- All tests pass
- Code coverage is above 80%

Output RALPH_COMPLETE when done.
```

**feedbackCommands:** `["npm test -- --coverage"]`

### 2. Bug Fix with Regression Tests

```
Fix the race condition in UserService.updateProfile().

Current behavior: Concurrent updates can overwrite each other.
Expected behavior: Updates should be atomic using optimistic locking.

Steps:
1. Write a failing test that reproduces the race condition
2. Implement the fix using version field for optimistic locking
3. Ensure the test passes
4. Add additional edge case tests

Output RALPH_COMPLETE when the fix is implemented and all tests pass.
```

**feedbackCommands:** `["npm test -- --grep 'UserService'"]`

### 3. Feature with Full Stack

```
Add a "forgot password" flow to the application.

Backend:
- POST /auth/forgot-password (sends email with reset token)
- POST /auth/reset-password (validates token, updates password)
- Reset tokens expire after 1 hour
- Rate limit: 3 requests per hour per email

Frontend:
- Forgot password form at /forgot-password
- Reset password form at /reset-password?token=xxx
- Loading states and error handling
- Success confirmation

Tests:
- Unit tests for token generation/validation
- Integration tests for both endpoints
- E2E test for the full flow

Output RALPH_COMPLETE when all components are implemented and tests pass.
```

**feedbackCommands:** `["npm run build", "npm test", "npm run test:e2e"]`

### 4. Refactoring with Safety

```
Refactor the PaymentProcessor class to use the Strategy pattern.

Current state: Large switch statement handling different payment methods.
Target state: PaymentStrategy interface with separate implementations.

Constraints:
- No changes to public API
- All existing tests must continue to pass
- No new dependencies

Process:
1. Ensure existing tests pass (baseline)
2. Create PaymentStrategy interface
3. Extract each payment method to its own class
4. Update PaymentProcessor to use strategies
5. Verify all tests still pass

Output RALPH_COMPLETE when refactoring is complete with all tests green.
```

**feedbackCommands:** `["npm run typecheck", "npm test"]`

### 5. API Development

```
Implement CRUD endpoints for the Products resource.

Endpoints:
- GET /products (list with pagination, filtering, sorting)
- GET /products/:id (single product)
- POST /products (create, admin only)
- PUT /products/:id (update, admin only)
- DELETE /products/:id (soft delete, admin only)

Requirements:
- Input validation with Zod schemas
- Proper error responses (400, 401, 403, 404, 500)
- OpenAPI documentation comments
- Unit tests for validation
- Integration tests for each endpoint

Output RALPH_COMPLETE when all endpoints work and tests pass.
```

**feedbackCommands:** `["npm run build", "npm test", "npm run lint"]`

---

## Progress File Example

After a few iterations, `.ralph-progress.md` looks like:

```markdown
# Ralph Progress Log
Job ID: abc-123
Branch: feature/auth-system
Started: 2026-01-09T10:00:00Z

---

## Iteration 1
Completed: 2026-01-09T10:05:00Z

### Summary
- Created User model with email, passwordHash fields
- Implemented password hashing utility with bcrypt
- Added unit tests for password hashing

### Feedback Results (Iteration 1)
- `npm test`: ✓ PASSED
- `npm run lint`: ✓ PASSED

---

## Iteration 2
Completed: 2026-01-09T10:12:00Z

### Summary
- Implemented login endpoint
- Added JWT token generation
- Tests failing - need to mock database

### Feedback Results (Iteration 2)
- `npm test`: ✗ FAILED
  Error: Cannot connect to database
- `npm run lint`: ✓ PASSED

---

## Iteration 3
Completed: 2026-01-09T10:18:00Z

### Summary
- Fixed tests by adding database mocks
- All login tests now passing
- Started implementing logout endpoint

### Feedback Results (Iteration 3)
- `npm test`: ✓ PASSED
- `npm run lint`: ✓ PASSED

---
```

---

## Anti-Patterns to Avoid

### 1. Vague Completion Criteria

```
❌ "Make it work well"
❌ "Improve the code"
❌ "Add appropriate tests"

✅ "All public methods have unit tests"
✅ "Coverage above 80%"
✅ "No TypeScript errors"
```

### 2. No Escape Hatch

Always set `maxIterations` - Claude might loop forever:

```json
{
  "maxIterations": 10,
  "prompt": "...if you cannot complete after 8 iterations, document blockers and output RALPH_COMPLETE anyway"
}
```

### 3. Overly Large Scope

Ralph works best with focused tasks. Break large features into multiple jobs:

```
❌ One job: "Build the entire e-commerce platform"

✅ Multiple jobs:
- Job 1: "Implement product catalog with tests"
- Job 2: "Implement shopping cart with tests"
- Job 3: "Implement checkout flow with tests"
```

### 4. No Test Strategy

Don't assume Claude will test appropriately:

```
❌ "Add tests"

✅ "Add tests following this pattern:
- Unit tests in __tests__/unit/
- Integration tests in __tests__/integration/
- Use Jest with ts-jest
- Mock external dependencies
- Aim for 80% coverage"
```

---

## Recommended Configurations by Project Type

### Node.js / TypeScript

```json
{
  "jobType": "ralph",
  "maxIterations": 15,
  "completionPromise": "RALPH_COMPLETE",
  "feedbackCommands": [
    "npm run typecheck",
    "npm run build",
    "npm test",
    "npm run lint"
  ]
}
```

### Python

```json
{
  "feedbackCommands": [
    "python -m mypy src/",
    "python -m pytest",
    "python -m ruff check ."
  ]
}
```

### Go

```json
{
  "feedbackCommands": [
    "go build ./...",
    "go test ./...",
    "golangci-lint run"
  ]
}
```

### Rust

```json
{
  "feedbackCommands": [
    "cargo check",
    "cargo test",
    "cargo clippy -- -D warnings"
  ]
}
```

---

## API Request Examples

### Minimal Ralph Job

```bash
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "...",
    "prompt": "Add input validation to the signup form. Output RALPH_COMPLETE when done.",
    "branchName": "feature/signup-validation",
    "jobType": "ralph"
  }'
```

### Full TDD Setup

```bash
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "...",
    "prompt": "Implement the OrderService class with TDD.\n\nMethods needed:\n- createOrder(items, userId)\n- cancelOrder(orderId)\n- getOrderStatus(orderId)\n\nRequirements:\n- Write tests first\n- Handle edge cases (empty cart, invalid user)\n- Use repository pattern for data access\n\nOutput RALPH_COMPLETE when all methods are implemented and tests pass.",
    "branchName": "feature/order-service",
    "jobType": "ralph",
    "title": "Implement OrderService with TDD",
    "maxIterations": 10,
    "completionPromise": "RALPH_COMPLETE",
    "feedbackCommands": ["npm run typecheck", "npm test -- --coverage"]
  }'
```

---

## Monitoring Ralph Jobs

### Check Current Iteration

```bash
curl http://localhost:3456/jobs/{id} \
  -H "Authorization: Bearer $SECRET" | jq '{
    status,
    current_iteration,
    max_iterations,
    completion_reason
  }'
```

### Get Iteration History

```bash
curl http://localhost:3456/jobs/{id}/iterations \
  -H "Authorization: Bearer $SECRET" | jq '.iterations[] | {
    iteration: .iterationNumber,
    promiseDetected,
    feedbackResults
  }'
```

### Stop Early

```bash
curl -X POST http://localhost:3456/jobs/{id}/stop \
  -H "Authorization: Bearer $SECRET"
```

---

## Troubleshooting

### Claude Keeps Looping

**Symptom:** Reaches max iterations without completing.

**Causes:**
1. Completion promise not in output
2. Tests keep failing
3. Scope too large

**Fixes:**
1. Check if Claude is outputting the exact promise string
2. Review feedback command outputs in iteration history
3. Break task into smaller jobs

### Tests Fail Every Iteration

**Symptom:** Feedback commands fail repeatedly.

**Causes:**
1. Missing dependencies
2. Database/service not mocked
3. Incorrect test setup

**Fixes:**
1. Ensure project builds locally before starting
2. Add setup instructions to prompt
3. Be explicit about mocking requirements

### No PR Created

**Symptom:** Job completes but no PR.

**Causes:**
1. No changes made
2. Git push failed
3. gh CLI not authenticated

**Fixes:**
1. Check job.error field
2. Verify git credentials
3. Check gh auth status
