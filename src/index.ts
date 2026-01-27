import "dotenv/config";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import {
	AGENTS,
	conductorWorkflow,
	runAgentsParallel,
} from "./agents/index.js";
import {
	createJob,
	createRepository,
	getClient,
	getFeatureWithPrdAndTodos,
	getJob,
	getJobIterations,
	getJobMessages,
	getJobWithDetails,
	getRepositoryByGitHub,
	listClients,
	listJobs,
	updateJob,
} from "./db/index.js";
import {
	createSpecJob,
	getClientConstitution,
	getFeature,
	getFeatureSpecOutput,
	getRepositoryByClientId,
	getSpecJobsForFeature,
	updateFeatureSpecOutput,
	updateFeatureWorkflowStageByCode,
} from "./db/queries.js";
import type { SpecPhase } from "./db/types.js";
import {
	checkGitAuth,
	cloneAllRepos,
	cloneRepo,
	fetchAllRepos,
} from "./git.js";
import { createMcpRouter } from "./mcp/index.js";
// Advanced modules from NEXT_LEVEL.md
import {
	formatMemoriesForPrompt,
	learn,
	recall,
	recallForClient,
} from "./memory/index.js";
import {
	exportTraces,
	getMetrics,
	getRecentTraces,
} from "./observability/index.js";
import { generateFeaturePrd } from "./prd.js";
import { cancelJob, getQueueStatus, initQueue, processQueue } from "./queue.js";
import {
	cancelJob as cancelRunnerJob,
	checkClaudeAuth,
	endInteractiveJob,
	isJobInteractive,
	sendMessageToJob,
} from "./runner.js";
import {
	extractJobFeatures,
	getCapacity,
	getNextJobs,
	getPredictionMetrics,
	predictTokens,
	scheduleJob,
} from "./scheduling/index.js";
import {
	detectRelevantSkills,
	listSkills,
	runSkill,
	SKILLS,
} from "./skills/index.js";
import {
	allClarificationsAnswered,
	SPEC_PHASES,
	submitClarification,
} from "./spec/index.js";

// Feature type mapping for branch name generation
const FEATURE_TYPE_MAP: Record<string, string> = {
	"0a083f70-3839-4ae4-af69-067c29ac29f5": "feature", // New Feature
	"a8ad25d1-f452-4cec-88f9-56afc668b840": "fix", // Bug
	"acd9cd67-b58f-4cdf-b588-b386d812f69c": "cosmetic", // Cosmetic Change Request
	"ad217406-5c49-49cb-a433-97989af42557": "func", // Functionality Change Request
};

// Helper to safely get route param as string (Express 5 returns string | string[])
function getParam(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string {
	const value = params[key];
	if (Array.isArray(value)) return value[0] ?? "";
	return value ?? "";
}

// Generate a git branch name from feature title and type
function generateBranchName(
	featureTitle: string,
	featureTypeId?: string | null,
): string {
	const typePrefix =
		(featureTypeId && FEATURE_TYPE_MAP[featureTypeId]) || "feature";

	// Remove client name prefix in brackets like "[ClientName] Title"
	const titleWithoutPrefix = featureTitle.replace(/^\[.*?\]\s*/, "");

	const slug = titleWithoutPrefix
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "") // Remove special chars
		.replace(/\s+/g, "-") // Spaces to dashes
		.replace(/-+/g, "-") // Collapse multiple dashes
		.replace(/^-|-$/g, "") // Trim leading/trailing dashes
		.slice(0, 50); // Max 50 chars

	return `${typePrefix}/${slug}`;
}

// Configuration
const PORT = parseInt(process.env.PORT || "3456", 10);
const API_SECRET = process.env.AGENT_API_SECRET;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || "2", 10);
const REPOS_DIR = process.env.REPOS_DIR || `${homedir()}/repos`;
const WORKTREES_DIR = process.env.WORKTREES_DIR || `${homedir()}/worktrees`;

if (!API_SECRET) {
	console.error("ERROR: AGENT_API_SECRET environment variable is required");
	process.exit(1);
}

// Ensure directories exist
mkdirSync(REPOS_DIR, { recursive: true });
mkdirSync(WORKTREES_DIR, { recursive: true });

const app = express();
app.use(express.json());

// Auth middleware
app.use((req: Request, res: Response, next: NextFunction) => {
	if (req.path === "/health") return next();

	const auth = req.headers.authorization;
	if (!API_SECRET || auth !== `Bearer ${API_SECRET}`) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	next();
});

// ----- Health -----

app.get("/health", async (_req: Request, res: Response) => {
	const [queueStatus, claudeStatus, gitStatus] = await Promise.all([
		getQueueStatus(),
		checkClaudeAuth(),
		checkGitAuth(),
	]);

	res.json({
		status: "ok",
		queue: {
			running: queueStatus.running.length,
			queued: queueStatus.queued.length,
			maxConcurrent: queueStatus.maxConcurrent,
		},
		claude: claudeStatus,
		git: gitStatus,
	});
});

// ----- Clients (read from Supabase) -----

app.get("/clients", async (_req: Request, res: Response) => {
	try {
		const clients = await listClients();
		res.json({ clients });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

app.get("/clients/:id", async (req: Request, res: Response) => {
	try {
		const client = await getClient(getParam(req.params, "id"));
		if (!client) {
			return res.status(404).json({ error: "Client not found" });
		}

		const repo = await getRepositoryByClientId(getParam(req.params, "id"));

		res.json({
			...client,
			repository: repo,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Add repository to client
app.post("/clients/:id/repository", async (req: Request, res: Response) => {
	try {
		const { githubOrg, githubRepo, defaultBranch } = req.body ?? {};

		if (!githubOrg || !githubRepo) {
			return res
				.status(400)
				.json({ error: "githubOrg and githubRepo required" });
		}

		const repo = await createRepository({
			clientId: getParam(req.params, "id"),
			ownerName: githubOrg,
			repoName: githubRepo,
			defaultBranch,
		});

		res.status(201).json(repo);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Get client constitution (returns existing or null)
app.get(
	"/clients/:clientId/constitution",
	async (req: Request, res: Response) => {
		try {
			const clientId = getParam(req.params, "clientId");

			const client = await getClient(clientId);
			if (!client) {
				return res.status(404).json({ error: "Client not found" });
			}

			const constitution = await getClientConstitution(clientId);
			if (!constitution) {
				return res.json({
					clientId,
					constitution: null,
					generatedAt: null,
					message: "No constitution generated yet",
				});
			}

			res.json({
				clientId,
				constitution: constitution.constitution,
				generatedAt: constitution.generatedAt,
			});
		} catch (err) {
			res.status(500).json({ error: (err as Error).message });
		}
	},
);

// Force regenerate client constitution (POST triggers spec job for constitution phase)
app.post(
	"/clients/:clientId/constitution",
	async (req: Request, res: Response) => {
		try {
			const clientId = getParam(req.params, "clientId");
			const { createdByTeamMemberId } = req.body ?? {};

			const client = await getClient(clientId);
			if (!client) {
				return res.status(404).json({ error: "Client not found" });
			}

			// Get repository for the client
			const repo = await getRepositoryByClientId(clientId);
			if (!repo) {
				return res
					.status(400)
					.json({ error: "No repository found for client" });
			}

			// Create a spec job just for constitution regeneration
			// Using a special marker in spec_output to indicate force regeneration
			const job = await createSpecJob({
				clientId,
				featureId: null, // No feature - client-level constitution
				repositoryId: repo.id,
				specPhase: "constitution",
				createdByTeamMemberId,
				specOutput: { forceRegenerate: true },
			});

			// Trigger queue processing
			processQueue();

			res.status(201).json({
				jobId: job.id,
				clientId,
				message: "Constitution regeneration started",
				status: job.status,
			});
		} catch (err) {
			res.status(500).json({ error: (err as Error).message });
		}
	},
);

// ----- Jobs -----

app.get("/jobs", async (req: Request, res: Response) => {
	try {
		const { status, clientId, featureId, limit, offset } = req.query;

		const result = await listJobs({
			status: status ? String(status).split(",") : undefined,
			clientId: clientId as string,
			featureId: featureId as string,
			limit: limit ? parseInt(limit as string, 10) : undefined,
			offset: offset ? parseInt(offset as string, 10) : undefined,
		});

		res.json(result);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

app.get("/jobs/:id", async (req: Request, res: Response) => {
	try {
		const includeMessages = req.query.includeMessages === "true";

		const job = await getJobWithDetails(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		let messages = null;
		if (includeMessages) {
			messages = await getJobMessages(getParam(req.params, "id"));
		}

		res.json({ ...job, messages });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

app.post("/jobs", async (req: Request, res: Response) => {
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
			prd,
			// Spec mode parameters (new Spec-Kit flow)
			specMode,
		} = req.body ?? {};

		// Track loaded feature for branch name generation
		let loadedFeature: Awaited<ReturnType<typeof getFeatureWithPrdAndTodos>> =
			null;

		// Track loaded spec output for storing on job (spec mode)
		let loadedSpecOutput: Awaited<ReturnType<typeof getFeatureSpecOutput>> =
			null;

		// Validate ralph-specific parameters
		let finalPrd = prd;
		if (jobType === "ralph") {
			if (
				maxIterations !== undefined &&
				(maxIterations < 1 || maxIterations > 100)
			) {
				return res
					.status(400)
					.json({ error: "maxIterations must be between 1 and 100" });
			}
			if (feedbackCommands !== undefined && !Array.isArray(feedbackCommands)) {
				return res
					.status(400)
					.json({ error: "feedbackCommands must be an array of strings" });
			}
			// Validate PRD mode
			if (prdMode) {
				// If featureId provided but no prd, load from database
				if (!prd && featureId) {
					loadedFeature = await getFeatureWithPrdAndTodos(featureId);
					if (!loadedFeature) {
						return res
							.status(404)
							.json({ error: `Feature not found: ${featureId}` });
					}
					if (
						!loadedFeature.prd ||
						!loadedFeature.todos ||
						loadedFeature.todos.length === 0
					) {
						return res.status(400).json({
							error:
								"Feature has no PRD or todos. Run POST /features/:featureId/generate-tasks first.",
						});
					}
					// Convert todos to PRD stories format
					finalPrd = {
						title: loadedFeature.title,
						description:
							(loadedFeature.prd as { overview?: string } | null)?.overview ||
							loadedFeature.functionality_notes ||
							"",
						stories: loadedFeature.todos.map((todo, index) => ({
							id: index + 1,
							title: todo.title,
							description: todo.description || "",
							acceptanceCriteria: [],
							passes: todo.status === "completed",
						})),
					};
					console.log(
						`Loaded PRD from feature ${featureId} with ${finalPrd.stories.length} stories`,
					);
				} else if (!prd) {
					return res.status(400).json({
						error:
							"prdMode requires either prd object or featureId with existing PRD/todos",
					});
				}

				// Validate PRD structure (either provided or loaded from feature)
				if (
					!finalPrd.stories ||
					!Array.isArray(finalPrd.stories) ||
					finalPrd.stories.length === 0
				) {
					return res.status(400).json({ error: "PRD must have stories array" });
				}
				// Validate story structure
				for (const story of finalPrd.stories) {
					if (typeof story.id !== "number" || !story.title) {
						return res
							.status(400)
							.json({ error: "Each story must have numeric id and title" });
					}
				}
			}

			// Validate Spec mode (new Spec-Kit flow)
			if (specMode) {
				if (!featureId) {
					return res.status(400).json({
						error: "specMode requires featureId",
					});
				}

				// Load spec_output from feature
				const specOutput = await getFeatureSpecOutput(featureId);
				loadedSpecOutput = specOutput;
				if (!specOutput) {
					return res.status(400).json({
						error:
							"Feature has no spec_output. Run Spec-Kit first (move to spec_ready stage).",
					});
				}

				if (
					!specOutput.tasks ||
					!Array.isArray(specOutput.tasks) ||
					specOutput.tasks.length === 0
				) {
					return res.status(400).json({
						error:
							"Spec has no tasks. Complete all Spec-Kit phases first (through tasks phase).",
					});
				}

				// Load feature for title and other info
				loadedFeature = await getFeatureWithPrdAndTodos(featureId);
				if (!loadedFeature) {
					return res
						.status(404)
						.json({ error: `Feature not found: ${featureId}` });
				}

				// Convert spec tasks to PRD format (Ralph uses PRD internally)
				finalPrd = {
					title: loadedFeature.title,
					description:
						specOutput.spec?.overview || loadedFeature.client_context || "",
					stories: specOutput.tasks.map((task) => ({
						id: task.id,
						title: task.title,
						description: `${task.description}\n\nFiles: ${task.files.join(", ")}`,
						acceptanceCriteria: specOutput.spec?.acceptanceCriteria || [],
						passes: false,
					})),
				};
				console.log(
					`Loaded spec from feature ${featureId} with ${finalPrd.stories.length} tasks`,
				);
			}
		}

		// Generate branch name: use provided, or generate from feature, or fallback to job type + timestamp
		let finalBranchName = branchName;
		if (!finalBranchName && loadedFeature) {
			finalBranchName = generateBranchName(
				loadedFeature.title,
				loadedFeature.feature_type_id,
			);
			console.log(`Generated branch name from feature: ${finalBranchName}`);
		}
		if (!finalBranchName) {
			finalBranchName =
				jobType === "task" || jobType === "ralph"
					? `${jobType}-${Date.now()}`
					: null;
		}

		// For specMode, prompt is optional (the spec runner uses spec_output directly)
		const finalPrompt =
			prompt || (specMode ? "Implement feature according to spec." : null);

		if (!finalPrompt || !finalBranchName) {
			return res.status(400).json({ error: "prompt and branchName required" });
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
					error: `Repository ${githubOrg}/${githubRepo} not found. Add it to code_repositories first.`,
				});
			}
			finalClientId = repo.client_id;
			finalRepositoryId = repo.id;
		}

		if (!finalClientId) {
			return res.status(400).json({
				error: "clientId, featureId, or githubOrg/githubRepo required",
			});
		}

		const job = await createJob({
			clientId: finalClientId,
			featureId,
			repositoryId: finalRepositoryId,
			prompt: finalPrompt,
			branchName: finalBranchName,
			title,
			jobType,
			createdByTeamMemberId,
			// Ralph-specific fields (only set for ralph jobs)
			maxIterations: jobType === "ralph" ? maxIterations || 10 : undefined,
			completionPromise:
				jobType === "ralph" ? completionPromise || "RALPH_COMPLETE" : undefined,
			feedbackCommands: jobType === "ralph" ? feedbackCommands : undefined,
			// PRD mode fields (specMode also uses PRD format internally)
			prdMode: jobType === "ralph" ? prdMode || specMode : undefined,
			prd: jobType === "ralph" && (prdMode || specMode) ? finalPrd : undefined,
			// Spec mode - store full spec_output for runRalphSpecJob
			specOutput: specMode && loadedSpecOutput ? loadedSpecOutput : undefined,
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
			...(jobType === "ralph" && {
				maxIterations: job.max_iterations,
				completionPromise: job.completion_promise,
				prdMode: job.prd_mode,
				specMode: specMode || false,
				storiesCount:
					prdMode || specMode ? finalPrd?.stories?.length : undefined,
			}),
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

app.post("/jobs/:id/cancel", async (req: Request, res: Response) => {
	try {
		const job = await getJob(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		if (
			job.status === "completed" ||
			job.status === "failed" ||
			job.status === "cancelled"
		) {
			return res.status(400).json({ error: "Job already finished" });
		}

		const wasRunning = job.status === "running";

		if (wasRunning) {
			cancelRunnerJob(getParam(req.params, "id"));
		}

		await cancelJob(getParam(req.params, "id"));

		res.json({
			id: getParam(req.params, "id"),
			status: "cancelled",
			wasRunning,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

app.post("/jobs/:id/retry", async (req: Request, res: Response) => {
	try {
		const originalJob = await getJob(getParam(req.params, "id"));
		if (!originalJob) {
			return res.status(404).json({ error: "Job not found" });
		}

		// Create new job with same params but new branch name
		const newBranchName = `${originalJob.branch_name}-retry-${Date.now()}`;

		const newJob = await createJob({
			clientId: originalJob.client_id,
			featureId: originalJob.feature_id || undefined,
			repositoryId: originalJob.repository_id || undefined,
			prompt: originalJob.prompt,
			branchName: newBranchName,
			title: originalJob.title || undefined,
		});

		processQueue();

		res.status(201).json({
			id: newJob.id,
			originalJobId: getParam(req.params, "id"),
			status: newJob.status,
			branchName: newJob.branch_name,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Generate PRD for a feature (async job)
app.post("/jobs/generate-prd", async (req: Request, res: Response) => {
	try {
		const { featureId, clientId } = req.body;

		if (!featureId) {
			return res.status(400).json({ error: "featureId required" });
		}

		if (!clientId) {
			return res.status(400).json({ error: "clientId required" });
		}

		const job = await createJob({
			clientId,
			featureId,
			jobType: "prd_generation",
			branchName: `prd-gen-${Date.now()}`,
			prompt: "",
			title: "Generate PRD",
		});

		processQueue();

		res.status(201).json({
			id: job.id,
			status: job.status,
			featureId,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Send a message to an interactive task job (when Claude asks a question)
app.post("/jobs/:id/message", async (req: Request, res: Response) => {
	try {
		const { message } = req.body ?? {};

		if (!message) {
			return res.status(400).json({ error: "message required" });
		}

		const job = await getJob(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		if (job.status !== "running") {
			return res.status(400).json({ error: "Job is not running" });
		}

		if (job.job_type !== "task") {
			return res
				.status(400)
				.json({ error: "Only task jobs support interactive messaging" });
		}

		if (!isJobInteractive(getParam(req.params, "id"))) {
			return res.status(400).json({
				error:
					"Job is not accepting messages (not interactive or already finished)",
			});
		}

		const sent = sendMessageToJob(getParam(req.params, "id"), message);

		if (!sent) {
			return res.status(500).json({ error: "Failed to send message to job" });
		}

		res.json({
			id: getParam(req.params, "id"),
			messageSent: true,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// End an interactive task job session (marks it as complete)
app.post("/jobs/:id/complete", async (req: Request, res: Response) => {
	try {
		const job = await getJob(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		if (job.status !== "running") {
			return res.status(400).json({ error: "Job is not running" });
		}

		if (job.job_type !== "task") {
			return res
				.status(400)
				.json({ error: "Only task jobs support this endpoint" });
		}

		if (!isJobInteractive(getParam(req.params, "id"))) {
			return res
				.status(400)
				.json({ error: "Job is not interactive or already finished" });
		}

		const ended = endInteractiveJob(getParam(req.params, "id"));

		if (!ended) {
			return res.status(500).json({ error: "Failed to end job session" });
		}

		res.json({
			id: getParam(req.params, "id"),
			status: "completing",
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Ralph Loop Endpoints -----

// Get iteration history for a ralph job
app.get("/jobs/:id/iterations", async (req: Request, res: Response) => {
	try {
		const job = await getJob(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		if (job.job_type !== "ralph") {
			return res.status(400).json({ error: "Only ralph jobs have iterations" });
		}

		const iterations = await getJobIterations(getParam(req.params, "id"));

		res.json({
			jobId: getParam(req.params, "id"),
			currentIteration: job.current_iteration,
			maxIterations: job.max_iterations,
			completionReason: job.completion_reason,
			iterations: iterations.map((i) => ({
				id: i.id,
				iterationNumber: i.iteration_number,
				startedAt: i.started_at,
				completedAt: i.completed_at,
				exitCode: i.exit_code,
				error: i.error,
				promiseDetected: i.promise_detected,
				outputSummary: i.output_summary,
				feedbackResults: i.feedback_results,
			})),
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Gracefully stop a ralph job after current iteration
app.post("/jobs/:id/stop", async (req: Request, res: Response) => {
	try {
		const job = await getJob(getParam(req.params, "id"));
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		if (job.job_type !== "ralph") {
			return res.status(400).json({
				error:
					"Only ralph jobs support graceful stop. Use /cancel for other job types.",
			});
		}

		if (job.status !== "running") {
			return res.status(400).json({ error: "Job is not running" });
		}

		// Mark job as cancelled - the ralph loop checks for this and will stop gracefully
		await updateJob(getParam(req.params, "id"), { status: "cancelled" });

		res.json({
			id: getParam(req.params, "id"),
			message:
				"Stop requested - job will complete after current iteration and create PR with partial work",
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Queue -----

app.get("/queue", async (_req: Request, res: Response) => {
	try {
		const status = await getQueueStatus();
		res.json(status);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Features / PRD Generation -----

// Generate PRD and tasks for a feature
app.post(
	"/features/:featureId/generate-tasks",
	async (req: Request, res: Response) => {
		try {
			const featureId = getParam(req.params, "featureId");
			const { clearExisting } = req.body ?? {};

			console.log(`Generating PRD and tasks for feature: ${featureId}`);

			const result = await generateFeaturePrd(featureId, {
				clearExisting: clearExisting === true,
			});

			res.json({
				featureId: result.featureId,
				featureTitle: result.featureTitle,
				prd: result.prd,
				tasks: result.tasks,
				todosCreated: result.todosCreated,
			});
		} catch (err) {
			console.error("PRD generation error:", err);
			res
				.status((err as Error).message?.includes("not found") ? 404 : 500)
				.json({
					error: (err as Error).message,
				});
		}
	},
);

// ----- Spec-Kit Endpoints -----

// Start spec-kit for a feature (runs constitution phase)
// Set forceRegenerate: true to regenerate constitution even if client already has one
app.post(
	"/features/:featureId/spec/start",
	async (req: Request, res: Response) => {
		try {
			const featureId = getParam(req.params, "featureId");
			const { createdByTeamMemberId, forceRegenerate } = req.body ?? {};

			// Get feature to verify it exists and get client_id
			const feature = await getFeature(featureId);
			if (!feature) {
				return res
					.status(404)
					.json({ error: `Feature not found: ${featureId}` });
			}

			// Get repository
			const repo = await getRepositoryByClientId(feature.client_id);
			if (!repo) {
				return res
					.status(400)
					.json({ error: "No repository found for client" });
			}

			// Create spec job for constitution phase
			// Pass forceRegenerate in spec_output so spec runner knows to regenerate
			const job = await createSpecJob({
				clientId: feature.client_id,
				featureId,
				repositoryId: repo.id,
				specPhase: "constitution",
				createdByTeamMemberId,
				specOutput: forceRegenerate ? { forceRegenerate: true } : undefined,
			});

			// Trigger queue processing
			processQueue();

			res.status(201).json({
				jobId: job.id,
				featureId,
				phase: "constitution",
				status: job.status,
				message: "Spec-Kit started with constitution phase",
				forceRegenerate: !!forceRegenerate,
			});
		} catch (err) {
			console.error("Start spec error:", err);
			res.status(500).json({ error: (err as Error).message });
		}
	},
);

// Run a specific spec phase
app.post(
	"/features/:featureId/spec/phase",
	async (req: Request, res: Response) => {
		try {
			const featureId = getParam(req.params, "featureId");
			const { phase, createdByTeamMemberId } = req.body ?? {};

			// Validate phase
			if (!phase || !SPEC_PHASES[phase as SpecPhase]) {
				return res.status(400).json({
					error: "Invalid phase",
					validPhases: Object.keys(SPEC_PHASES),
				});
			}

			// Get feature
			const feature = await getFeature(featureId);
			if (!feature) {
				return res
					.status(404)
					.json({ error: `Feature not found: ${featureId}` });
			}

			// Check if clarifications need answers before running plan phase
			if (phase === "plan") {
				const allAnswered = await allClarificationsAnswered(featureId);
				if (!allAnswered) {
					return res.status(400).json({
						error: "Clarifications have unanswered questions",
						message:
							"Submit answers to all clarifications before running plan phase",
					});
				}
			}

			// Get repository
			const repo = await getRepositoryByClientId(feature.client_id);
			if (!repo) {
				return res
					.status(400)
					.json({ error: "No repository found for client" });
			}

			// Create spec job for specified phase
			const job = await createSpecJob({
				clientId: feature.client_id,
				featureId,
				repositoryId: repo.id,
				specPhase: phase as SpecPhase,
				createdByTeamMemberId,
			});

			// Trigger queue processing
			processQueue();

			res.status(201).json({
				jobId: job.id,
				featureId,
				phase,
				status: job.status,
				message: `Spec-Kit phase '${phase}' queued`,
			});
		} catch (err) {
			console.error("Run spec phase error:", err);
			res.status(500).json({ error: (err as Error).message });
		}
	},
);

// Get spec output for a feature
app.get("/features/:featureId/spec", async (req: Request, res: Response) => {
	try {
		const featureId = getParam(req.params, "featureId");

		const specOutput = await getFeatureSpecOutput(featureId);
		const specJobs = await getSpecJobsForFeature(featureId);

		// Get current phase info
		const currentPhase = specOutput?.phase;
		const phaseInfo = currentPhase ? SPEC_PHASES[currentPhase] : null;

		// Check for unanswered clarifications
		const unansweredClarifications =
			specOutput?.clarifications?.filter((c) => !c.response) || [];

		res.json({
			featureId,
			currentPhase,
			phaseInfo: phaseInfo
				? {
						order: phaseInfo.order,
						name: phaseInfo.name,
						description: phaseInfo.description,
						nextPhase: phaseInfo.nextPhase,
						requiresHumanInput: phaseInfo.requiresHumanInput,
					}
				: null,
			specOutput,
			unansweredClarifications: unansweredClarifications.length,
			clarifications: specOutput?.clarifications || [],
			recentJobs: specJobs.slice(0, 10).map((j) => ({
				id: j.id,
				phase: j.spec_phase,
				status: j.status,
				createdAt: j.created_at,
				completedAt: j.completed_at,
				error: j.error,
			})),
		});
	} catch (err) {
		console.error("Get spec error:", err);
		res.status(500).json({ error: (err as Error).message });
	}
});

// Submit clarification response
app.post(
	"/features/:featureId/spec/clarifications/:clarificationId",
	async (req: Request, res: Response) => {
		try {
			const featureId = getParam(req.params, "featureId");
			const clarificationId = getParam(req.params, "clarificationId");
			const { response } = req.body ?? {};

			if (!response) {
				return res.status(400).json({ error: "response is required" });
			}

			const result = await submitClarification(
				featureId,
				clarificationId,
				response,
			);

			// Auto-progress to plan phase when all clarifications are answered
			if (result.remainingQuestions === 0) {
				const feature = await getFeature(featureId);
				if (feature) {
					await updateFeatureWorkflowStageByCode(featureId, "clarify_complete");
					const nextJob = await createSpecJob({
						clientId: feature.client_id,
						featureId,
						specPhase: "plan",
					});
					processQueue();

					res.json({
						featureId,
						clarificationId,
						submitted: true,
						remainingQuestions: 0,
						message:
							"All clarifications answered! Auto-progressing to plan phase.",
						autoProgressedTo: "plan",
						nextJobId: nextJob.id,
					});
					return;
				}
			}

			res.json({
				featureId,
				clarificationId,
				submitted: true,
				remainingQuestions: result.remainingQuestions,
				message: `${result.remainingQuestions} questions remaining`,
			});
		} catch (err) {
			console.error("Submit clarification error:", err);
			res
				.status((err as Error).message.includes("not found") ? 404 : 500)
				.json({
					error: (err as Error).message,
				});
		}
	},
);

// Update spec output section
app.put(
	"/features/:featureId/spec/output",
	async (req: Request, res: Response) => {
		try {
			const featureId = getParam(req.params, "featureId");
			const { section, value } = req.body ?? {};

			if (!section) {
				return res.status(400).json({ error: "section is required" });
			}
			if (value === undefined) {
				return res.status(400).json({ error: "value is required" });
			}

			// Get current spec output
			const currentOutput = await getFeatureSpecOutput(featureId);
			if (!currentOutput) {
				return res
					.status(404)
					.json({ error: "Feature has no spec output yet" });
			}

			// Parse value if it's a JSON string for non-string sections
			let parsedValue = value;
			if (section !== "constitution" && typeof value === "string") {
				try {
					parsedValue = JSON.parse(value);
				} catch {
					// Keep as string if not valid JSON
				}
			}

			// Update the specific section
			const updatedOutput = {
				...currentOutput,
				[section]: parsedValue,
			};

			await updateFeatureSpecOutput(featureId, updatedOutput);

			res.json({
				success: true,
				section,
				message: `${section} updated successfully`,
			});
		} catch (err) {
			console.error("Update spec output error:", err);
			res
				.status((err as Error).message.includes("not found") ? 404 : 500)
				.json({
					error: (err as Error).message,
				});
		}
	},
);

// Get available spec phases
app.get("/spec/phases", async (_req: Request, res: Response) => {
	res.json({
		phases: Object.entries(SPEC_PHASES).map(([key, value]) => ({
			id: key,
			...value,
		})),
	});
});

// ----- Sync -----

app.post("/sync", async (_req: Request, res: Response) => {
	try {
		const results = await fetchAllRepos();
		res.json({ synced: results });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Repos -----

// Clone all repos from database
app.post("/repos/clone", async (_req: Request, res: Response) => {
	try {
		const results = await cloneAllRepos();
		res.json({ cloned: results });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Clone a specific repo by ID
app.post("/repos/:id/clone", async (req: Request, res: Response) => {
	try {
		const result = await cloneRepo(getParam(req.params, "id"));
		if (!result.success) {
			return res.status(400).json(result);
		}
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- MCP Server -----

// Mount MCP routes at /mcp
app.use("/mcp", createMcpRouter());

// ----- Memory Layer -----

// Recall memories relevant to a query
app.post("/memory/recall", async (req: Request, res: Response) => {
	try {
		const { query, clientId, scopes, memoryTypes, limit, minConfidence } =
			req.body;

		if (!query) {
			return res.status(400).json({ error: "query is required" });
		}

		let memories: Awaited<ReturnType<typeof recall>>;
		if (clientId) {
			memories = await recallForClient(clientId, query, { limit, memoryTypes });
		} else {
			memories = await recall(query, {
				scopes,
				memoryTypes,
				limit,
				minConfidence,
			});
		}

		res.json({
			memories,
			formatted: formatMemoriesForPrompt(memories),
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Store a new memory
app.post("/memory/learn", async (req: Request, res: Response) => {
	try {
		const {
			memoryType,
			scope,
			key,
			value,
			contextKeywords,
			sourceJobId,
			sourcePhase,
		} = req.body ?? {};

		if (!memoryType || !scope || !key || !value) {
			return res
				.status(400)
				.json({ error: "memoryType, scope, key, and value are required" });
		}

		const memory = await learn({
			memoryType,
			scope,
			key,
			value,
			contextKeywords,
			sourceJobId,
			sourcePhase,
		});

		res.status(201).json(memory);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Skills Library -----

// List all available skills
app.get("/skills", async (_req: Request, res: Response) => {
	try {
		const skills = listSkills();
		res.json({ skills, fullDefinitions: SKILLS });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Detect relevant skills for a description
app.post("/skills/detect", async (req: Request, res: Response) => {
	try {
		const { description } = req.body ?? {};

		if (!description) {
			return res.status(400).json({ error: "description is required" });
		}

		const relevant = detectRelevantSkills(description);
		res.json({ relevant });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Run a specific skill
app.post("/skills/:skillName/run", async (req: Request, res: Response) => {
	try {
		const skillName = getParam(req.params, "skillName");
		const { jobId, cwd, params } = req.body ?? {};

		if (!jobId || !cwd) {
			return res.status(400).json({ error: "jobId and cwd are required" });
		}

		const result = await runSkill(skillName, {
			jobId,
			cwd,
			params: params || {},
		});

		res.json(result);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Observability -----

// Get system metrics
app.get("/observability/metrics", async (_req: Request, res: Response) => {
	try {
		const metrics = await getMetrics();
		res.json(metrics);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Get recent traces
app.get("/observability/traces", async (req: Request, res: Response) => {
	try {
		const limit = req.query.limit
			? parseInt(req.query.limit as string, 10)
			: 20;
		const traces = getRecentTraces(limit);
		res.json({ traces });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Export all traces and metrics
app.get("/observability/export", async (_req: Request, res: Response) => {
	try {
		const data = exportTraces();
		res.json(data);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Multi-Agent Orchestration -----

// List available agents
app.get("/agents", async (_req: Request, res: Response) => {
	try {
		res.json({ agents: AGENTS });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Run a conductor workflow
app.post("/agents/conductor", async (req: Request, res: Response) => {
	try {
		const { jobId, cwd, task, context } = req.body ?? {};

		if (!jobId || !cwd || !task) {
			return res
				.status(400)
				.json({ error: "jobId, cwd, and task are required" });
		}

		const result = await conductorWorkflow(jobId, cwd, task, context || {});
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Run agents in parallel
app.post("/agents/parallel", async (req: Request, res: Response) => {
	try {
		const { tasks, cwd, jobId } = req.body ?? {};

		if (!tasks || !Array.isArray(tasks) || !cwd || !jobId) {
			return res
				.status(400)
				.json({ error: "tasks array, cwd, and jobId are required" });
		}

		const results = await runAgentsParallel(tasks, cwd, jobId);
		res.json({ results });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// ----- Predictive Scheduling -----

// Get current capacity
app.get("/scheduling/capacity", async (_req: Request, res: Response) => {
	try {
		const capacity = await getCapacity();
		res.json(capacity);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Predict tokens for a job
app.post("/scheduling/predict", async (req: Request, res: Response) => {
	try {
		const { jobId, description, filesToModify, techStack } = req.body ?? {};

		if (!description) {
			return res.status(400).json({ error: "description is required" });
		}

		const features = await extractJobFeatures(
			jobId || "preview",
			description,
			filesToModify || [],
			techStack || "typescript",
		);

		const prediction = predictTokens(features);

		res.json({
			features,
			prediction,
		});
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Schedule a job
app.post("/scheduling/schedule", async (req: Request, res: Response) => {
	try {
		const { jobId, description, filesToModify, techStack, dependencies } =
			req.body;

		if (!jobId || !description) {
			return res
				.status(400)
				.json({ error: "jobId and description are required" });
		}

		const features = await extractJobFeatures(
			jobId,
			description,
			filesToModify || [],
			techStack || "typescript",
		);
		const prediction = predictTokens(features);
		const scheduled = await scheduleJob(
			jobId,
			features,
			prediction,
			dependencies || [],
		);

		res.json(scheduled);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Get next jobs to run
app.get("/scheduling/next", async (req: Request, res: Response) => {
	try {
		const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
		const nextJobs = await getNextJobs(limit);
		res.json({ jobs: nextJobs });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

// Get prediction accuracy metrics
app.get("/scheduling/metrics", async (_req: Request, res: Response) => {
	try {
		const metrics = getPredictionMetrics();
		res.json(metrics);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
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
process.on("SIGTERM", () => {
	console.log("Shutting down...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("Shutting down...");
	process.exit(0);
});
