import { spawn, ChildProcess } from 'child_process';
import {
  getJob,
  getRepositoryByClientId,
  getRepositoryById,
  updateJob,
  addJobMessage,
  createCodeBranch,
  createCodePullRequest,
  type CodeRepository
} from './db/index.js';
import {
  ensureBareRepo,
  fetchOrigin,
  createWorktree,
  removeWorktree,
  commitAndPush,
  createPullRequest
} from './git.js';

const HOME_DIR = process.env.HOME || '/Users/david';

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

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

    // 4. Run Claude Code
    await addJobMessage(jobId, 'system', `Running Claude Code...`);
    const result = await runClaudeCode(job.prompt, worktreePath, jobId);

    if (result.exitCode !== 0) {
      throw new Error(result.error || `Claude Code exited with code ${result.exitCode}`);
    }

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
    // Cleanup worktree
    if (worktreePath && repo) {
      try {
        await removeWorktree(repo, worktreePath);
      } catch (cleanupErr) {
        console.error(`Failed to cleanup worktree:`, cleanupErr);
      }
    }
  }
}

async function runClaudeCode(
  prompt: string,
  cwd: string,
  jobId: string
): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    console.log(`Starting Claude Code for job ${jobId}...`);

    const proc = spawn('claude', [
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

export async function checkClaudeAuth(): Promise<{ authenticated: boolean; version: string | null }> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], {
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let version = '';

    proc.stdout.on('data', (data: Buffer) => {
      version += data.toString();
    });

    proc.on('close', (code: number | null) => {
      resolve({
        authenticated: code === 0,
        version: code === 0 ? version.trim() || null : null
      });
    });

    proc.on('error', () => {
      resolve({ authenticated: false, version: null });
    });
  });
}
