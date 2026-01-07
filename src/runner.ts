import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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
