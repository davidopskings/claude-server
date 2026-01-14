import { spawn, ChildProcess, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import {
  getJob,
  getRepositoryByClientId,
  getRepositoryById,
  updateJob,
  addJobMessage,
  createCodeBranch,
  createCodePullRequest,
  createIteration,
  updateIteration,
  updatePrdProgress,
  updateTodoStatusByFeatureAndOrder,
  syncTodosFromPrd,
  updateFeatureWorkflowStage,
  type CodeRepository
} from './db/index.js';

// Workflow stage ID for "Ready for Review" (after Ralph completes)
const WORKFLOW_STAGE_READY_FOR_REVIEW = '9bbe1c1a-cd24-44b4-98b3-2f769a4d2853';
import type { FeedbackResult, RalphCompletionReason, Prd, PrdStory, PrdProgress, PrdCommit } from './db/types.js';
import {
  ensureBareRepo,
  fetchOrigin,
  createWorktree,
  commitAndPush,
  createPullRequest,
  pushBranch
} from './git.js';

const execAsync = promisify(exec);

const HOME_DIR = process.env.HOME || '/Users/davidcavarlacic';
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

// Track interactive task processes (those that accept stdin)
const interactiveProcesses = new Map<string, ChildProcess>();

export async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // Get repository info
  let repo: CodeRepository | null = null;
  if (job.repository_id) {
    repo = await getRepositoryById(job.repository_id);
  } else {
    repo = await getRepositoryByClientId(job.client_id);
  }

  if (!repo) {
    await updateJob(jobId, {
      status: 'failed',
      error: 'No repository found for client. Add one to code_repositories first.',
      completed_at: new Date().toISOString()
    });
    return;
  }

  // Update job with repository_id if it wasn't set
  if (!job.repository_id) {
    await updateJob(jobId, { repository_id: repo.id });
  }

  let worktreePath: string | null = null;

  try {
    // Update status to running
    await updateJob(jobId, {
      status: 'running',
      started_at: new Date().toISOString()
    });

    await addJobMessage(jobId, 'system', `Starting job for ${repo.owner_name}/${repo.repo_name}`);

    // 1. Ensure bare repo exists
    await addJobMessage(jobId, 'system', `Ensuring bare repository exists...`);
    await ensureBareRepo(repo);

    // 2. Fetch latest
    await addJobMessage(jobId, 'system', `Fetching latest from origin...`);
    await fetchOrigin(repo);

    // 3. Create worktree
    await addJobMessage(jobId, 'system', `Creating worktree: ${job.branch_name}`);
    worktreePath = await createWorktree(repo, job);
    await updateJob(jobId, { worktree_path: worktreePath });

    // 4. Run Claude Code (interactive for tasks, non-interactive for code jobs)
    await addJobMessage(jobId, 'system', `Running Claude Code...`);
    const isInteractive = job.job_type === 'task';

    // For task jobs, prepend client context to the prompt
    let enrichedPrompt = job.prompt;
    if (isInteractive && job.client_id) {
      enrichedPrompt = `[Context: You are working with client ID "${job.client_id}". Use mcp__OpsKings__get_client_context with this client ID to get full context before proceeding.]\n\n${job.prompt}`;
    }

    const result = isInteractive
      ? await runClaudeCodeInteractive(enrichedPrompt, worktreePath, jobId)
      : await runClaudeCode(job.prompt, worktreePath, jobId);

    if (result.exitCode !== 0) {
      throw new Error(result.error || `Claude Code exited with code ${result.exitCode}`);
    }

    // For task jobs: skip git mutations, just complete
    if (job.job_type === 'task') {
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
      });
      await addJobMessage(jobId, 'system', `Task completed successfully.`);
      return;
    }

    // For code jobs (default): commit, push, and create PR
    // 5. Check for changes and commit
    await addJobMessage(jobId, 'system', `Checking for changes...`);
    const hasChanges = await commitAndPush(worktreePath, job);

    if (!hasChanges) {
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        error: 'No changes were made'
      });
      await addJobMessage(jobId, 'system', `Job completed but no changes were made.`);
      return;
    }

    // 6. Create branch record in Supabase
    const branchRecord = await createCodeBranch({
      repositoryId: repo.id,
      featureId: job.feature_id || undefined,
      name: job.branch_name,
      url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`
    });

    // 7. Create PR
    await addJobMessage(jobId, 'system', `Creating pull request...`);
    const pr = await createPullRequest(repo, job, worktreePath);

    // 8. Create PR record in Supabase
    const prRecord = await createCodePullRequest({
      repositoryId: repo.id,
      featureId: job.feature_id || undefined,
      branchId: branchRecord.id,
      number: pr.number,
      title: pr.title,
      status: 'open',
      url: pr.url
    });

    // 9. Update job as completed
    await updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      exit_code: 0,
      pr_url: pr.url,
      pr_number: pr.number,
      files_changed: pr.filesChanged,
      code_branch_id: branchRecord.id,
      code_pull_request_id: prRecord.id
    });

    await addJobMessage(jobId, 'system', `Job completed! PR: ${pr.url}`);

  } catch (err: any) {
    console.error(`Job ${jobId} failed:`, err);

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: err.message || String(err)
    });

    await addJobMessage(jobId, 'system', `Job failed: ${err.message}`);

  } finally {
    // Keep worktree for debugging - will be cleaned up on next job for same branch
  }
}

// ===== Ralph Loop Job Runner =====

const PROGRESS_FILE = '.ralph-progress.md';

export async function runRalphJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // Get repository info
  let repo: CodeRepository | null = null;
  if (job.repository_id) {
    repo = await getRepositoryById(job.repository_id);
  } else {
    repo = await getRepositoryByClientId(job.client_id);
  }

  if (!repo) {
    await updateJob(jobId, {
      status: 'failed',
      error: 'No repository found for client. Add one to code_repositories first.',
      completed_at: new Date().toISOString()
    });
    return;
  }

  // Update job with repository_id if it wasn't set
  if (!job.repository_id) {
    await updateJob(jobId, { repository_id: repo.id });
  }

  const maxIterations = job.max_iterations || 10;
  const completionPromise = job.completion_promise || 'RALPH_COMPLETE';
  const feedbackCommands = (job.feedback_commands as string[] | null) || [];

  let worktreePath: string | null = null;

  try {
    // Update status to running
    await updateJob(jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      current_iteration: 0
    });

    await addJobMessage(jobId, 'system', `Starting Ralph loop for ${repo.owner_name}/${repo.repo_name}`);
    await addJobMessage(jobId, 'system', `Max iterations: ${maxIterations}, Completion promise: "${completionPromise}"`);

    // 1. Setup git
    await addJobMessage(jobId, 'system', `Ensuring bare repository exists...`);
    await ensureBareRepo(repo);

    await addJobMessage(jobId, 'system', `Fetching latest from origin...`);
    await fetchOrigin(repo);

    await addJobMessage(jobId, 'system', `Creating worktree: ${job.branch_name}`);
    worktreePath = await createWorktree(repo, job);
    await updateJob(jobId, { worktree_path: worktreePath });

    // 2. Initialize progress file
    initProgressFile(worktreePath, job.id, job.branch_name);

    // 3. Iteration loop
    let completionReason: RalphCompletionReason | null = null;
    let finalIteration = 0;

    for (let i = 1; i <= maxIterations; i++) {
      finalIteration = i;

      // Check for manual stop request
      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'cancelled') {
        completionReason = 'manual_stop';
        await addJobMessage(jobId, 'system', `Job was cancelled at iteration ${i}`);
        break;
      }

      await updateJob(jobId, { current_iteration: i });
      await addJobMessage(jobId, 'system', `\n========== ITERATION ${i}/${maxIterations} ==========`);

      // Create iteration record
      const iteration = await createIteration(jobId, i);

      // Build iteration prompt
      const iterationPrompt = buildIterationPrompt(
        job.prompt,
        i,
        maxIterations,
        completionPromise,
        worktreePath
      );

      // Run Claude for this iteration (with retry on crash)
      let result = await runClaudeIteration(iterationPrompt, worktreePath, jobId, iteration.id, completionPromise);

      // Retry once on crash
      if (result.exitCode !== 0 && !result.promiseDetected) {
        await addJobMessage(jobId, 'system', `Iteration crashed (exit code ${result.exitCode}), retrying...`);
        result = await runClaudeIteration(iterationPrompt, worktreePath, jobId, iteration.id, completionPromise);
      }

      // Update iteration record
      await updateIteration(iteration.id, {
        completed_at: new Date().toISOString(),
        exit_code: result.exitCode,
        error: result.error,
        prompt_used: iterationPrompt,
        promise_detected: result.promiseDetected,
        output_summary: result.summary
      });

      // Check for completion promise
      if (result.promiseDetected) {
        completionReason = 'promise_detected';
        await addJobMessage(jobId, 'system', `\n✓ Completion promise detected! Task complete.`);
        break;
      }

      // Check for iteration failure (after retry)
      if (result.exitCode !== 0) {
        completionReason = 'iteration_error';
        await addJobMessage(jobId, 'system', `Iteration ${i} failed after retry with exit code ${result.exitCode}`);
        break;
      }

      // Run feedback commands if configured
      let feedbackResults: FeedbackResult[] = [];
      if (feedbackCommands.length > 0) {
        feedbackResults = await runFeedbackCommands(feedbackCommands, worktreePath, jobId);
        await updateIteration(iteration.id, { feedback_results: JSON.parse(JSON.stringify(feedbackResults)) });

        // Append feedback to progress file (both successes and failures)
        appendFeedbackToProgress(worktreePath, feedbackResults, i);
      }

      // Append iteration summary to progress file
      appendIterationToProgress(worktreePath, i, result.summary);

      await addJobMessage(jobId, 'system', `Iteration ${i} complete.`);
    }

    // Reached max iterations without completion promise
    if (!completionReason) {
      completionReason = 'max_iterations';
      await addJobMessage(jobId, 'system', `\nReached maximum iterations (${maxIterations}) without completion.`);
    }

    // 4. Post-loop: Commit, push, create PR
    await addJobMessage(jobId, 'system', `\n========== CREATING PR ==========`);
    const hasChanges = await commitAndPush(worktreePath, job);

    if (hasChanges) {
      const branchRecord = await createCodeBranch({
        repositoryId: repo.id,
        featureId: job.feature_id || undefined,
        name: job.branch_name,
        url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`
      });

      const pr = await createPullRequest(repo, job, worktreePath);

      const prRecord = await createCodePullRequest({
        repositoryId: repo.id,
        featureId: job.feature_id || undefined,
        branchId: branchRecord.id,
        number: pr.number,
        title: pr.title,
        status: 'open',
        url: pr.url
      });

      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        pr_url: pr.url,
        pr_number: pr.number,
        files_changed: pr.filesChanged,
        code_branch_id: branchRecord.id,
        code_pull_request_id: prRecord.id,
        total_iterations: finalIteration,
        completion_reason: completionReason
      });

      await addJobMessage(jobId, 'system', `\nRalph job completed after ${finalIteration} iterations!`);
      await addJobMessage(jobId, 'system', `Completion reason: ${completionReason}`);
      await addJobMessage(jobId, 'system', `PR: ${pr.url}`);
    } else {
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        error: 'No changes were made',
        total_iterations: finalIteration,
        completion_reason: completionReason
      });

      await addJobMessage(jobId, 'system', `\nRalph job completed after ${finalIteration} iterations but no changes were made.`);
    }

  } catch (err: any) {
    console.error(`Ralph job ${jobId} failed:`, err);

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: err.message || String(err),
      completion_reason: 'iteration_error'
    });

    await addJobMessage(jobId, 'system', `Ralph job failed: ${err.message}`);

  } finally {
    // Keep worktree for debugging - will be cleaned up on next job for same branch
  }
}

// Run a single Claude iteration
async function runClaudeIteration(
  prompt: string,
  cwd: string,
  jobId: string,
  iterationId: string,
  completionPromise: string
): Promise<{
  exitCode: number;
  error?: string;
  promiseDetected: boolean;
  summary: string;
}> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      prompt
    ], {
      cwd,
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    runningProcesses.set(jobId, proc);

    if (proc.pid) {
      updateJob(jobId, { pid: proc.pid });
      updateIteration(iterationId, { pid: proc.pid });
    }

    let stdout = '';
    let stderrBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const content = data.toString();
      stdout += content;
      process.stdout.write(content);
      addJobMessage(jobId, 'stdout', content);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const content = data.toString();
      stderrBuffer += content;
      process.stderr.write(content);
      addJobMessage(jobId, 'stderr', content);
    });

    proc.on('close', (code: number | null) => {
      runningProcesses.delete(jobId);

      const promiseDetected = stdout.includes(completionPromise);
      const summary = extractSummary(stdout);

      resolve({
        exitCode: code || 0,
        error: code !== 0 ? stderrBuffer || 'Unknown error' : undefined,
        promiseDetected,
        summary
      });
    });

    proc.on('error', (err: Error) => {
      runningProcesses.delete(jobId);
      resolve({
        exitCode: 1,
        error: err.message,
        promiseDetected: false,
        summary: ''
      });
    });
  });
}

// Build the prompt for each iteration
function buildIterationPrompt(
  basePrompt: string,
  iteration: number,
  maxIterations: number,
  completionPromise: string,
  worktreePath: string
): string {
  const progressContent = readProgressFile(worktreePath);

  return `## Ralph Loop Context
- Iteration: ${iteration} of ${maxIterations}
- To signal completion, output: ${completionPromise}

## Previous Progress
${progressContent || 'No previous progress - this is the first iteration.'}

## Your Task
${basePrompt}

## Instructions
1. Review the progress above from previous iterations
2. Continue working on the task
3. At the end of your work, include a "## Summary" section describing:
   - What you accomplished this iteration
   - What remains to be done (if anything)
4. If the task is fully complete, output "${completionPromise}" after your summary
5. If feedback commands failed in previous iteration, prioritize fixing those issues
6. If you discover important patterns about this codebase (testing conventions, architecture decisions, common pitfalls, useful commands), add them to AGENTS.md in the repo root. Create it if it doesn't exist.
7. Update the "## Codebase Patterns" section in .ralph-progress.md with any patterns you discover during this iteration - these will help future iterations work more efficiently.
`;
}

// Run feedback commands (tests, lint, etc.)
async function runFeedbackCommands(
  commands: string[],
  cwd: string,
  jobId: string
): Promise<FeedbackResult[]> {
  const results: FeedbackResult[] = [];

  for (const command of commands) {
    await addJobMessage(jobId, 'system', `Running feedback: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000 });
      results.push({
        command,
        exitCode: 0,
        stdout: stdout.slice(0, 5000), // Limit output size
        stderr: stderr.slice(0, 5000),
        passed: true
      });
      await addJobMessage(jobId, 'system', `✓ ${command} passed`);
    } catch (err: any) {
      results.push({
        command,
        exitCode: err.code || 1,
        stdout: (err.stdout || '').slice(0, 5000),
        stderr: (err.stderr || err.message || '').slice(0, 5000),
        passed: false
      });
      await addJobMessage(jobId, 'system', `✗ ${command} failed (exit code ${err.code || 1})`);
    }
  }

  return results;
}

// Progress file helpers
function initProgressFile(worktreePath: string, jobId: string, branchName: string): void {
  const progressPath = join(worktreePath, PROGRESS_FILE);
  const content = `# Ralph Progress Log
Job ID: ${jobId}
Branch: ${branchName}
Started: ${new Date().toISOString()}

---

## Codebase Patterns
<!-- Add patterns you discover about this codebase here -->
<!-- These persist across iterations and help future work -->

---
`;
  writeFileSync(progressPath, content);
}

function readProgressFile(worktreePath: string): string {
  const progressPath = join(worktreePath, PROGRESS_FILE);
  if (existsSync(progressPath)) {
    return readFileSync(progressPath, 'utf8');
  }
  return '';
}

function appendIterationToProgress(
  worktreePath: string,
  iteration: number,
  summary: string
): void {
  const progressPath = join(worktreePath, PROGRESS_FILE);
  const content = `
## Iteration ${iteration}
Completed: ${new Date().toISOString()}

### Summary
${summary || 'No summary provided.'}

---
`;
  appendFileSync(progressPath, content);
}

function appendFeedbackToProgress(
  worktreePath: string,
  results: FeedbackResult[],
  iteration: number
): void {
  const progressPath = join(worktreePath, PROGRESS_FILE);

  const feedbackLines = results.map(r => {
    const status = r.passed ? '✓ PASSED' : '✗ FAILED';
    let line = `- \`${r.command}\`: ${status}`;
    if (!r.passed && r.stderr) {
      // Include first few lines of error for context
      const errorPreview = r.stderr.split('\n').slice(0, 5).join('\n  ');
      line += `\n  Error: ${errorPreview}`;
    }
    return line;
  }).join('\n');

  const content = `
### Feedback Results (Iteration ${iteration})
${feedbackLines}

`;
  appendFileSync(progressPath, content);
}

// Extract summary from Claude's output (look for ## Summary section)
function extractSummary(output: string): string {
  // Try to find a ## Summary section
  const summaryMatch = output.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim().slice(0, 2000); // Limit size
  }

  // Fallback: get last meaningful chunk of output
  const lines = output.split('\n').filter(l => l.trim());
  return lines.slice(-10).join('\n').slice(0, 1000);
}

// ===== PRD Mode Runner =====

const PRD_FILE = 'prd.json';

export async function runRalphPrdJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // Get repository info
  let repo: CodeRepository | null = null;
  if (job.repository_id) {
    repo = await getRepositoryById(job.repository_id);
  } else {
    repo = await getRepositoryByClientId(job.client_id);
  }

  if (!repo) {
    await updateJob(jobId, {
      status: 'failed',
      error: 'No repository found for client. Add one to code_repositories first.',
      completed_at: new Date().toISOString()
    });
    return;
  }

  // Update job with repository_id if it wasn't set
  if (!job.repository_id) {
    await updateJob(jobId, { repository_id: repo.id });
  }

  const maxIterations = job.max_iterations || 10;
  // Note: feedbackCommands no longer used - Claude runs tests itself (matching original Ralph pattern)
  const prd = job.prd as unknown as Prd;
  let prdProgress: PrdProgress = (job.prd_progress as unknown as PrdProgress) || {
    currentStoryId: null,
    completedStoryIds: [],
    commits: []
  };

  let worktreePath: string | null = null;

  try {
    // Update status to running
    await updateJob(jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      current_iteration: 0
    });

    await addJobMessage(jobId, 'system', `Starting PRD-mode Ralph job for ${repo.owner_name}/${repo.repo_name}`);
    await addJobMessage(jobId, 'system', `PRD: "${prd.title}" with ${prd.stories.length} stories`);
    await addJobMessage(jobId, 'system', `Max iterations: ${maxIterations}`);

    // 1. Setup git
    await addJobMessage(jobId, 'system', `Ensuring bare repository exists...`);
    await ensureBareRepo(repo);

    await addJobMessage(jobId, 'system', `Fetching latest from origin...`);
    await fetchOrigin(repo);

    await addJobMessage(jobId, 'system', `Creating worktree: ${job.branch_name}`);
    worktreePath = await createWorktree(repo, job);
    await updateJob(jobId, { worktree_path: worktreePath });

    // 2. Check if prd.json already exists (from previous job on this branch)
    const prdPath = join(worktreePath, PRD_FILE);
    if (existsSync(prdPath)) {
      const existingPrd = readPrdFile(worktreePath);

      // Compare with the PRD from the database to ensure it's the same feature
      if (existingPrd.title === prd.title) {
        // Same PRD - sync progress from existing prd.json
        const completedStories = existingPrd.stories.filter(s => s.passes);
        prdProgress.completedStoryIds = completedStories.map(s => s.id);
        prdProgress.currentStoryId = existingPrd.stories.find(s => !s.passes)?.id || null;

        await addJobMessage(jobId, 'system', `Found existing prd.json with ${completedStories.length}/${existingPrd.stories.length} stories complete`);
        await updatePrdProgress(jobId, prdProgress);
      } else {
        // Different PRD (stale file from another feature) - overwrite with correct PRD
        await addJobMessage(jobId, 'system', `Found stale prd.json ("${existingPrd.title}"), replacing with current PRD`);
        writePrdFile(worktreePath, prd);
        initPrdProgressFile(worktreePath, job.id, job.branch_name, prd);
      }
    } else {
      // Fresh start - initialize prd.json and progress file
      writePrdFile(worktreePath, prd);
      initPrdProgressFile(worktreePath, job.id, job.branch_name, prd);
    }

    // 3. Iteration loop
    let completionReason: RalphCompletionReason | null = null;
    let finalIteration = 0;

    for (let i = 1; i <= maxIterations; i++) {
      finalIteration = i;

      // Check for manual stop request
      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'cancelled') {
        completionReason = 'manual_stop';
        await addJobMessage(jobId, 'system', `Job was cancelled at iteration ${i}`);
        break;
      }

      // Check if all stories are complete
      const currentPrd = readPrdFile(worktreePath);
      const incompleteStories = currentPrd.stories.filter(s => !s.passes);

      if (incompleteStories.length === 0) {
        completionReason = 'all_stories_complete';
        await addJobMessage(jobId, 'system', `\n✓ All stories complete!`);
        break;
      }

      await updateJob(jobId, { current_iteration: i });
      await addJobMessage(jobId, 'system', `\n========== ITERATION ${i}/${maxIterations} ==========`);
      await addJobMessage(jobId, 'system', `Incomplete stories: ${incompleteStories.map(s => `#${s.id}`).join(', ')}`);

      // Create iteration record
      const iteration = await createIteration(jobId, i);

      // Build PRD iteration prompt
      const iterationPrompt = buildPrdIterationPrompt(
        job.prompt,
        currentPrd,
        i,
        maxIterations,
        job.branch_name
      );

      // Run Claude for this iteration (with retry on crash)
      // Use <promise>COMPLETE</promise> as signal that ALL stories are done (matches original Ralph)
      let result = await runClaudeIteration(iterationPrompt, worktreePath, jobId, iteration.id, '<promise>COMPLETE</promise>');

      // Retry once on crash
      if (result.exitCode !== 0 && !result.promiseDetected) {
        await addJobMessage(jobId, 'system', `Iteration crashed (exit code ${result.exitCode}), retrying...`);
        result = await runClaudeIteration(iterationPrompt, worktreePath, jobId, iteration.id, '<promise>COMPLETE</promise>');
      }

      // Check for iteration failure (after retry)
      if (result.exitCode !== 0) {
        completionReason = 'iteration_error';
        await addJobMessage(jobId, 'system', `Iteration ${i} failed after retry with exit code ${result.exitCode}`);

        await updateIteration(iteration.id, {
          completed_at: new Date().toISOString(),
          exit_code: result.exitCode,
          error: result.error,
          prompt_used: iterationPrompt,
          promise_detected: false,
          output_summary: result.summary
        });
        break;
      }

      // Check prd.json for newly completed stories (Claude manages this, we just track)
      // IMPORTANT: Do this BEFORE checking promiseDetected so we track commits even if Claude completes all stories
      const updatedPrd = readPrdFile(worktreePath);
      const newlyCompleted = findNewlyCompletedStories(prdProgress.completedStoryIds, updatedPrd.stories);

      // Process ALL newly completed stories
      if (newlyCompleted.length > 0) {
        await addJobMessage(jobId, 'system', `Completed ${newlyCompleted.length} stories this iteration`);

        for (const story of newlyCompleted) {
          // Try to find the commit Claude made for this story
          let commitSha: string | null = null;
          try {
            const { stdout } = await execAsync(
              `git log --oneline -1 --grep="story-${story.id}" --format="%H"`,
              { cwd: worktreePath }
            );
            commitSha = stdout.trim() || null;
          } catch {
            // No commit found for this story
          }

          // If no story-specific commit found, check for any new commit since last known
          if (!commitSha) {
            try {
              const lastKnownCommit = prdProgress.commits[prdProgress.commits.length - 1]?.sha;
              const { stdout } = await execAsync(
                lastKnownCommit
                  ? `git log --oneline -1 ${lastKnownCommit}..HEAD --format="%H"`
                  : `git log --oneline -1 --format="%H"`,
                { cwd: worktreePath }
              );
              commitSha = stdout.trim() || null;
            } catch {
              // No commit found
            }
          }

          if (commitSha) {
            const prdCommit: PrdCommit = {
              storyId: story.id,
              sha: commitSha,
              message: `feat(story-${story.id}): ${story.title}`,
              timestamp: new Date().toISOString()
            };

            prdProgress.commits.push(prdCommit);
            prdProgress.completedStoryIds.push(story.id);

            await addJobMessage(jobId, 'system', `✓ Story #${story.id} committed: ${commitSha.substring(0, 7)}`);
          } else {
            // Story marked complete but no commit found - still track it
            prdProgress.completedStoryIds.push(story.id);
            await addJobMessage(jobId, 'system', `✓ Story #${story.id} marked complete (no commit found)`);
          }

          // Update todo status in database (story.id is 1-indexed, order_index is 0-indexed)
          if (job.feature_id) {
            try {
              const orderIndex = story.id - 1; // Convert 1-indexed story ID to 0-indexed order_index
              await updateTodoStatusByFeatureAndOrder(job.feature_id, orderIndex, 'done');
              await addJobMessage(jobId, 'system', `Updated todo (order_index=${orderIndex}) status to done`);
            } catch (err) {
              await addJobMessage(jobId, 'system', `Warning: Failed to update todo status: ${err}`);
            }
          }
        }

        // Update iteration with first story info (for backwards compatibility)
        const firstStory = newlyCompleted[0];
        const firstCommit = prdProgress.commits.find(c => c.storyId === firstStory.id);
        if (firstCommit) {
          await updateIteration(iteration.id, {
            story_id: firstStory.id,
            commit_sha: firstCommit.sha
          });
        }
      }

      // Update current story being worked on (first incomplete)
      const nextIncomplete = updatedPrd.stories.find(s => !s.passes);
      prdProgress.currentStoryId = nextIncomplete?.id || null;

      // Save progress to database
      await updatePrdProgress(jobId, prdProgress);

      // Update iteration record
      await updateIteration(iteration.id, {
        completed_at: new Date().toISOString(),
        exit_code: result.exitCode,
        prompt_used: iterationPrompt,
        promise_detected: result.promiseDetected || newlyCompleted.length > 0,
        output_summary: result.summary
      });

      // Append to progress file (no feedback results - Claude runs tests itself)
      appendPrdIterationToProgress(worktreePath, i, result.summary, newlyCompleted, []);

      // Push after each iteration to save progress (prevents losing work if job crashes later)
      if (newlyCompleted.length > 0) {
        try {
          pushBranch(worktreePath, job.branch_name);
          await addJobMessage(jobId, 'system', `Pushed commits to origin/${job.branch_name}`);
        } catch (err) {
          await addJobMessage(jobId, 'system', `Warning: Failed to push: ${err}`);
        }
      }

      await addJobMessage(jobId, 'system', `Iteration ${i} complete. Completed stories: ${prdProgress.completedStoryIds.length}/${prd.stories.length}`);

      // Check if Claude signaled ALL stories complete - break AFTER tracking commits
      if (result.promiseDetected) {
        completionReason = 'promise_detected';
        await addJobMessage(jobId, 'system', `Claude signaled ALL stories complete with <promise>COMPLETE</promise>`);
        break;
      }
    }

    // Reached max iterations without completing all stories
    if (!completionReason) {
      completionReason = 'max_iterations';
      await addJobMessage(jobId, 'system', `\nReached maximum iterations (${maxIterations}) without completing all stories.`);
    }

    // 4. Post-loop: Sync final state from prd.json to database
    await addJobMessage(jobId, 'system', `\n========== SYNCING FINAL STATE ==========`);

    // Read final prd.json state from worktree
    const finalPrd = readPrdFile(worktreePath);
    const finalCompletedStories = finalPrd.stories.filter(s => s.passes);
    prdProgress.completedStoryIds = finalCompletedStories.map(s => s.id);

    // Sync todo statuses from prd.json (if feature_id exists)
    if (job.feature_id) {
      try {
        const syncResult = await syncTodosFromPrd(job.feature_id, finalPrd.stories);
        await addJobMessage(jobId, 'system', `Synced ${syncResult.updated} todos from prd.json`);
      } catch (err) {
        await addJobMessage(jobId, 'system', `Warning: Failed to sync todos: ${err}`);
      }
    }

    // 5. Post-loop: Create PR (commits already pushed after each iteration)
    await addJobMessage(jobId, 'system', `\n========== CREATING PR ==========`);

    if (prdProgress.commits.length > 0) {
      const branchRecord = await createCodeBranch({
        repositoryId: repo.id,
        featureId: job.feature_id || undefined,
        name: job.branch_name,
        url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`
      });

      const pr = await createPullRequest(repo, job, worktreePath);

      const prRecord = await createCodePullRequest({
        repositoryId: repo.id,
        featureId: job.feature_id || undefined,
        branchId: branchRecord.id,
        number: pr.number,
        title: pr.title,
        status: 'open',
        url: pr.url
      });

      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        pr_url: pr.url,
        pr_number: pr.number,
        files_changed: pr.filesChanged,
        code_branch_id: branchRecord.id,
        code_pull_request_id: prRecord.id,
        total_iterations: finalIteration,
        completion_reason: completionReason,
        prd_progress: JSON.parse(JSON.stringify(prdProgress))
      });

      await addJobMessage(jobId, 'system', `\nPRD job completed after ${finalIteration} iterations!`);
      await addJobMessage(jobId, 'system', `Completion reason: ${completionReason}`);
      await addJobMessage(jobId, 'system', `Stories completed: ${prdProgress.completedStoryIds.length}/${prd.stories.length}`);
      await addJobMessage(jobId, 'system', `Commits: ${prdProgress.commits.length}`);
      await addJobMessage(jobId, 'system', `PR: ${pr.url}`);

      // Update feature workflow stage to "Ready for Review"
      if (job.feature_id) {
        try {
          await updateFeatureWorkflowStage(job.feature_id, WORKFLOW_STAGE_READY_FOR_REVIEW);
          await addJobMessage(jobId, 'system', `Updated feature workflow stage to "Ready for Review"`);
        } catch (err) {
          await addJobMessage(jobId, 'system', `Warning: Failed to update feature workflow stage: ${err}`);
        }
      }
    } else {
      await updateJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        exit_code: 0,
        error: 'No stories were completed',
        total_iterations: finalIteration,
        completion_reason: completionReason,
        prd_progress: JSON.parse(JSON.stringify(prdProgress))
      });

      await addJobMessage(jobId, 'system', `\nPRD job completed after ${finalIteration} iterations but no stories were completed.`);
    }

  } catch (err: any) {
    console.error(`PRD job ${jobId} failed:`, err);

    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: err.message || String(err),
      completion_reason: 'iteration_error',
      prd_progress: JSON.parse(JSON.stringify(prdProgress))
    });

    await addJobMessage(jobId, 'system', `PRD job failed: ${err.message}`);

  } finally {
    // Keep worktree for debugging - will be cleaned up on next job for same branch
  }
}

// PRD file helpers
function writePrdFile(worktreePath: string, prd: Prd): void {
  const prdPath = join(worktreePath, PRD_FILE);
  writeFileSync(prdPath, JSON.stringify(prd, null, 2));
}

function readPrdFile(worktreePath: string): Prd {
  const prdPath = join(worktreePath, PRD_FILE);
  if (existsSync(prdPath)) {
    return JSON.parse(readFileSync(prdPath, 'utf8'));
  }
  throw new Error('prd.json not found in worktree');
}

function findNewlyCompletedStories(
  previouslyCompleted: number[],
  currentStories: PrdStory[]
): PrdStory[] {
  return currentStories.filter(
    story => story.passes && !previouslyCompleted.includes(story.id)
  );
}

function initPrdProgressFile(
  worktreePath: string,
  jobId: string,
  branchName: string,
  prd: Prd
): void {
  const progressPath = join(worktreePath, PROGRESS_FILE);

  const storiesList = prd.stories.map(s =>
    `- [ ] Story #${s.id}: ${s.title}`
  ).join('\n');

  const content = `# PRD Progress Log
Job ID: ${jobId}
Branch: ${branchName}
Started: ${new Date().toISOString()}

## PRD: ${prd.title}
${prd.description || ''}

## Stories
${storiesList}

---

## Codebase Patterns
<!-- Add patterns you discover about this codebase here -->
<!-- These persist across iterations and help future work -->

---
`;
  writeFileSync(progressPath, content);
}

function buildPrdIterationPrompt(
  basePrompt: string,
  prd: Prd,
  iteration: number,
  maxIterations: number,
  branchName: string
): string {
  // Simplified prompt matching original Ralph pattern
  // Claude reads prd.json and progress.txt itself, runs tests itself
  return `# Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

## Context
- Iteration: ${iteration} of ${maxIterations}
- PRD: "${prd.title}"
- Branch: ${branchName}

## Your Task
${basePrompt}

## Workflow
1. Read the PRD at \`prd.json\` in the repo root
2. Read the progress log at \`progress.txt\` (check Codebase Patterns section first)
3. Check you're on the correct branch (${branchName}). If not, check it out.
4. **Install dependencies if needed** (check for node_modules, vendor, etc. - run npm/bun/pip install if missing)
5. Pick the **highest priority** user story where \`passes: false\`
6. Implement that single user story
7. Run quality checks (typecheck, lint, test - use whatever your project requires)
8. Update AGENTS.md files if you discover reusable patterns
9. If checks pass, commit ALL changes with message: \`feat: [Story ID] - [Story Title]\`
10. Update prd.json to set \`passes: true\` for the completed story
11. Append your progress to \`progress.txt\`

## Progress Report Format
APPEND to progress.txt (never replace, always append):
\`\`\`
## [Date/Time] - Story #X
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
---
\`\`\`

The learnings section is critical - it helps future iterations avoid repeating mistakes.

## Consolidate Patterns
If you discover a **reusable pattern**, add it to the \`## Codebase Patterns\` section at the TOP of progress.txt:
\`\`\`
## Codebase Patterns
- Example: Use \`sql<number>\` template for aggregations
- Example: Always use \`IF NOT EXISTS\` for migrations
\`\`\`

## Update AGENTS.md Files
Before committing, check if edited directories have learnings worth preserving in nearby AGENTS.md files.
Only add genuinely reusable knowledge that would help future work in that directory.

## Quality Requirements
- ALL commits must pass your project's quality checks (typecheck, lint, test)
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns

## If Quality Checks Fail
If typecheck, lint, or tests fail:
1. **Fix the issues** - don't just skip them
2. Re-run the checks until they pass
3. Only then commit and update prd.json
4. If you cannot fix the issue after multiple attempts, document it in progress.txt and move on (do NOT mark the story as passing)

## Stop Condition
After completing a user story, check if ALL stories have \`passes: true\`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with \`passes: false\`, end your response normally (another iteration will pick up the next story).

## CRITICAL: One Story Per Iteration
**You MUST only work on ONE story per iteration. This is non-negotiable.**

After completing ONE story:
1. Commit your changes
2. Update prd.json to mark that ONE story as \`passes: true\`
3. Update progress.txt
4. Check if ALL stories are now complete
5. If all complete: output \`<promise>COMPLETE</promise>\`
6. If not all complete: **STOP IMMEDIATELY** - do NOT continue to the next story

The orchestrator will start a new iteration for the next story. Do NOT try to be efficient by doing multiple stories - this breaks the tracking system.

## Other Guidelines
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
`;
}

function appendPrdIterationToProgress(
  worktreePath: string,
  iteration: number,
  summary: string,
  completedStories: PrdStory[],
  feedbackResults: FeedbackResult[]
): void {
  const progressPath = join(worktreePath, PROGRESS_FILE);

  const completedList = completedStories.length > 0
    ? `\n### Completed Stories\n${completedStories.map(s => `- Story #${s.id}: ${s.title}`).join('\n')}`
    : '';

  const feedbackLines = feedbackResults.length > 0
    ? `\n### Feedback Results\n${feedbackResults.map(r => {
        const status = r.passed ? '✓ PASSED' : '✗ FAILED';
        let line = `- \`${r.command}\`: ${status}`;
        if (!r.passed && r.stderr) {
          const errorPreview = r.stderr.split('\n').slice(0, 3).join('\n  ');
          line += `\n  Error: ${errorPreview}`;
        }
        return line;
      }).join('\n')}`
    : '';

  const content = `
## Iteration ${iteration}
Completed: ${new Date().toISOString()}
${completedList}

### Summary
${summary || 'No summary provided.'}
${feedbackLines}

---
`;
  appendFileSync(progressPath, content);
}

// ===== Standard Job Runner =====

async function runClaudeCode(
  prompt: string,
  cwd: string,
  jobId: string
): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    console.log(`Starting Claude Code for job ${jobId}...`);

    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      prompt
    ], {
      cwd,
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Store process for cancellation
    runningProcesses.set(jobId, proc);

    // Store PID
    if (proc.pid) {
      updateJob(jobId, { pid: proc.pid });
    }

    let stderrBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const content = data.toString();
      process.stdout.write(content); // Log to console
      addJobMessage(jobId, 'stdout', content);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const content = data.toString();
      process.stderr.write(content); // Log to console
      stderrBuffer += content;
      addJobMessage(jobId, 'stderr', content);
    });

    proc.on('close', (code: number | null) => {
      runningProcesses.delete(jobId);
      resolve({
        exitCode: code || 0,
        error: code !== 0 ? stderrBuffer || 'Unknown error' : undefined
      });
    });

    proc.on('error', (err: Error) => {
      runningProcesses.delete(jobId);
      resolve({
        exitCode: 1,
        error: err.message
      });
    });
  });
}

// Interactive version for task jobs - allows sending messages via stdin
async function runClaudeCodeInteractive(
  prompt: string,
  cwd: string,
  jobId: string
): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    console.log(`Starting Claude Code (interactive) for job ${jobId}...`);

    // Use --input-format stream-json to allow sending follow-up messages via stdin
    // Restrict built-in tools to read-only (no Edit, Write, Bash) but allow all MCP tools
    // --disallowedTools blocks specific tools while keeping MCP servers available
    // --mcp-config loads the MCP servers configuration
    const mcpConfig = JSON.stringify({
      mcpServers: {
        OpsKings: {
          type: 'http',
          url: 'https://os-mcp.vercel.app/api/mcp'
        }
      }
    });

    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--disallowedTools', 'Edit,Write,Bash,NotebookEdit,MultiEdit',
      '--mcp-config', mcpConfig
    ], {
      cwd,
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send initial prompt as JSON (stream-json format requires nested message object)
    const initialMessage = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt }
    }) + '\n';
    proc.stdin?.write(initialMessage);

    // Store process for cancellation and message sending
    runningProcesses.set(jobId, proc);
    interactiveProcesses.set(jobId, proc);

    // Store PID
    if (proc.pid) {
      updateJob(jobId, { pid: proc.pid });
    }

    let stderrBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const content = data.toString();
      process.stdout.write(content); // Log to console
      addJobMessage(jobId, 'stdout', content);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const content = data.toString();
      process.stderr.write(content); // Log to console
      stderrBuffer += content;
      addJobMessage(jobId, 'stderr', content);
    });

    proc.on('close', (code: number | null) => {
      runningProcesses.delete(jobId);
      interactiveProcesses.delete(jobId);
      resolve({
        exitCode: code || 0,
        error: code !== 0 ? stderrBuffer || 'Unknown error' : undefined
      });
    });

    proc.on('error', (err: Error) => {
      runningProcesses.delete(jobId);
      interactiveProcesses.delete(jobId);
      resolve({
        exitCode: 1,
        error: err.message
      });
    });
  });
}

// Send a message to an interactive task job
export function sendMessageToJob(jobId: string, message: string): boolean {
  const proc = interactiveProcesses.get(jobId);

  if (!proc || !proc.stdin) {
    console.error(`No interactive process found for job ${jobId}`);
    return false;
  }

  console.log(`Sending message to job ${jobId}: ${message}`);
  addJobMessage(jobId, 'user_input', message);

  // Send as JSON for stream-json input format (requires nested message object)
  const jsonMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: message }
  }) + '\n';
  proc.stdin.write(jsonMessage);
  return true;
}

// End an interactive task job session (closes stdin to signal completion)
export function endInteractiveJob(jobId: string): boolean {
  const proc = interactiveProcesses.get(jobId);

  if (!proc || !proc.stdin) {
    console.error(`No interactive process found for job ${jobId}`);
    return false;
  }

  console.log(`Ending interactive session for job ${jobId}...`);
  addJobMessage(jobId, 'system', 'User ended the interactive session.');

  // Close stdin to signal end of input - Claude will finish and exit
  proc.stdin.end();
  return true;
}

// Check if a job is interactive (accepts messages)
export function isJobInteractive(jobId: string): boolean {
  return interactiveProcesses.has(jobId);
}

export function cancelJob(jobId: string): boolean {
  const proc = runningProcesses.get(jobId);

  if (proc) {
    console.log(`Cancelling job ${jobId}...`);
    proc.kill('SIGTERM');

    setTimeout(() => {
      if (runningProcesses.has(jobId)) {
        proc.kill('SIGKILL');
        runningProcesses.delete(jobId);
      }
    }, 5000);

    return true;
  }

  return false;
}

export function isJobRunning(jobId: string): boolean {
  return runningProcesses.has(jobId);
}

export function getRunningJobIds(): string[] {
  return Array.from(runningProcesses.keys());
}

export async function checkClaudeAuth(): Promise<{
  authenticated: boolean;
  version: string | null;
  loginType: 'subscription' | 'api_key' | null;
}> {
  // Get version
  const versionResult = await new Promise<{ version: string | null; authenticated: boolean }>((resolve) => {
    const proc = spawn(CLAUDE_BIN, ['--version'], {
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', (code: number | null) => {
      resolve({
        authenticated: code === 0,
        version: code === 0 ? output.trim().split('\n')[0] || null : null
      });
    });

    proc.on('error', () => {
      resolve({ authenticated: false, version: null });
    });
  });

  if (!versionResult.authenticated) {
    return {
      authenticated: false,
      version: null,
      loginType: null,
    };
  }

  // Get account info by reading Claude's settings file
  let loginType: 'subscription' | 'api_key' | null = 'subscription';

  try {
    // Check for API key in environment first
    if (process.env.ANTHROPIC_API_KEY) {
      loginType = 'api_key';
    } else {
      // Read Claude's settings file for account info
      const settingsPath = join(HOME_DIR, '.claude', 'settings.json');
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        const hasApiKey = settings.apiKey || settings.anthropicApiKey;
        loginType = hasApiKey ? 'api_key' : 'subscription';
      } else {
        // Check auth.json for account details
        const authPath = join(HOME_DIR, '.claude', 'auth.json');
        if (existsSync(authPath)) {
          const auth = JSON.parse(readFileSync(authPath, 'utf8'));
          loginType = auth.apiKey ? 'api_key' : 'subscription';
        }
      }
    }
  } catch {
    // Keep defaults
  }

  return {
    authenticated: true,
    version: versionResult.version,
    loginType
  };  
}
