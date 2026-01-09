import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
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
  getJobIterations,
  createJob,
  updateJob,
} from './db/index.js';
import { processQueue, getQueueStatus, cancelJob, initQueue } from './queue.js';
import { checkClaudeAuth, cancelJob as cancelRunnerJob, sendMessageToJob, isJobInteractive, endInteractiveJob } from './runner.js';
import { checkGitAuth, fetchAllRepos, cloneAllRepos, cloneRepo } from './git.js';

// Configuration
const PORT = parseInt(process.env.PORT || '3456');
const API_SECRET = process.env.AGENT_API_SECRET;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '2');
const REPOS_DIR = process.env.REPOS_DIR || `${homedir()}/repos`;
const WORKTREES_DIR = process.env.WORKTREES_DIR || `${homedir()}/worktrees`;

if (!API_SECRET) {
  console.error('ERROR: AGENT_API_SECRET environment variable is required');
  process.exit(1);
}

// Ensure directories exist
mkdirSync(REPOS_DIR, { recursive: true });
mkdirSync(WORKTREES_DIR, { recursive: true });

const app = express();
app.use(express.json());

// Auth middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next();

  const auth = req.headers.authorization;
  if (!API_SECRET || auth !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ----- Health -----

app.get('/health', async (_req: Request, res: Response) => {
  const [queueStatus, claudeStatus, gitStatus] = await Promise.all([
    getQueueStatus(),
    checkClaudeAuth(),
    checkGitAuth()
  ]);

  res.json({
    status: 'ok',
    queue: {
      running: queueStatus.running.length,
      queued: queueStatus.queued.length,
      maxConcurrent: queueStatus.maxConcurrent
    },
    claude: claudeStatus,
    git: gitStatus
  });
});

// ----- Clients (read from Supabase) -----

app.get('/clients', async (_req: Request, res: Response) => {
  try {
    const clients = await listClients();
    res.json({ clients });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/clients/:id', async (req: Request, res: Response) => {
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
app.post('/clients/:id/repository', async (req: Request, res: Response) => {
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

app.get('/jobs', async (req: Request, res: Response) => {
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

app.get('/jobs/:id', async (req: Request, res: Response) => {
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

app.post('/jobs', async (req: Request, res: Response) => {
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
      jobType,
      createdByTeamMemberId,
      // Ralph-specific parameters
      maxIterations,
      completionPromise,
      feedbackCommands
    } = req.body;

    // For task jobs, auto-generate branch name if not provided
    const finalBranchName = branchName || (jobType === 'task' || jobType === 'ralph' ? `${jobType}-${Date.now()}` : null);

    if (!prompt || !finalBranchName) {
      return res.status(400).json({ error: 'prompt and branchName required' });
    }

    // Validate ralph-specific parameters
    if (jobType === 'ralph') {
      if (maxIterations !== undefined && (maxIterations < 1 || maxIterations > 100)) {
        return res.status(400).json({ error: 'maxIterations must be between 1 and 100' });
      }
      if (feedbackCommands !== undefined && !Array.isArray(feedbackCommands)) {
        return res.status(400).json({ error: 'feedbackCommands must be an array of strings' });
      }
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
      branchName: finalBranchName,
      title,
      jobType,
      createdByTeamMemberId,
      // Ralph-specific fields (only set for ralph jobs)
      maxIterations: jobType === 'ralph' ? (maxIterations || 10) : undefined,
      completionPromise: jobType === 'ralph' ? (completionPromise || 'RALPH_COMPLETE') : undefined,
      feedbackCommands: jobType === 'ralph' ? feedbackCommands : undefined
    });

    // Trigger queue processing
    processQueue();

    const queued = await getQueueStatus();

    res.status(201).json({
      id: job.id,
      status: job.status,
      position: queued.queued.findIndex((q) => q.id === job.id) + 1,
      branchName: job.branch_name,
      jobType: job.job_type,
      createdAt: job.created_at,
      // Include ralph config in response
      ...(jobType === 'ralph' && {
        maxIterations: job.max_iterations,
        completionPromise: job.completion_promise
      })
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return res.status(400).json({ error: 'Job already finished' });
    }

    const wasRunning = job.status === 'running';

    if (wasRunning) {
      cancelRunnerJob(req.params.id);
    }

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

app.post('/jobs/:id/retry', async (req: Request, res: Response) => {
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

// Send a message to an interactive task job (when Claude asks a question)
app.post('/jobs/:id/message', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    if (job.job_type !== 'task') {
      return res.status(400).json({ error: 'Only task jobs support interactive messaging' });
    }

    if (!isJobInteractive(req.params.id)) {
      return res.status(400).json({ error: 'Job is not accepting messages (not interactive or already finished)' });
    }

    const sent = sendMessageToJob(req.params.id, message);

    if (!sent) {
      return res.status(500).json({ error: 'Failed to send message to job' });
    }

    res.json({
      id: req.params.id,
      messageSent: true
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// End an interactive task job session (marks it as complete)
app.post('/jobs/:id/complete', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    if (job.job_type !== 'task') {
      return res.status(400).json({ error: 'Only task jobs support this endpoint' });
    }

    if (!isJobInteractive(req.params.id)) {
      return res.status(400).json({ error: 'Job is not interactive or already finished' });
    }

    const ended = endInteractiveJob(req.params.id);

    if (!ended) {
      return res.status(500).json({ error: 'Failed to end job session' });
    }

    res.json({
      id: req.params.id,
      status: 'completing'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Ralph Loop Endpoints -----

// Get iteration history for a ralph job
app.get('/jobs/:id/iterations', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.job_type !== 'ralph') {
      return res.status(400).json({ error: 'Only ralph jobs have iterations' });
    }

    const iterations = await getJobIterations(req.params.id);

    res.json({
      jobId: req.params.id,
      currentIteration: job.current_iteration,
      maxIterations: job.max_iterations,
      completionReason: job.completion_reason,
      iterations: iterations.map(i => ({
        id: i.id,
        iterationNumber: i.iteration_number,
        startedAt: i.started_at,
        completedAt: i.completed_at,
        exitCode: i.exit_code,
        error: i.error,
        promiseDetected: i.promise_detected,
        outputSummary: i.output_summary,
        feedbackResults: i.feedback_results
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Gracefully stop a ralph job after current iteration
app.post('/jobs/:id/stop', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.job_type !== 'ralph') {
      return res.status(400).json({ error: 'Only ralph jobs support graceful stop. Use /cancel for other job types.' });
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    // Mark job as cancelled - the ralph loop checks for this and will stop gracefully
    await updateJob(req.params.id, { status: 'cancelled' });

    res.json({
      id: req.params.id,
      message: 'Stop requested - job will complete after current iteration and create PR with partial work'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Queue -----

app.get('/queue', async (_req: Request, res: Response) => {
  try {
    const status = await getQueueStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Sync -----

app.post('/sync', async (_req: Request, res: Response) => {
  try {
    const results = await fetchAllRepos();
    res.json({ synced: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Repos -----

// Clone all repos from database
app.post('/repos/clone', async (_req: Request, res: Response) => {
  try {
    const results = await cloneAllRepos();
    res.json({ cloned: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clone a specific repo by ID
app.post('/repos/:id/clone', async (req: Request, res: Response) => {
  try {
    const result = await cloneRepo(req.params.id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Startup -----

app.listen(PORT, async () => {
  console.log(`Agent server running on port ${PORT}`);
  console.log(`Max concurrent jobs: ${MAX_CONCURRENT}`);
  console.log(`Repos directory: ${REPOS_DIR}`);
  console.log(`Worktrees directory: ${WORKTREES_DIR}`);

  // Initialize queue and process any pending jobs
  await initQueue();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});
