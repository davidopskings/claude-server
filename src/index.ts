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
  getFeatureWithPrdAndTodos,
} from './db/index.js';
import { processQueue, getQueueStatus, cancelJob, initQueue } from './queue.js';
import { checkClaudeAuth, cancelJob as cancelRunnerJob, sendMessageToJob, isJobInteractive, endInteractiveJob } from './runner.js';
import { checkGitAuth, fetchAllRepos, cloneAllRepos, cloneRepo } from './git.js';
import { generateFeaturePrd } from './prd.js';

// Feature type mapping for branch name generation
const FEATURE_TYPE_MAP: Record<string, string> = {
  '0a083f70-3839-4ae4-af69-067c29ac29f5': 'feature',    // New Feature
  'a8ad25d1-f452-4cec-88f9-56afc668b840': 'fix',        // Bug
  'acd9cd67-b58f-4cdf-b588-b386d812f69c': 'cosmetic',   // Cosmetic Change Request
  'ad217406-5c49-49cb-a433-97989af42557': 'func',       // Functionality Change Request
};

// Generate a git branch name from feature title and type
function generateBranchName(featureTitle: string, featureTypeId?: string | null): string {
  const typePrefix = (featureTypeId && FEATURE_TYPE_MAP[featureTypeId]) || 'feature';

  // Remove client name prefix in brackets like "[ClientName] Title"
  const titleWithoutPrefix = featureTitle.replace(/^\[.*?\]\s*/, '');

  const slug = titleWithoutPrefix
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')      // Remove special chars
    .replace(/\s+/g, '-')               // Spaces to dashes
    .replace(/-+/g, '-')                // Collapse multiple dashes
    .replace(/^-|-$/g, '')              // Trim leading/trailing dashes
    .slice(0, 50);                      // Max 50 chars

  return `${typePrefix}/${slug}`;
}

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
      feedbackCommands,
      // PRD mode parameters
      prdMode,
      prd
    } = req.body;

    // Track loaded feature for branch name generation
    let loadedFeature: Awaited<ReturnType<typeof getFeatureWithPrdAndTodos>> = null;

    // Validate ralph-specific parameters
    let finalPrd = prd;
    if (jobType === 'ralph') {
      if (maxIterations !== undefined && (maxIterations < 1 || maxIterations > 100)) {
        return res.status(400).json({ error: 'maxIterations must be between 1 and 100' });
      }
      if (feedbackCommands !== undefined && !Array.isArray(feedbackCommands)) {
        return res.status(400).json({ error: 'feedbackCommands must be an array of strings' });
      }
      // Validate PRD mode
      if (prdMode) {
        // If featureId provided but no prd, load from database
        if (!prd && featureId) {
          loadedFeature = await getFeatureWithPrdAndTodos(featureId);
          if (!loadedFeature) {
            return res.status(404).json({ error: `Feature not found: ${featureId}` });
          }
          if (!loadedFeature.prd || !loadedFeature.todos || loadedFeature.todos.length === 0) {
            return res.status(400).json({
              error: 'Feature has no PRD or todos. Run POST /features/:featureId/generate-tasks first.'
            });
          }
          // Convert todos to PRD stories format
          finalPrd = {
            title: loadedFeature.title,
            description: (loadedFeature.prd as any)?.overview || loadedFeature.functionality_notes || '',
            stories: loadedFeature.todos.map((todo, index) => ({
              id: index + 1,
              title: todo.title,
              description: todo.description || '',
              acceptanceCriteria: [],
              passes: todo.status === 'completed'
            }))
          };
          console.log(`Loaded PRD from feature ${featureId} with ${finalPrd.stories.length} stories`);
        } else if (!prd) {
          return res.status(400).json({ error: 'prdMode requires either prd object or featureId with existing PRD/todos' });
        }

        // Validate PRD structure (either provided or loaded from feature)
        if (!finalPrd.stories || !Array.isArray(finalPrd.stories) || finalPrd.stories.length === 0) {
          return res.status(400).json({ error: 'PRD must have stories array' });
        }
        // Validate story structure
        for (const story of finalPrd.stories) {
          if (typeof story.id !== 'number' || !story.title) {
            return res.status(400).json({ error: 'Each story must have numeric id and title' });
          }
        }
      }
    }

    // Generate branch name: use provided, or generate from feature, or fallback to job type + timestamp
    let finalBranchName = branchName;
    if (!finalBranchName && loadedFeature) {
      finalBranchName = generateBranchName(loadedFeature.title, (loadedFeature as any).feature_type_id);
      console.log(`Generated branch name from feature: ${finalBranchName}`);
    }
    if (!finalBranchName) {
      finalBranchName = (jobType === 'task' || jobType === 'ralph') ? `${jobType}-${Date.now()}` : null;
    }

    if (!prompt || !finalBranchName) {
      return res.status(400).json({ error: 'prompt and branchName required' });
    }

    // Determine client and repository
    let finalClientId = clientId;
    let finalRepositoryId = repositoryId;

    // If featureId provided, get clientId from feature
    if (!clientId && featureId) {
      const feature = await getFeatureWithPrdAndTodos(featureId);
      if (feature) {
        finalClientId = feature.client_id;
        console.log(`Got clientId ${finalClientId} from feature ${featureId}`);
      }
    }

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
      return res.status(400).json({ error: 'clientId, featureId, or githubOrg/githubRepo required' });
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
      feedbackCommands: jobType === 'ralph' ? feedbackCommands : undefined,
      // PRD mode fields
      prdMode: jobType === 'ralph' ? prdMode : undefined,
      prd: jobType === 'ralph' && prdMode ? finalPrd : undefined
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
        completionPromise: job.completion_promise,
        prdMode: job.prd_mode,
        storiesCount: prdMode ? finalPrd?.stories?.length : undefined
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

// ----- Features / PRD Generation -----

// Generate PRD and tasks for a feature
app.post('/features/:featureId/generate-tasks', async (req: Request, res: Response) => {
  try {
    const { featureId } = req.params;
    const { clearExisting } = req.body;

    console.log(`Generating PRD and tasks for feature: ${featureId}`);

    const result = await generateFeaturePrd(featureId, {
      clearExisting: clearExisting === true
    });

    res.json({
      featureId: result.featureId,
      featureTitle: result.featureTitle,
      prd: result.prd,
      tasks: result.tasks,
      todosCreated: result.todosCreated
    });
  } catch (err: any) {
    console.error('PRD generation error:', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({
      error: err.message
    });
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
