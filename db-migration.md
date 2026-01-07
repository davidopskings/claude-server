# Agent Server Migration: SQLite → Supabase

## Overview

Migrate the agent server from local SQLite to your existing Supabase database. This eliminates the need for a separate `clients` table on the agent server since you already have `clients` and `code_repositories` as well as `agent_jobs` and `agent_job_messages` in Supabase.

## Database Changes


### 2. Ensure code_repositories has your repos

Your agent server will look up repo info from `code_repositories`. Make sure each client has their repo registered:

```sql
-- Example: Add a repository for a client
INSERT INTO code_repositories (client_id, provider, owner_name, repo_name, default_branch, url)
VALUES (
  'e897788c-afc6-4218-be48-703f2955cb0f',  -- client_id
  'github',
  'SupportKings',
  'french-language-solutions',
  'main',
  'https://github.com/SupportKings/french-language-solutions'
);
```

---

## Code Changes

### 1. Environment Variables

Remove SQLite, add Supabase:

```bash
# Remove
# DATABASE_PATH=./agent.db

# Add
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # Service role key (not anon key)
```

### 2. Generate Supabase Types

```bash
# Install Supabase CLI if you haven't
npm install -g supabase

# Login
supabase login

# Generate types (run after creating agent_jobs tables)
supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/supabase.ts
```

### 3. Create Database Module

New file structure:

```
src/
├── types/
│   └── supabase.ts      # Generated from Supabase CLI
├── db/
│   ├── client.ts        # Supabase client instance
│   ├── types.ts         # Re-export convenience types
│   ├── queries.ts       # All query functions
│   └── index.ts         # Barrel export
└── ...
```

#### src/db/client.ts

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase.js';

export const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
```

#### src/db/types.ts

```typescript
import type { Database } from '../types/supabase.js';

// Table row types
export type Client = Database['public']['Tables']['clients']['Row'];
export type Feature = Database['public']['Tables']['features']['Row'];
export type CodeRepository = Database['public']['Tables']['code_repositories']['Row'];
export type CodeBranch = Database['public']['Tables']['code_branches']['Row'];
export type CodePullRequest = Database['public']['Tables']['code_pull_requests']['Row'];
export type AgentJob = Database['public']['Tables']['agent_jobs']['Row'];
export type AgentJobMessage = Database['public']['Tables']['agent_job_messages']['Row'];

// Insert types
export type AgentJobInsert = Database['public']['Tables']['agent_jobs']['Insert'];
export type CodeBranchInsert = Database['public']['Tables']['code_branches']['Insert'];
export type CodePullRequestInsert = Database['public']['Tables']['code_pull_requests']['Insert'];
export type CodeRepositoryInsert = Database['public']['Tables']['code_repositories']['Insert'];

// Update types
export type AgentJobUpdate = Database['public']['Tables']['agent_jobs']['Update'];

// Custom query return types (for joins)
export type JobWithDetails = AgentJob & {
  client: Pick<Client, 'id' | 'name'> | null;
  feature: Pick<Feature, 'id' | 'title'> | null;
  repository: Pick<CodeRepository, 'id' | 'owner_name' | 'repo_name' | 'default_branch'> | null;
};

export type ClientWithRepositories = Pick<Client, 'id' | 'name'> & {
  repositories: Pick<CodeRepository, 'id' | 'owner_name' | 'repo_name' | 'default_branch'>[];
};
```

#### src/db/queries.ts

```typescript
import { supabase } from './client.js';
import type {
  AgentJob,
  AgentJobInsert,
  AgentJobUpdate,
  AgentJobMessage,
  CodeRepository,
  CodeBranchInsert,
  CodePullRequestInsert,
  JobWithDetails,
  ClientWithRepositories
} from './types.js';

// ----- Repositories -----

export async function getRepositoryByClientId(clientId: string): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', 'github')
    .limit(1)
    .single();
  
  return data;
}

export async function getRepositoryById(id: string): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('id', id)
    .single();
  
  return data;
}

export async function getRepositoryByGitHub(
  ownerName: string, 
  repoName: string
): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('owner_name', ownerName)
    .eq('repo_name', repoName)
    .limit(1)
    .single();
  
  return data;
}

export async function createRepository(repo: {
  clientId: string;
  ownerName: string;
  repoName: string;
  defaultBranch?: string;
}): Promise<CodeRepository> {
  const { data, error } = await supabase
    .from('code_repositories')
    .insert({
      client_id: repo.clientId,
      provider: 'github',
      owner_name: repo.ownerName,
      repo_name: repo.repoName,
      default_branch: repo.defaultBranch || 'main',
      url: `https://github.com/${repo.ownerName}/${repo.repoName}`
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ----- Jobs -----

export async function getJob(id: string): Promise<AgentJob | null> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('id', id)
    .single();
  
  return data;
}

export async function getJobWithDetails(id: string): Promise<JobWithDetails | null> {
  const { data } = await supabase
    .from('agent_jobs')
    .select(`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name, default_branch)
    `)
    .eq('id', id)
    .single();
  
  return data as JobWithDetails | null;
}

export async function listJobs(filters?: {
  status?: string[];
  clientId?: string;
  featureId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ jobs: JobWithDetails[]; total: number }> {
  let query = supabase
    .from('agent_jobs')
    .select(`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false });
  
  if (filters?.status?.length) {
    query = query.in('status', filters.status);
  }
  if (filters?.clientId) {
    query = query.eq('client_id', filters.clientId);
  }
  if (filters?.featureId) {
    query = query.eq('feature_id', filters.featureId);
  }
  
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  query = query.range(offset, offset + limit - 1);
  
  const { data, count } = await query;
  return { jobs: (data as JobWithDetails[]) || [], total: count || 0 };
}

export async function getQueuedJobs(): Promise<AgentJob[]> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });
  
  return data || [];
}

export async function getRunningJobs(): Promise<AgentJob[]> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'running');
  
  return data || [];
}

export async function createJob(job: {
  clientId: string;
  featureId?: string;
  repositoryId?: string;
  prompt: string;
  branchName: string;
  title?: string;
  createdByTeamMemberId?: string;
}): Promise<AgentJob> {
  const insert: AgentJobInsert = {
    client_id: job.clientId,
    feature_id: job.featureId,
    repository_id: job.repositoryId,
    prompt: job.prompt,
    branch_name: job.branchName,
    title: job.title,
    created_by_team_member_id: job.createdByTeamMemberId,
    status: 'queued'
  };

  const { data, error } = await supabase
    .from('agent_jobs')
    .insert(insert)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateJob(id: string, updates: AgentJobUpdate): Promise<void> {
  const { error } = await supabase
    .from('agent_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  
  if (error) throw error;
}

// ----- Job Messages -----

export async function addJobMessage(
  jobId: string, 
  type: 'stdout' | 'stderr' | 'system', 
  content: string
): Promise<void> {
  await supabase
    .from('agent_job_messages')
    .insert({ job_id: jobId, type, content });
}

export async function getJobMessages(jobId: string): Promise<AgentJobMessage[]> {
  const { data } = await supabase
    .from('agent_job_messages')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  
  return data || [];
}

// ----- Branches & PRs -----

export async function createCodeBranch(branch: CodeBranchInsert): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('code_branches')
    .insert(branch)
    .select('id')
    .single();
  
  if (error) throw error;
  return data;
}

export async function createCodePullRequest(pr: CodePullRequestInsert): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('code_pull_requests')
    .insert(pr)
    .select('id')
    .single();
  
  if (error) throw error;
  return data;
}

// ----- Clients -----

export async function getClient(id: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .single();
  
  return data;
}

export async function listClients(): Promise<ClientWithRepositories[]> {
  const { data } = await supabase
    .from('clients')
    .select(`
      id,
      name,
      repositories:code_repositories(id, owner_name, repo_name, default_branch)
    `)
    .order('name');
  
  return (data as ClientWithRepositories[]) || [];
}
```

#### src/db/index.ts

```typescript
export { supabase } from './client.js';
export * from './types.js';
export * from './queries.js';
```

### 3. Update runner.ts

```typescript
// src/runner.ts
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  getJob,
  getRepositoryByClientId,
  getRepositoryById,
  updateJob,
  addJobMessage,
  createCodeBranch,
  createCodePullRequest,
  type CodeRepository,
  type AgentJob
} from './db/index.js';

const REPOS_DIR = process.env.REPOS_DIR || '/Users/david/repos';
const WORKTREES_DIR = process.env.WORKTREES_DIR || '/Users/david/worktrees';
const HOME_DIR = process.env.HOME || '/Users/david';

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
    await updateJob(jobId, { repository_id: repo.id } as any);
  }
  
  const barePath = `${REPOS_DIR}/${repo.repo_name}.git`;
  const worktreePath = `${WORKTREES_DIR}/${repo.repo_name}/${jobId}`;
  const defaultBranch = repo.default_branch || 'main';
  
  try {
    // Update status to running
    await updateJob(jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      worktree_path: worktreePath
    });
    
    await addJobMessage(jobId, 'system', `Starting job for ${repo.owner_name}/${repo.repo_name}`);
    
    // 1. Ensure bare repo exists
    if (!existsSync(barePath)) {
      await addJobMessage(jobId, 'system', `Cloning bare repository...`);
      execSync(
        `git clone --bare git@github.com:${repo.owner_name}/${repo.repo_name}.git ${barePath}`,
        { stdio: 'pipe' }
      );
    }
    
    // 2. Fetch latest
    await addJobMessage(jobId, 'system', `Fetching latest from origin...`);
    execSync('git fetch origin --prune', { cwd: barePath, stdio: 'pipe' });
    
    // 3. Create worktree
    await addJobMessage(jobId, 'system', `Creating worktree: ${job.branch_name}`);
    mkdirSync(dirname(worktreePath), { recursive: true });
    execSync(
      `git worktree add -b ${job.branch_name} ${worktreePath} origin/${defaultBranch}`,
      { cwd: barePath, stdio: 'pipe' }
    );
    
    // 4. Run Claude Code
    await addJobMessage(jobId, 'system', `Running Claude Code...`);
    const result = await runClaudeCode(job.prompt, worktreePath, jobId);
    
    if (result.exitCode !== 0) {
      throw new Error(result.error || `Claude Code exited with code ${result.exitCode}`);
    }
    
    // 5. Check for changes and commit
    await addJobMessage(jobId, 'system', `Committing changes...`);
    const hasChanges = await commitChanges(worktreePath, job);
    
    // 6. Push branch
    await addJobMessage(jobId, 'system', `Pushing to origin...`);
    execSync(`git push -u origin ${job.branch_name}`, { cwd: worktreePath, stdio: 'pipe' });
    
    // 7. Create branch record in Supabase
    const branchRecord = await createCodeBranch({
      repositoryId: repo.id,
      featureId: job.feature_id || undefined,
      name: job.branch_name,
      url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`
    });
    
    // 8. Create PR
    await addJobMessage(jobId, 'system', `Creating pull request...`);
    const pr = await createPullRequest(repo, job, worktreePath);
    
    // 9. Create PR record in Supabase
    const prRecord = await createCodePullRequest({
      repositoryId: repo.id,
      featureId: job.feature_id || undefined,
      branchId: branchRecord.id,
      number: pr.number,
      title: pr.title,
      status: 'open',
      url: pr.url
    });
    
    // 10. Update job as completed
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
    
    await addJobMessage(jobId, 'system', `✓ Job completed! PR: ${pr.url}`);
    
  } catch (err: any) {
    console.error(`Job ${jobId} failed:`, err);
    
    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: err.message || String(err)
    });
    
    await addJobMessage(jobId, 'system', `✗ Job failed: ${err.message}`);
    
  } finally {
    // Cleanup worktree
    try {
      if (existsSync(worktreePath)) {
        execSync(`git worktree remove --force ${worktreePath}`, { cwd: barePath, stdio: 'pipe' });
      }
    } catch (cleanupErr) {
      console.error(`Failed to cleanup worktree:`, cleanupErr);
    }
  }
}

async function runClaudeCode(
  prompt: string,
  cwd: string,
  jobId: string
): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--print', prompt], {
      cwd,
      env: { ...process.env, HOME: HOME_DIR }
    });
    
    // Store PID
    updateJob(jobId, { pid: proc.pid });
    
    let stderrBuffer = '';
    
    proc.stdout.on('data', (data) => {
      const content = data.toString();
      addJobMessage(jobId, 'stdout', content);
    });
    
    proc.stderr.on('data', (data) => {
      const content = data.toString();
      stderrBuffer += content;
      addJobMessage(jobId, 'stderr', content);
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code || 0,
        error: code !== 0 ? stderrBuffer || 'Unknown error' : undefined
      });
    });
    
    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        error: err.message
      });
    });
  });
}

async function commitChanges(worktreePath: string, job: AgentJob): Promise<boolean> {
  // Stage all changes
  execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });
  
  // Check if there are changes
  try {
    execSync('git diff --cached --quiet', { cwd: worktreePath, stdio: 'pipe' });
    // No changes
    return false;
  } catch {
    // Has changes - commit them
    const message = job.title || `feat: ${job.branch_name}`;
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath,
      stdio: 'pipe'
    });
    return true;
  }
}

async function createPullRequest(
  repo: CodeRepository,
  job: AgentJob,
  worktreePath: string
): Promise<{ url: string; number: number; title: string; filesChanged: number }> {
  const title = job.title || job.branch_name;
  const body = [
    'Automated by Claude Code Agent',
    '',
    job.feature_id ? `Feature ID: ${job.feature_id}` : null,
    `Job ID: ${job.id}`
  ].filter(Boolean).join('\n');
  
  // Create PR using gh CLI
  const prUrl = execSync(
    `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head ${job.branch_name} --base ${repo.default_branch || 'main'}`,
    { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  
  // Extract PR number from URL
  const prNumber = parseInt(prUrl.split('/').pop() || '0');
  
  // Get files changed count
  let filesChanged = 0;
  try {
    const filesOutput = execSync(
      `gh pr view ${prNumber} --json files --jq '.files | length'`,
      { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    filesChanged = parseInt(filesOutput.trim()) || 0;
  } catch {
    // Ignore errors getting file count
  }
  
  return { url: prUrl, number: prNumber, title, filesChanged };
}
```

### 4. Update queue.ts

```typescript
// src/queue.ts
import { getQueuedJobs, getRunningJobs, updateJob } from './db/index.js';
import { runJob } from './runner.js';

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '2');

let processing = false;

export async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  
  try {
    const running = await getRunningJobs();
    
    if (running.length >= MAX_CONCURRENT) {
      return;
    }
    
    const queued = await getQueuedJobs();
    const slotsAvailable = MAX_CONCURRENT - running.length;
    const jobsToRun = queued.slice(0, slotsAvailable);
    
    for (const job of jobsToRun) {
      // Don't await - run in parallel
      runJob(job.id)
        .catch((err) => console.error(`Error running job ${job.id}:`, err))
        .finally(() => processQueue());
    }
  } finally {
    processing = false;
  }
}

export async function getQueueStatus() {
  const running = await getRunningJobs();
  const queued = await getQueuedJobs();
  
  return {
    running: running.map((j) => ({
      id: j.id,
      branchName: j.branch_name,
      startedAt: j.started_at,
      runningFor: j.started_at
        ? formatDuration(Date.now() - new Date(j.started_at).getTime())
        : null
    })),
    queued: queued.map((j, i) => ({
      id: j.id,
      branchName: j.branch_name,
      position: i + 1,
      createdAt: j.created_at
    })),
    maxConcurrent: MAX_CONCURRENT
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Cancel a running job
export async function cancelJob(jobId: string): Promise<boolean> {
  const running = await getRunningJobs();
  const job = running.find((j) => j.id === jobId);
  
  if (job?.pid) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // Process may have already exited
    }
  }
  
  await updateJob(jobId, {
    status: 'cancelled',
    completed_at: new Date().toISOString()
  });
  
  return true;
}
```

### 5. Update index.ts (API routes)

```typescript
// src/index.ts
import express from 'express';
import {
  listClients,
  getClient,
  getRepositoryByClientId,
  getRepositoryByGitHub,
  createRepository,
  listJobs,
  getJob,
  getJobWithDetails,
  getJobMessages,
  createJob,
  updateJob,
  type JobWithDetails
} from './db/index.js';
import { processQueue, getQueueStatus, cancelJob } from './queue.js';

const app = express();
app.use(express.json());

const API_SECRET = process.env.AGENT_API_SECRET;

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  
  const auth = req.headers.authorization;
  if (!API_SECRET || auth !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ----- Health -----

app.get('/health', async (req, res) => {
  const queue = await getQueueStatus();
  
  res.json({
    status: 'ok',
    queue: {
      running: queue.running.length,
      queued: queue.queued.length,
      maxConcurrent: queue.maxConcurrent
    }
  });
});

// ----- Clients (read from Supabase) -----

app.get('/clients', async (req, res) => {
  try {
    const clients = await listClients();
    res.json({ clients });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/clients/:id', async (req, res) => {
  try {
    const client = await getClient(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const repo = await getRepositoryByClientId(req.params.id);
    
    res.json({
      ...client,
      repository: repo
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add repository to client
app.post('/clients/:id/repository', async (req, res) => {
  try {
    const { githubOrg, githubRepo, defaultBranch } = req.body;
    
    if (!githubOrg || !githubRepo) {
      return res.status(400).json({ error: 'githubOrg and githubRepo required' });
    }
    
    const repo = await createRepository({
      clientId: req.params.id,
      ownerName: githubOrg,
      repoName: githubRepo,
      defaultBranch
    });
    
    res.status(201).json(repo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Jobs -----

app.get('/jobs', async (req, res) => {
  try {
    const { status, clientId, featureId, limit, offset } = req.query;
    
    const result = await listJobs({
      status: status ? String(status).split(',') : undefined,
      clientId: clientId as string,
      featureId: featureId as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });
    
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const includeMessages = req.query.includeMessages === 'true';
    
    const job = await getJobWithDetails(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    let messages = null;
    if (includeMessages) {
      messages = await getJobMessages(req.params.id);
    }
    
    res.json({ ...job, messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs', async (req, res) => {
  try {
    const {
      clientId,
      featureId,
      repositoryId,
      githubOrg,
      githubRepo,
      prompt,
      branchName,
      title,
      createdByTeamMemberId
    } = req.body;
    
    if (!prompt || !branchName) {
      return res.status(400).json({ error: 'prompt and branchName required' });
    }
    
    // Determine client and repository
    let finalClientId = clientId;
    let finalRepositoryId = repositoryId;
    
    if (!clientId && githubOrg && githubRepo) {
      // Look up by GitHub org/repo
      const repo = await getRepositoryByGitHub(githubOrg, githubRepo);
      if (!repo) {
        return res.status(400).json({
          error: `Repository ${githubOrg}/${githubRepo} not found. Add it to code_repositories first.`
        });
      }
      finalClientId = repo.client_id;
      finalRepositoryId = repo.id;
    }
    
    if (!finalClientId) {
      return res.status(400).json({ error: 'clientId or githubOrg/githubRepo required' });
    }
    
    const job = await createJob({
      clientId: finalClientId,
      featureId,
      repositoryId: finalRepositoryId,
      prompt,
      branchName,
      title,
      createdByTeamMemberId
    });
    
    // Trigger queue processing
    processQueue();
    
    const queued = await getQueueStatus();
    
    res.status(201).json({
      id: job.id,
      status: job.status,
      position: queued.queued.findIndex((q) => q.id === job.id) + 1,
      branchName: job.branch_name,
      createdAt: job.created_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(400).json({ error: 'Job already finished' });
    }
    
    const wasRunning = job.status === 'running';
    await cancelJob(req.params.id);
    
    res.json({
      id: req.params.id,
      status: 'cancelled',
      wasRunning
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/:id/retry', async (req, res) => {
  try {
    const originalJob = await getJob(req.params.id);
    if (!originalJob) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Create new job with same params but new branch name
    const newBranchName = `${originalJob.branch_name}-retry-${Date.now()}`;
    
    const newJob = await createJob({
      clientId: originalJob.client_id,
      featureId: originalJob.feature_id || undefined,
      repositoryId: originalJob.repository_id || undefined,
      prompt: originalJob.prompt,
      branchName: newBranchName,
      title: originalJob.title || undefined
    });
    
    processQueue();
    
    res.status(201).json({
      id: newJob.id,
      originalJobId: req.params.id,
      status: newJob.status,
      branchName: newJob.branch_name
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Queue -----

app.get('/queue', async (req, res) => {
  try {
    const status = await getQueueStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Startup -----

const PORT = parseInt(process.env.PORT || '3456');

app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
  
  // Process any queued jobs on startup
  processQueue();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});
```

### 6. Update package.json

```json
{
  "name": "agent-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0"
  }
}
```

---

## Migration Steps

### 1. Run SQL in Supabase
Execute the SQL from section 1 in your Supabase SQL editor.

### 2. Add repositories for your clients
```sql
-- Check which clients have repos
SELECT c.id, c.name, r.owner_name, r.repo_name
FROM clients c
LEFT JOIN code_repositories r ON r.client_id = c.id
ORDER BY c.name;

-- Add missing repos
INSERT INTO code_repositories (client_id, provider, owner_name, repo_name, default_branch, url)
SELECT 
  id,
  'github',
  'SupportKings',  -- adjust per client
  'repo-name',     -- adjust per client
  'main',
  'https://github.com/SupportKings/repo-name'
FROM clients
WHERE name = 'Client Name';
```

### 3. Update environment variables
```bash
# On your Mac agent server
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ..."
export AGENT_API_SECRET="your-secret"
export REPOS_DIR="/Users/david/repos"
export WORKTREES_DIR="/Users/david/worktrees"
export MAX_CONCURRENT_JOBS="2"
```

### 4. Install new dependency
```bash
cd ~/agent-server
npm install @supabase/supabase-js
npm uninstall better-sqlite3  # remove old dependency
```

### 5. Create new file structure
```bash
mkdir -p src/types src/db
```

### 6. Generate Supabase types
```bash
supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/supabase.ts
```

### 7. Replace source files
Create the files in `src/db/` as shown above:
- `src/db/client.ts`
- `src/db/types.ts`
- `src/db/queries.ts`
- `src/db/index.ts`

Update the other files:
- `src/runner.ts`
- `src/queue.ts`
- `src/index.ts`

### 8. Remove old files
```bash
rm src/db.ts              # replaced by src/db/ folder
rm ~/agent-server/agent.db # old SQLite database
```

### 9. Restart server
```bash
pm2 restart agent-server
```

---

## API Changes

### Creating a job - new options

```bash
# By client ID (looks up repo from code_repositories)
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "e897788c-afc6-4218-be48-703f2955cb0f",
    "featureId": "4e7df575-6bdc-4c38-944b-23a404b391db",
    "branchName": "feature/quotes-tab",
    "title": "Add Quotes Tab",
    "prompt": "Implement the Quotes tab..."
  }'

# By GitHub org/repo (looks up client from code_repositories)
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "githubOrg": "SupportKings",
    "githubRepo": "french-language-solutions",
    "branchName": "feature/quotes-tab",
    "prompt": "Implement the Quotes tab..."
  }'

# With explicit repository ID
curl -X POST http://localhost:3456/jobs \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "e897788c-afc6-4218-be48-703f2955cb0f",
    "repositoryId": "repo-uuid-here",
    "branchName": "feature/quotes-tab",
    "prompt": "Implement the Quotes tab..."
  }'
```

### No more client management on agent server

The `/clients` endpoints now just read from your existing Supabase `clients` table. You manage clients in your OS, not on the agent server.

To add a repository for a client:

```bash
# Via API
curl -X POST http://localhost:3456/clients/CLIENT_ID/repository \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "githubOrg": "SupportKings",
    "githubRepo": "new-repo",
    "defaultBranch": "main"
  }'

# Or directly in Supabase
INSERT INTO code_repositories (client_id, provider, owner_name, repo_name, default_branch, url)
VALUES ('client-uuid', 'github', 'SupportKings', 'new-repo', 'main', 'https://github.com/SupportKings/new-repo');
```

---

## Benefits of Supabase

1. **Single source of truth** - clients, repos, jobs all in one place
2. **No sync needed** - agent reads directly from your OS database
3. **Real-time updates** - use Supabase subscriptions to watch job status
4. **Branch/PR tracking** - automatically creates records in `code_branches` and `code_pull_requests`
5. **Feature linking** - jobs link to features, PRs link to features
6. **Audit trail** - all jobs and messages persisted

---

## Realtime Job Updates (Optional)

In your OS frontend, subscribe to job status changes:

```typescript
import { supabase } from '@/lib/supabase';

// Subscribe to job updates
const subscription = supabase
  .channel('agent-jobs')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'agent_jobs',
      filter: `feature_id=eq.${featureId}`
    },
    (payload) => {
      console.log('Job updated:', payload.new);
      // Update UI
    }
  )
  .subscribe();

// Cleanup
subscription.unsubscribe();
```