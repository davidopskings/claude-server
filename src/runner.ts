import { type ChildProcess, exec, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	addJobMessage,
	type CodeRepository,
	createCodeBranch,
	createCodePullRequest,
	createComment,
	createIteration,
	createTodos,
	deleteTodosByFeatureId,
	type FeatureWithClient,
	getClientToolsByType,
	getFeature,
	getJob,
	getRepositoryByClientId,
	getRepositoryById,
	syncTodosFromPrd,
	type TodoInsert,
	updateFeaturePrd,
	updateFeatureWorkflowStage,
	updateIteration,
	updateJob,
	updatePrdProgress,
	updateTodoStatusByFeatureAndOrder,
} from "./db/index.js";
import {
	addSpanEvent,
	endSpan,
	recordException,
	setSpanAttributes,
	startTrace,
} from "./observability/index.js";
import {
	extractJobFeatures,
	predictTokens,
	recordActualUsage,
	type TokenPrediction,
} from "./scheduling/index.js";
import type { Json } from "./types/supabase.js";

// Workflow stage ID for "Ready for Review" (after Ralph completes)
const WORKFLOW_STAGE_READY_FOR_REVIEW = "9bbe1c1a-cd24-44b4-98b3-2f769a4d2853";

import type {
	FeedbackResult,
	Prd,
	PrdCommit,
	PrdProgress,
	PrdStory,
	RalphCompletionReason,
} from "./db/types.js";
import {
	commitAndPush,
	createPullRequest,
	createWorktree,
	ensureBareRepo,
	fetchOrigin,
	pushBranch,
} from "./git.js";

const execAsync = promisify(exec);

const HOME_DIR = process.env.HOME || "/Users/davidcavarlacic";
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

// Track interactive task processes (those that accept stdin)
const interactiveProcesses = new Map<string, ChildProcess>();

export async function runJob(jobId: string): Promise<void> {
	// Start trace for this job
	const trace = startTrace("job_execution", {
		"job.id": jobId,
		"job.type": "standard",
	});

	const job = await getJob(jobId);
	if (!job) {
		endSpan(trace, "error", { "error.message": "Job not found" });
		throw new Error(`Job not found: ${jobId}`);
	}

	setSpanAttributes(trace, {
		"job.client_id": job.client_id,
		"job.branch": job.branch_name,
		"job.job_type": job.job_type || "code",
	});

	// Get repository info
	let repo: CodeRepository | null = null;
	if (job.repository_id) {
		repo = await getRepositoryById(job.repository_id);
	} else {
		repo = await getRepositoryByClientId(job.client_id);
	}

	if (!repo) {
		await updateJob(jobId, {
			status: "failed",
			error:
				"No repository found for client. Add one to code_repositories first.",
			completed_at: new Date().toISOString(),
		});
		endSpan(trace, "error", { "error.message": "No repository found" });
		return;
	}

	setSpanAttributes(trace, {
		"repo.name": `${repo.owner_name}/${repo.repo_name}`,
	});

	// Update job with repository_id if it wasn't set
	if (!job.repository_id) {
		await updateJob(jobId, { repository_id: repo.id });
	}

	let worktreePath: string | null = null;

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
		});

		addSpanEvent(trace, "job_started");
		await addJobMessage(
			jobId,
			"system",
			`Starting job for ${repo.owner_name}/${repo.repo_name}`,
		);

		// 1. Ensure bare repo exists
		await addJobMessage(jobId, "system", "Ensuring bare repository exists...");
		await ensureBareRepo(repo);

		// 2. Fetch latest
		await addJobMessage(jobId, "system", "Fetching latest from origin...");
		await fetchOrigin(repo);

		// 3. Create worktree
		await addJobMessage(
			jobId,
			"system",
			`Creating worktree: ${job.branch_name}`,
		);
		worktreePath = await createWorktree(repo, job);
		await updateJob(jobId, { worktree_path: worktreePath });

		// 4. Run Claude Code (interactive for tasks, non-interactive for code jobs)
		await addJobMessage(jobId, "system", "Running Claude Code...");
		const isInteractive = job.job_type === "task";

		// For task jobs, prepend client context to the prompt
		let enrichedPrompt = job.prompt;
		if (isInteractive && job.client_id) {
			enrichedPrompt = `[Context: You are working with client ID "${job.client_id}". Use mcp__OpsKings__get_client_context with this client ID to get full context before proceeding.]\n\n${job.prompt}`;
		}

		const result = isInteractive
			? await runClaudeCodeInteractive(enrichedPrompt, worktreePath, jobId)
			: await runClaudeCode(job.prompt, worktreePath, jobId);

		if (result.exitCode !== 0) {
			throw new Error(
				result.error || `Claude Code exited with code ${result.exitCode}`,
			);
		}

		// For task jobs: skip git mutations, just complete
		if (job.job_type === "task") {
			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
			});
			await addJobMessage(jobId, "system", "Task completed successfully.");
			return;
		}

		// For code jobs (default): commit, push, and create PR
		// 5. Check for changes and commit
		await addJobMessage(jobId, "system", "Checking for changes...");
		const hasChanges = await commitAndPush(worktreePath, job);

		if (!hasChanges) {
			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				error: "No changes were made",
			});
			await addJobMessage(
				jobId,
				"system",
				"Job completed but no changes were made.",
			);
			return;
		}

		// 6. Create branch record in Supabase
		const branchRecord = await createCodeBranch({
			repositoryId: repo.id,
			featureId: job.feature_id || undefined,
			name: job.branch_name,
			url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`,
		});

		// 7. Create PR
		await addJobMessage(jobId, "system", "Creating pull request...");
		const pr = await createPullRequest(repo, job, worktreePath);

		// 8. Create PR record in Supabase
		const prRecord = await createCodePullRequest({
			repositoryId: repo.id,
			featureId: job.feature_id || undefined,
			branchId: branchRecord.id,
			number: pr.number,
			title: pr.title,
			status: "open",
			url: pr.url,
		});

		// 9. Update job as completed
		await updateJob(jobId, {
			status: "completed",
			completed_at: new Date().toISOString(),
			exit_code: 0,
			pr_url: pr.url,
			pr_number: pr.number,
			files_changed: pr.filesChanged,
			code_branch_id: branchRecord.id,
			code_pull_request_id: prRecord.id,
		});

		await addJobMessage(jobId, "system", `Job completed! PR: ${pr.url}`);
		endSpan(trace, "ok", { "job.pr_url": pr.url });
	} catch (err) {
		console.error(`Job ${jobId} failed:`, err);
		recordException(trace, err instanceof Error ? err : new Error(String(err)));

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
		});

		await addJobMessage(
			jobId,
			"system",
			`Job failed: ${(err as Error).message}`,
		);
		endSpan(trace, "error");
	} finally {
		// Keep worktree for debugging - will be cleaned up on next job for same branch
	}
}

// ===== Ralph Loop Job Runner =====

const PROGRESS_FILE = ".ralph-progress.md";

export async function runRalphJob(jobId: string): Promise<void> {
	// Start trace for Ralph job
	const trace = startTrace("ralph_job", {
		"job.id": jobId,
		"job.type": "ralph",
	});

	// Predict token usage for scheduling insights
	let tokenPrediction: TokenPrediction | null = null;

	const job = await getJob(jobId);
	if (!job) {
		endSpan(trace, "error", { "error.message": "Job not found" });
		throw new Error(`Job not found: ${jobId}`);
	}

	setSpanAttributes(trace, {
		"job.client_id": job.client_id,
		"job.branch": job.branch_name,
		"ralph.max_iterations": job.max_iterations || 10,
	});

	// Get repository info
	let repo: CodeRepository | null = null;
	if (job.repository_id) {
		repo = await getRepositoryById(job.repository_id);
	} else {
		repo = await getRepositoryByClientId(job.client_id);
	}

	if (!repo) {
		await updateJob(jobId, {
			status: "failed",
			error:
				"No repository found for client. Add one to code_repositories first.",
			completed_at: new Date().toISOString(),
		});
		endSpan(trace, "error", { "error.message": "No repository found" });
		return;
	}

	setSpanAttributes(trace, {
		"repo.name": `${repo.owner_name}/${repo.repo_name}`,
	});

	// Update job with repository_id if it wasn't set
	if (!job.repository_id) {
		await updateJob(jobId, { repository_id: repo.id });
	}

	const maxIterations = job.max_iterations || 10;
	const completionPromise = job.completion_promise || "RALPH_COMPLETE";
	const feedbackCommands = (job.feedback_commands as string[] | null) || [];

	// Extract features and predict tokens
	try {
		const features = await extractJobFeatures(
			jobId,
			job.prompt,
			[],
			"typescript",
		);
		tokenPrediction = predictTokens(features);
		setSpanAttributes(trace, {
			"scheduling.predicted_tokens":
				tokenPrediction.estimatedInputTokens +
				tokenPrediction.estimatedOutputTokens,
			"scheduling.complexity": features.complexityScore,
		});
	} catch {
		// Prediction failed, continue without it
	}

	let worktreePath: string | null = null;
	const totalTokensUsed = 0;

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
			current_iteration: 0,
		});

		addSpanEvent(trace, "ralph_started");
		await addJobMessage(
			jobId,
			"system",
			`Starting Ralph loop for ${repo.owner_name}/${repo.repo_name}`,
		);
		await addJobMessage(
			jobId,
			"system",
			`Max iterations: ${maxIterations}, Completion promise: "${completionPromise}"`,
		);

		// 1. Setup git
		await addJobMessage(jobId, "system", "Ensuring bare repository exists...");
		await ensureBareRepo(repo);

		await addJobMessage(jobId, "system", "Fetching latest from origin...");
		await fetchOrigin(repo);

		await addJobMessage(
			jobId,
			"system",
			`Creating worktree: ${job.branch_name}`,
		);
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
			if (currentJob?.status === "cancelled") {
				completionReason = "manual_stop";
				await addJobMessage(
					jobId,
					"system",
					`Job was cancelled at iteration ${i}`,
				);
				break;
			}

			await updateJob(jobId, { current_iteration: i });
			await addJobMessage(
				jobId,
				"system",
				`\n========== ITERATION ${i}/${maxIterations} ==========`,
			);

			// Create iteration record
			const iteration = await createIteration(jobId, i);

			// Build iteration prompt
			const iterationPrompt = buildIterationPrompt(
				job.prompt,
				i,
				maxIterations,
				completionPromise,
				worktreePath,
			);

			// Run Claude for this iteration (with retry on crash)
			let result = await runClaudeIteration(
				iterationPrompt,
				worktreePath,
				jobId,
				iteration.id,
				completionPromise,
			);

			// Retry once on crash
			if (result.exitCode !== 0 && !result.promiseDetected) {
				await addJobMessage(
					jobId,
					"system",
					`Iteration crashed (exit code ${result.exitCode}), retrying...`,
				);
				result = await runClaudeIteration(
					iterationPrompt,
					worktreePath,
					jobId,
					iteration.id,
					completionPromise,
				);
			}

			// Update iteration record
			await updateIteration(iteration.id, {
				completed_at: new Date().toISOString(),
				exit_code: result.exitCode,
				error: result.error,
				prompt_used: iterationPrompt,
				promise_detected: result.promiseDetected,
				output_summary: result.summary,
			});

			// Check for completion promise
			if (result.promiseDetected) {
				completionReason = "promise_detected";
				await addJobMessage(
					jobId,
					"system",
					"\n✓ Completion promise detected! Task complete.",
				);
				break;
			}

			// Check for iteration failure (after retry)
			if (result.exitCode !== 0) {
				completionReason = "iteration_error";
				await addJobMessage(
					jobId,
					"system",
					`Iteration ${i} failed after retry with exit code ${result.exitCode}`,
				);
				break;
			}

			// Run feedback commands if configured
			let feedbackResults: FeedbackResult[] = [];
			if (feedbackCommands.length > 0) {
				feedbackResults = await runFeedbackCommands(
					feedbackCommands,
					worktreePath,
					jobId,
				);
				await updateIteration(iteration.id, {
					feedback_results: JSON.parse(JSON.stringify(feedbackResults)),
				});

				// Append feedback to progress file (both successes and failures)
				appendFeedbackToProgress(worktreePath, feedbackResults, i);
			}

			// Append iteration summary to progress file
			appendIterationToProgress(worktreePath, i, result.summary);

			await addJobMessage(jobId, "system", `Iteration ${i} complete.`);
		}

		// Reached max iterations without completion promise
		if (!completionReason) {
			completionReason = "max_iterations";
			await addJobMessage(
				jobId,
				"system",
				`\nReached maximum iterations (${maxIterations}) without completion.`,
			);
		}

		// 4. Post-loop: Commit, push, create PR
		await addJobMessage(jobId, "system", "\n========== CREATING PR ==========");
		const hasChanges = await commitAndPush(worktreePath, job);

		if (hasChanges) {
			const branchRecord = await createCodeBranch({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				name: job.branch_name,
				url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`,
			});

			const pr = await createPullRequest(repo, job, worktreePath);

			const prRecord = await createCodePullRequest({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				branchId: branchRecord.id,
				number: pr.number,
				title: pr.title,
				status: "open",
				url: pr.url,
			});

			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				pr_url: pr.url,
				pr_number: pr.number,
				files_changed: pr.filesChanged,
				code_branch_id: branchRecord.id,
				code_pull_request_id: prRecord.id,
				total_iterations: finalIteration,
				completion_reason: completionReason,
			});

			await addJobMessage(
				jobId,
				"system",
				`\nRalph job completed after ${finalIteration} iterations!`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Completion reason: ${completionReason}`,
			);
			await addJobMessage(jobId, "system", `PR: ${pr.url}`);

			setSpanAttributes(trace, {
				"ralph.total_iterations": finalIteration,
				"ralph.completion_reason": completionReason,
				"job.pr_url": pr.url,
			});
			endSpan(trace, "ok");
		} else {
			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				error: "No changes were made",
				total_iterations: finalIteration,
				completion_reason: completionReason,
			});

			await addJobMessage(
				jobId,
				"system",
				`\nRalph job completed after ${finalIteration} iterations but no changes were made.`,
			);

			setSpanAttributes(trace, {
				"ralph.total_iterations": finalIteration,
				"ralph.completion_reason": completionReason,
				"ralph.no_changes": true,
			});
			endSpan(trace, "ok");
		}

		// Record actual token usage for scheduling learning
		if (tokenPrediction && totalTokensUsed > 0) {
			try {
				const features = await extractJobFeatures(
					jobId,
					job.prompt,
					[],
					"typescript",
				);
				recordActualUsage(
					jobId,
					features,
					tokenPrediction.estimatedInputTokens +
						tokenPrediction.estimatedOutputTokens,
					totalTokensUsed,
				);
			} catch {
				// Recording failed, continue
			}
		}
	} catch (err) {
		console.error(`Ralph job ${jobId} failed:`, err);
		recordException(trace, err instanceof Error ? err : new Error(String(err)));

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
			completion_reason: "iteration_error",
		});

		await addJobMessage(
			jobId,
			"system",
			`Ralph job failed: ${(err as Error).message}`,
		);
		endSpan(trace, "error");
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
	completionPromise: string,
): Promise<{
	exitCode: number;
	error?: string;
	promiseDetected: boolean;
	summary: string;
}> {
	return new Promise((resolve) => {
		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"stream-json",
				"--verbose",
				prompt,
			],
			{
				cwd,
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		runningProcesses.set(jobId, proc);

		if (proc.pid) {
			updateJob(jobId, { pid: proc.pid });
			updateIteration(iterationId, { pid: proc.pid });
		}

		let stdout = "";
		let stderrBuffer = "";

		proc.stdout.on("data", (data: Buffer) => {
			const content = data.toString();
			stdout += content;
			process.stdout.write(content);
			addJobMessage(jobId, "stdout", content);
		});

		proc.stderr.on("data", (data: Buffer) => {
			const content = data.toString();
			stderrBuffer += content;
			process.stderr.write(content);
			addJobMessage(jobId, "stderr", content);
		});

		proc.on("close", (code: number | null) => {
			runningProcesses.delete(jobId);

			const promiseDetected = stdout.includes(completionPromise);
			const summary = extractSummary(stdout);

			resolve({
				exitCode: code || 0,
				error: code !== 0 ? stderrBuffer || "Unknown error" : undefined,
				promiseDetected,
				summary,
			});
		});

		proc.on("error", (err: Error) => {
			runningProcesses.delete(jobId);
			resolve({
				exitCode: 1,
				error: (err as Error).message,
				promiseDetected: false,
				summary: "",
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
	worktreePath: string,
): string {
	const progressContent = readProgressFile(worktreePath);

	return `## Ralph Loop Context
- Iteration: ${iteration} of ${maxIterations}
- To signal completion, output: ${completionPromise}

## Previous Progress
${progressContent || "No previous progress - this is the first iteration."}

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
	jobId: string,
): Promise<FeedbackResult[]> {
	const results: FeedbackResult[] = [];

	for (const command of commands) {
		await addJobMessage(jobId, "system", `Running feedback: ${command}`);

		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd,
				timeout: 120000,
			});
			results.push({
				command,
				exitCode: 0,
				stdout: stdout.slice(0, 5000), // Limit output size
				stderr: stderr.slice(0, 5000),
				passed: true,
			});
			await addJobMessage(jobId, "system", `✓ ${command} passed`);
		} catch (err) {
			const execErr = err as {
				code?: number;
				stdout?: string;
				stderr?: string;
				message?: string;
			};
			results.push({
				command,
				exitCode: execErr.code || 1,
				stdout: (execErr.stdout || "").slice(0, 5000),
				stderr: (execErr.stderr || execErr.message || "").slice(0, 5000),
				passed: false,
			});
			await addJobMessage(
				jobId,
				"system",
				`✗ ${command} failed (exit code ${execErr.code || 1})`,
			);
		}
	}

	return results;
}

// Progress file helpers
function initProgressFile(
	worktreePath: string,
	jobId: string,
	branchName: string,
): void {
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
		return readFileSync(progressPath, "utf8");
	}
	return "";
}

function appendIterationToProgress(
	worktreePath: string,
	iteration: number,
	summary: string,
): void {
	const progressPath = join(worktreePath, PROGRESS_FILE);
	const content = `
## Iteration ${iteration}
Completed: ${new Date().toISOString()}

### Summary
${summary || "No summary provided."}

---
`;
	appendFileSync(progressPath, content);
}

function appendFeedbackToProgress(
	worktreePath: string,
	results: FeedbackResult[],
	iteration: number,
): void {
	const progressPath = join(worktreePath, PROGRESS_FILE);

	const feedbackLines = results
		.map((r) => {
			const status = r.passed ? "✓ PASSED" : "✗ FAILED";
			let line = `- \`${r.command}\`: ${status}`;
			if (!r.passed && r.stderr) {
				// Include first few lines of error for context
				const errorPreview = r.stderr.split("\n").slice(0, 5).join("\n  ");
				line += `\n  Error: ${errorPreview}`;
			}
			return line;
		})
		.join("\n");

	const content = `
### Feedback Results (Iteration ${iteration})
${feedbackLines}

`;
	appendFileSync(progressPath, content);
}

// Extract summary from Claude's output (look for ## Summary section)
function extractSummary(output: string): string {
	// Try to find a ## Summary section
	const summaryMatch = output.match(
		/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/i,
	);
	if (summaryMatch) {
		return summaryMatch[1].trim().slice(0, 2000); // Limit size
	}

	// Fallback: get last meaningful chunk of output
	const lines = output.split("\n").filter((l) => l.trim());
	return lines.slice(-10).join("\n").slice(0, 1000);
}

// ===== PRD Mode Runner =====

const PRD_FILE = "prd.json";

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
			status: "failed",
			error:
				"No repository found for client. Add one to code_repositories first.",
			completed_at: new Date().toISOString(),
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
	const prdProgress: PrdProgress =
		(job.prd_progress as unknown as PrdProgress) || {
			currentStoryId: null,
			completedStoryIds: [],
			commits: [],
		};

	let worktreePath: string | null = null;

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
			current_iteration: 0,
		});

		await addJobMessage(
			jobId,
			"system",
			`Starting PRD-mode Ralph job for ${repo.owner_name}/${repo.repo_name}`,
		);
		await addJobMessage(
			jobId,
			"system",
			`PRD: "${prd.title}" with ${prd.stories.length} stories`,
		);
		await addJobMessage(jobId, "system", `Max iterations: ${maxIterations}`);

		// 1. Setup git
		await addJobMessage(jobId, "system", "Ensuring bare repository exists...");
		await ensureBareRepo(repo);

		await addJobMessage(jobId, "system", "Fetching latest from origin...");
		await fetchOrigin(repo);

		await addJobMessage(
			jobId,
			"system",
			`Creating worktree: ${job.branch_name}`,
		);
		worktreePath = await createWorktree(repo, job);
		await updateJob(jobId, { worktree_path: worktreePath });

		// 2. Check if prd.json already exists (from previous job on this branch)
		const existingPrd = readPrdFile(worktreePath);

		if (existingPrd && existingPrd.title === prd.title) {
			// Same PRD - sync progress from existing prd.json
			const completedStories = existingPrd.stories.filter((s) => s.passes);
			prdProgress.completedStoryIds = completedStories.map((s) => s.id);
			prdProgress.currentStoryId =
				existingPrd.stories.find((s) => !s.passes)?.id || null;

			await addJobMessage(
				jobId,
				"system",
				`Found existing prd.json with ${completedStories.length}/${existingPrd.stories.length} stories complete`,
			);
			await updatePrdProgress(jobId, prdProgress);
		} else {
			// Fresh start or stale PRD - initialize prd.json and progress file
			if (existingPrd) {
				await addJobMessage(
					jobId,
					"system",
					`Found stale prd.json ("${existingPrd.title}"), replacing with current PRD`,
				);
			}
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
			if (currentJob?.status === "cancelled") {
				completionReason = "manual_stop";
				await addJobMessage(
					jobId,
					"system",
					`Job was cancelled at iteration ${i}`,
				);
				break;
			}

			// Check if all stories are complete
			const currentPrd = readPrdFile(worktreePath);
			if (!currentPrd) {
				throw new Error("prd.json is missing or corrupted during iteration");
			}
			const incompleteStories = currentPrd.stories.filter((s) => !s.passes);

			if (incompleteStories.length === 0) {
				completionReason = "all_stories_complete";
				await addJobMessage(jobId, "system", "\n✓ All stories complete!");
				break;
			}

			await updateJob(jobId, { current_iteration: i });
			await addJobMessage(
				jobId,
				"system",
				`\n========== ITERATION ${i}/${maxIterations} ==========`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Incomplete stories: ${incompleteStories.map((s) => `#${s.id}`).join(", ")}`,
			);

			// Create iteration record
			const iteration = await createIteration(jobId, i);

			// Build PRD iteration prompt
			const iterationPrompt = buildPrdIterationPrompt(
				job.prompt,
				currentPrd,
				i,
				maxIterations,
				job.branch_name,
			);

			// Run Claude for this iteration (with retry on crash)
			// Use <promise>COMPLETE</promise> as signal that ALL stories are done (matches original Ralph)
			let result = await runClaudeIteration(
				iterationPrompt,
				worktreePath,
				jobId,
				iteration.id,
				"<promise>COMPLETE</promise>",
			);

			// Retry once on crash
			if (result.exitCode !== 0 && !result.promiseDetected) {
				await addJobMessage(
					jobId,
					"system",
					`Iteration crashed (exit code ${result.exitCode}), retrying...`,
				);
				result = await runClaudeIteration(
					iterationPrompt,
					worktreePath,
					jobId,
					iteration.id,
					"<promise>COMPLETE</promise>",
				);
			}

			// Check for iteration failure (after retry)
			if (result.exitCode !== 0) {
				completionReason = "iteration_error";
				await addJobMessage(
					jobId,
					"system",
					`Iteration ${i} failed after retry with exit code ${result.exitCode}`,
				);

				await updateIteration(iteration.id, {
					completed_at: new Date().toISOString(),
					exit_code: result.exitCode,
					error: result.error,
					prompt_used: iterationPrompt,
					promise_detected: false,
					output_summary: result.summary,
				});
				break;
			}

			// Check prd.json for newly completed stories (Claude manages this, we just track)
			// IMPORTANT: Do this BEFORE checking promiseDetected so we track commits even if Claude completes all stories
			const updatedPrd = readPrdFile(worktreePath);
			if (!updatedPrd) {
				throw new Error("prd.json is missing or corrupted after iteration");
			}
			const newlyCompleted = findNewlyCompletedStories(
				prdProgress.completedStoryIds,
				updatedPrd.stories,
			);

			// Process ALL newly completed stories
			if (newlyCompleted.length > 0) {
				await addJobMessage(
					jobId,
					"system",
					`Completed ${newlyCompleted.length} stories this iteration`,
				);

				for (const story of newlyCompleted) {
					// Try to find the commit Claude made for this story
					let commitSha: string | null = null;
					try {
						const { stdout } = await execAsync(
							`git log --oneline -1 --grep="story-${story.id}" --format="%H"`,
							{ cwd: worktreePath },
						);
						commitSha = stdout.trim() || null;
					} catch {
						// No commit found for this story
					}

					// If no story-specific commit found, check for any new commit since last known
					if (!commitSha) {
						try {
							const lastKnownCommit =
								prdProgress.commits[prdProgress.commits.length - 1]?.sha;
							const { stdout } = await execAsync(
								lastKnownCommit
									? `git log --oneline -1 ${lastKnownCommit}..HEAD --format="%H"`
									: `git log --oneline -1 --format="%H"`,
								{ cwd: worktreePath },
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
							timestamp: new Date().toISOString(),
						};

						prdProgress.commits.push(prdCommit);
						prdProgress.completedStoryIds.push(story.id);

						await addJobMessage(
							jobId,
							"system",
							`✓ Story #${story.id} committed: ${commitSha.substring(0, 7)}`,
						);
					} else {
						// Story marked complete but no commit found - still track it
						prdProgress.completedStoryIds.push(story.id);
						await addJobMessage(
							jobId,
							"system",
							`✓ Story #${story.id} marked complete (no commit found)`,
						);
					}

					// Update todo status in database (story.id is 1-indexed, order_index is 0-indexed)
					if (job.feature_id) {
						try {
							const orderIndex = story.id - 1; // Convert 1-indexed story ID to 0-indexed order_index
							await updateTodoStatusByFeatureAndOrder(
								job.feature_id,
								orderIndex,
								"done",
							);
							await addJobMessage(
								jobId,
								"system",
								`Updated todo (order_index=${orderIndex}) status to done`,
							);
						} catch (err) {
							await addJobMessage(
								jobId,
								"system",
								`Warning: Failed to update todo status: ${err}`,
							);
						}
					}
				}

				// Update iteration with first story info (for backwards compatibility)
				const firstStory = newlyCompleted[0];
				const firstCommit = prdProgress.commits.find(
					(c) => c.storyId === firstStory.id,
				);
				if (firstCommit) {
					await updateIteration(iteration.id, {
						story_id: firstStory.id,
						commit_sha: firstCommit.sha,
					});
				}
			}

			// Update current story being worked on (first incomplete)
			const nextIncomplete = updatedPrd.stories.find((s) => !s.passes);
			prdProgress.currentStoryId = nextIncomplete?.id || null;

			// Save progress to database
			await updatePrdProgress(jobId, prdProgress);

			// Update iteration record
			await updateIteration(iteration.id, {
				completed_at: new Date().toISOString(),
				exit_code: result.exitCode,
				prompt_used: iterationPrompt,
				promise_detected: result.promiseDetected || newlyCompleted.length > 0,
				output_summary: result.summary,
			});

			// Append to progress file (no feedback results - Claude runs tests itself)
			appendPrdIterationToProgress(
				worktreePath,
				i,
				result.summary,
				newlyCompleted,
				[],
			);

			// Push after each iteration to save progress (prevents losing work if job crashes later)
			if (newlyCompleted.length > 0) {
				try {
					pushBranch(worktreePath, job.branch_name);
					await addJobMessage(
						jobId,
						"system",
						`Pushed commits to origin/${job.branch_name}`,
					);
				} catch (err) {
					await addJobMessage(
						jobId,
						"system",
						`Warning: Failed to push: ${err}`,
					);
				}
			}

			await addJobMessage(
				jobId,
				"system",
				`Iteration ${i} complete. Completed stories: ${prdProgress.completedStoryIds.length}/${prd.stories.length}`,
			);

			// Check if Claude signaled ALL stories complete - break AFTER tracking commits
			if (result.promiseDetected) {
				completionReason = "promise_detected";
				await addJobMessage(
					jobId,
					"system",
					"Claude signaled ALL stories complete with <promise>COMPLETE</promise>",
				);
				break;
			}
		}

		// Reached max iterations without completing all stories
		if (!completionReason) {
			completionReason = "max_iterations";
			await addJobMessage(
				jobId,
				"system",
				`\nReached maximum iterations (${maxIterations}) without completing all stories.`,
			);
		}

		// 4. Post-loop: Sync final state from prd.json to database
		await addJobMessage(
			jobId,
			"system",
			"\n========== SYNCING FINAL STATE ==========",
		);

		// Read final prd.json state from worktree
		const finalPrd = readPrdFile(worktreePath);
		if (finalPrd) {
			const finalCompletedStories = finalPrd.stories.filter((s) => s.passes);
			prdProgress.completedStoryIds = finalCompletedStories.map((s) => s.id);
		}

		// Sync todo statuses from prd.json (if feature_id exists)
		if (job.feature_id && finalPrd) {
			try {
				const syncResult = await syncTodosFromPrd(
					job.feature_id,
					finalPrd.stories,
				);
				await addJobMessage(
					jobId,
					"system",
					`Synced ${syncResult.updated} todos from prd.json`,
				);
			} catch (err) {
				await addJobMessage(
					jobId,
					"system",
					`Warning: Failed to sync todos: ${err}`,
				);
			}
		}

		// 5. Post-loop: Create PR (commits already pushed after each iteration)
		await addJobMessage(jobId, "system", "\n========== CREATING PR ==========");

		if (prdProgress.commits.length > 0) {
			const branchRecord = await createCodeBranch({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				name: job.branch_name,
				url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`,
			});

			const pr = await createPullRequest(repo, job, worktreePath);

			const prRecord = await createCodePullRequest({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				branchId: branchRecord.id,
				number: pr.number,
				title: pr.title,
				status: "open",
				url: pr.url,
			});

			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				pr_url: pr.url,
				pr_number: pr.number,
				files_changed: pr.filesChanged,
				code_branch_id: branchRecord.id,
				code_pull_request_id: prRecord.id,
				total_iterations: finalIteration,
				completion_reason: completionReason,
				prd_progress: JSON.parse(JSON.stringify(prdProgress)),
			});

			await addJobMessage(
				jobId,
				"system",
				`\nPRD job completed after ${finalIteration} iterations!`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Completion reason: ${completionReason}`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Stories completed: ${prdProgress.completedStoryIds.length}/${prd.stories.length}`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Commits: ${prdProgress.commits.length}`,
			);
			await addJobMessage(jobId, "system", `PR: ${pr.url}`);

			// Update feature workflow stage to "Ready for Review"
			if (job.feature_id) {
				try {
					await updateFeatureWorkflowStage(
						job.feature_id,
						WORKFLOW_STAGE_READY_FOR_REVIEW,
					);
					await addJobMessage(
						jobId,
						"system",
						`Updated feature workflow stage to "Ready for Review"`,
					);
				} catch (err) {
					await addJobMessage(
						jobId,
						"system",
						`Warning: Failed to update feature workflow stage: ${err}`,
					);
				}
			}

			// Trigger Vercel preview deployments for all configured projects and add feature comment
			if (job.feature_id && repo.client_id) {
				try {
					const vercelTools = await getClientToolsByType(
						repo.client_id,
						"vercel",
					);
					const deployments: {
						projectName: string;
						url: string;
						inspectorUrl: string;
					}[] = [];

					for (const vercelTool of vercelTools) {
						const metadata =
							typeof vercelTool.metadata === "string"
								? JSON.parse(vercelTool.metadata)
								: vercelTool.metadata;

						if (metadata?.githubRepoId) {
							try {
								const projectName =
									metadata.projectName ||
									vercelTool.external_id ||
									"Unknown Project";
								const deployment = await triggerVercelDeploymentForTool(
									vercelTool,
									job.branch_name,
								);

								if (deployment) {
									deployments.push({
										projectName,
										url: deployment.url,
										inspectorUrl: deployment.inspectorUrl,
									});
									await addJobMessage(
										jobId,
										"system",
										`Triggered Vercel preview for ${projectName}: ${deployment.url}`,
									);
								}
							} catch (err) {
								await addJobMessage(
									jobId,
									"system",
									`Vercel deployment failed for ${metadata.projectName || vercelTool.external_id}: ${(err as Error).message}`,
								);
							}
						}
					}

					// Add comment with PR link and deployment links (if any)
					const prLink = `<p class="text-node"><strong>Pull Request</strong>: <a href="${pr.url}" target="_blank">${pr.url}</a></p>`;
					const deploymentLinks = deployments
						.map(
							(d) =>
								`<p class="text-node"><strong>${d.projectName}</strong>: <a href="${d.url}" target="_blank">${d.url}</a> (<a href="${d.inspectorUrl}" target="_blank">build status</a>)</p>`,
						)
						.join("");

					await createComment({
						parentType: "feature",
						parentId: job.feature_id,
						body: prLink + deploymentLinks,
					});

					await addJobMessage(
						jobId,
						"system",
						`Added comment to feature with PR link and ${deployments.length} preview(s)`,
					);
				} catch (err) {
					await addJobMessage(
						jobId,
						"system",
						`Vercel deployment failed: ${(err as Error).message}`,
					);
					// Don't fail the job - deployment is optional
				}
			}
		} else {
			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				error: "No stories were completed",
				total_iterations: finalIteration,
				completion_reason: completionReason,
				prd_progress: JSON.parse(JSON.stringify(prdProgress)),
			});

			await addJobMessage(
				jobId,
				"system",
				`\nPRD job completed after ${finalIteration} iterations but no stories were completed.`,
			);
		}
	} catch (err) {
		console.error(`PRD job ${jobId} failed:`, err);

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
			completion_reason: "iteration_error",
			prd_progress: JSON.parse(JSON.stringify(prdProgress)),
		});

		await addJobMessage(
			jobId,
			"system",
			`PRD job failed: ${(err as Error).message}`,
		);
	} finally {
		// Keep worktree for debugging - will be cleaned up on next job for same branch
	}
}

// ===== PRD Generation Job Runner =====

// PRD structure based on ai-dev-tasks pattern
interface GeneratedPrd {
	title: string;
	overview: string;
	goals: string[];
	userStories: string[];
	functionalRequirements: string[];
	nonGoals: string[];
	technicalConsiderations: string[];
	successMetrics: string[];
}

interface GeneratedTask {
	title: string;
	description: string;
	orderIndex: number;
}

// Prompts for PRD generation
const PRD_PROMPT = `You are a product manager creating a PRD (Product Requirements Document) for a development feature.

Based on the feature information provided, generate a comprehensive PRD in JSON format.

IMPORTANT: Your response must be ONLY valid JSON, no markdown, no explanation, just the JSON object.

The JSON structure must be:
{
  "title": "Feature title",
  "overview": "Brief 2-3 sentence description of what this feature does and why it matters",
  "goals": ["Goal 1", "Goal 2", ...],
  "userStories": ["As a [user], I want to [action] so that [benefit]", ...],
  "functionalRequirements": ["Requirement 1", "Requirement 2", ...],
  "nonGoals": ["What this feature will NOT do", ...],
  "technicalConsiderations": ["Technical note 1", ...],
  "successMetrics": ["How to measure success", ...]
}

Guidelines:
- Write for junior developers - be explicit and unambiguous
- Goals should be measurable outcomes
- User stories should follow the standard format
- Functional requirements should be specific and testable
- Non-goals help define scope boundaries
- Technical considerations should inform implementation approach
- Success metrics should be quantifiable where possible

Feature Information:
`;

const TASKS_PROMPT = `You are a technical lead breaking down a PRD into implementation tasks.

Based on the PRD provided, generate a detailed task list in JSON format.

IMPORTANT: Your response must be ONLY valid JSON, no markdown, no explanation, just the JSON array.

The JSON structure must be an array of tasks:
[
  {
    "title": "Short task title (5-10 words)",
    "description": "Detailed description with implementation guidance for a junior developer",
    "orderIndex": 1
  },
  ...
]

Guidelines:
- Start with "Create feature branch" as task 0
- Break down into granular, actionable sub-tasks
- Each task should be completable in 1-4 hours
- Target junior developers - include implementation hints
- Order tasks logically (dependencies first)
- Include testing tasks where appropriate
- Aim for 5-15 tasks depending on complexity

PRD:
`;

function extractJsonFromResponse(text: string): string {
	const jsonStr = text.trim();

	// First, try to find JSON within markdown code blocks anywhere in the text
	const jsonBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return jsonBlockMatch[1].trim();
	}

	// Try generic code block
	const codeBlockMatch = jsonStr.match(/```\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return codeBlockMatch[1].trim();
	}

	// Try to find raw JSON object or array (starts with { or [)
	const jsonObjectMatch = jsonStr.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
	if (jsonObjectMatch) {
		return jsonObjectMatch[1].trim();
	}

	return jsonStr.trim();
}

function buildFeatureContext(feature: FeatureWithClient): string {
	const parts: string[] = [];

	parts.push(`Title: ${feature.title}`);

	if (feature.client?.name) {
		parts.push(`Client: ${feature.client.name}`);
	}

	if (feature.functionality_notes) {
		parts.push(`\nFunctionality Notes:\n${feature.functionality_notes}`);
	}

	if (feature.client_context) {
		parts.push(`\nClient Context:\n${feature.client_context}`);
	}

	return parts.join("\n");
}

async function runClaudeForPrdGeneration(
	prompt: string,
	jobId: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		let errorOutput = "";

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"text",
				prompt,
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		runningProcesses.set(jobId, proc);

		proc.stdout.on("data", (data: Buffer) => {
			output += data.toString();
		});

		proc.stderr.on("data", (data: Buffer) => {
			errorOutput += data.toString();
		});

		proc.on("close", (code: number | null) => {
			runningProcesses.delete(jobId);
			if (code !== 0) {
				reject(new Error(`Claude exited with code ${code}: ${errorOutput}`));
			} else {
				resolve(output.trim());
			}
		});

		proc.on("error", (err: Error) => {
			runningProcesses.delete(jobId);
			reject(err);
		});
	});
}

export async function runPrdGenerationJob(jobId: string): Promise<void> {
	const job = await getJob(jobId);
	if (!job) throw new Error(`Job not found: ${jobId}`);

	const featureId = job.feature_id;
	if (!featureId) {
		await updateJob(jobId, {
			status: "failed",
			error: "No feature_id provided for PRD generation job",
			completed_at: new Date().toISOString(),
		});
		return;
	}

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
		});

		// 1. Get feature from database
		const feature = await getFeature(featureId);
		if (!feature) {
			throw new Error(`Feature not found: ${featureId}`);
		}

		const featureContext = buildFeatureContext(feature);
		await addJobMessage(
			jobId,
			"system",
			`Generating PRD for feature: ${feature.title}`,
		);

		// 2. Generate PRD using Claude
		const prdPrompt = PRD_PROMPT + featureContext;
		await addJobMessage(
			jobId,
			"system",
			"Calling Claude for PRD generation...",
		);
		const prdResponse = await runClaudeForPrdGeneration(prdPrompt, jobId);

		let prd: GeneratedPrd;
		try {
			const jsonStr = extractJsonFromResponse(prdResponse);
			prd = JSON.parse(jsonStr);
		} catch (err) {
			throw new Error(
				`Failed to parse PRD response as JSON: ${err}. Response was: ${prdResponse.slice(0, 500)}`,
			);
		}

		await addJobMessage(jobId, "system", `PRD generated: "${prd.title}"`);

		// 3. Generate tasks using Claude
		const tasksPrompt = TASKS_PROMPT + JSON.stringify(prd, null, 2);
		await addJobMessage(
			jobId,
			"system",
			"Calling Claude for task generation...",
		);
		const tasksResponse = await runClaudeForPrdGeneration(tasksPrompt, jobId);

		let tasks: GeneratedTask[];
		try {
			const jsonStr = extractJsonFromResponse(tasksResponse);
			tasks = JSON.parse(jsonStr);
		} catch (err) {
			throw new Error(
				`Failed to parse tasks response as JSON: ${err}. Response was: ${tasksResponse.slice(0, 500)}`,
			);
		}

		await addJobMessage(jobId, "system", `Generated ${tasks.length} tasks`);

		// 4. Clear existing todos (PRD generation always replaces)
		const deleted = await deleteTodosByFeatureId(featureId);
		if (deleted > 0) {
			await addJobMessage(jobId, "system", `Deleted ${deleted} existing todos`);
		}

		// 5. Save PRD to feature record
		await updateFeaturePrd(featureId, prd);
		await addJobMessage(jobId, "system", "Saved PRD to feature record");

		// 6. Create todos in database
		const todoInserts: TodoInsert[] = tasks.map((task) => ({
			feature_id: featureId,
			title: task.title,
			description: task.description,
			status: "pending",
			order_index: task.orderIndex,
		}));

		const createdTodos = await createTodos(todoInserts);
		await addJobMessage(
			jobId,
			"system",
			`Created ${createdTodos.length} todos`,
		);

		// 7. Mark job as completed
		await updateJob(jobId, {
			status: "completed",
			completed_at: new Date().toISOString(),
			exit_code: 0,
		});

		await addJobMessage(
			jobId,
			"system",
			"PRD generation completed successfully!",
		);
	} catch (err) {
		console.error(`PRD generation job ${jobId} failed:`, err);

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
		});

		await addJobMessage(
			jobId,
			"system",
			`PRD generation failed: ${(err as Error).message}`,
		);
	}
}

// Vercel deployment helper - supports multiple Vercel projects per client
async function triggerVercelDeploymentForTool(
	vercelTool: { external_id: string | null; metadata: unknown },
	branchName: string,
): Promise<{ url: string; inspectorUrl: string } | null> {
	const metadata =
		typeof vercelTool.metadata === "string"
			? JSON.parse(vercelTool.metadata)
			: (vercelTool.metadata as Record<string, unknown>);

	if (!metadata?.githubRepoId) {
		return null;
	}

	// Resolve token from env var or use direct token
	const token = metadata.tokenEnvVar
		? process.env[metadata.tokenEnvVar as string]
		: metadata.token;

	if (!token) {
		console.error(
			`Vercel token not found: ${metadata.tokenEnvVar || "no tokenEnvVar or token specified"}`,
		);
		return null;
	}

	const response = await fetch("https://api.vercel.com/v13/deployments", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name: metadata.projectName || vercelTool.external_id,
			gitSource: {
				type: "github",
				repoId: metadata.githubRepoId,
				ref: branchName,
			},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error("Vercel deployment failed:", errorText);
		throw new Error(`Vercel API error: ${response.status} - ${errorText}`);
	}

	const data = await response.json();
	return {
		url: `https://${data.url}`,
		inspectorUrl: data.inspectorUrl,
	};
}

// PRD file helpers
function writePrdFile(worktreePath: string, prd: Prd): void {
	const prdPath = join(worktreePath, PRD_FILE);
	writeFileSync(prdPath, JSON.stringify(prd, null, 2));
}

function readPrdFile(worktreePath: string): Prd | null {
	const prdPath = join(worktreePath, PRD_FILE);
	if (!existsSync(prdPath)) {
		return null;
	}
	try {
		const content = readFileSync(prdPath, "utf8");
		if (!content.trim()) {
			return null; // Empty file
		}
		return JSON.parse(content);
	} catch {
		return null; // Corrupted JSON
	}
}

function findNewlyCompletedStories(
	previouslyCompleted: number[],
	currentStories: PrdStory[],
): PrdStory[] {
	return currentStories.filter(
		(story) => story.passes && !previouslyCompleted.includes(story.id),
	);
}

function initPrdProgressFile(
	worktreePath: string,
	jobId: string,
	branchName: string,
	prd: Prd,
): void {
	const progressPath = join(worktreePath, PROGRESS_FILE);

	const storiesList = prd.stories
		.map((s) => `- [ ] Story #${s.id}: ${s.title}`)
		.join("\n");

	const content = `# PRD Progress Log
Job ID: ${jobId}
Branch: ${branchName}
Started: ${new Date().toISOString()}

## PRD: ${prd.title}
${prd.description || ""}

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
	branchName: string,
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
	feedbackResults: FeedbackResult[],
): void {
	const progressPath = join(worktreePath, PROGRESS_FILE);

	const completedList =
		completedStories.length > 0
			? `\n### Completed Stories\n${completedStories.map((s) => `- Story #${s.id}: ${s.title}`).join("\n")}`
			: "";

	const feedbackLines =
		feedbackResults.length > 0
			? `\n### Feedback Results\n${feedbackResults
					.map((r) => {
						const status = r.passed ? "✓ PASSED" : "✗ FAILED";
						let line = `- \`${r.command}\`: ${status}`;
						if (!r.passed && r.stderr) {
							const errorPreview = r.stderr
								.split("\n")
								.slice(0, 3)
								.join("\n  ");
							line += `\n  Error: ${errorPreview}`;
						}
						return line;
					})
					.join("\n")}`
			: "";

	const content = `
## Iteration ${iteration}
Completed: ${new Date().toISOString()}
${completedList}

### Summary
${summary || "No summary provided."}
${feedbackLines}

---
`;
	appendFileSync(progressPath, content);
}

// ===== Spec-Kit Ralph Job Runner =====

import type { SpecOutput } from "./db/types.js";

const SPEC_PROGRESS_FILE = ".spec-progress.md";
const SPEC_TASKS_FILE = ".spec-tasks.json";

export async function runRalphSpecJob(jobId: string): Promise<void> {
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
			status: "failed",
			error:
				"No repository found for client. Add one to code_repositories first.",
			completed_at: new Date().toISOString(),
		});
		return;
	}

	// Update job with repository_id if it wasn't set
	if (!job.repository_id) {
		await updateJob(jobId, { repository_id: repo.id });
	}

	const maxIterations = job.max_iterations || 20;
	const specOutput = job.spec_output as unknown as SpecOutput;

	if (!specOutput || !specOutput.tasks || specOutput.tasks.length === 0) {
		await updateJob(jobId, {
			status: "failed",
			error: "No spec-kit tasks found. Run spec-kit pipeline first.",
			completed_at: new Date().toISOString(),
		});
		return;
	}

	// Track task completion state
	const completedTaskIds: number[] = [];
	let worktreePath: string | null = null;

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
			current_iteration: 0,
		});

		await addJobMessage(
			jobId,
			"system",
			`Starting Spec-Kit Ralph job for ${repo.owner_name}/${repo.repo_name}`,
		);
		await addJobMessage(
			jobId,
			"system",
			`Tasks: ${specOutput.tasks.length} | Max iterations: ${maxIterations}`,
		);

		// 1. Setup git
		await addJobMessage(jobId, "system", "Ensuring bare repository exists...");
		await ensureBareRepo(repo);

		await addJobMessage(jobId, "system", "Fetching latest from origin...");
		await fetchOrigin(repo);

		await addJobMessage(
			jobId,
			"system",
			`Creating worktree: ${job.branch_name}`,
		);
		worktreePath = await createWorktree(repo, job);
		await updateJob(jobId, { worktree_path: worktreePath });

		// 2. Initialize spec progress files
		const existingTasks = readSpecTasksFile(worktreePath);
		if (existingTasks) {
			// Resume from existing state
			for (const task of existingTasks) {
				if (task.completed) {
					completedTaskIds.push(task.id);
				}
			}
			await addJobMessage(
				jobId,
				"system",
				`Found existing progress: ${completedTaskIds.length}/${specOutput.tasks.length} tasks complete`,
			);
		} else {
			// Fresh start
			initSpecProgressFile(worktreePath, job.id, job.branch_name, specOutput);
			writeSpecTasksFile(worktreePath, specOutput.tasks);
		}

		// 3. Iteration loop
		let completionReason: RalphCompletionReason | null = null;
		let finalIteration = 0;

		for (let i = 1; i <= maxIterations; i++) {
			finalIteration = i;

			// Check for manual stop request
			const currentJob = await getJob(jobId);
			if (currentJob?.status === "cancelled") {
				completionReason = "manual_stop";
				await addJobMessage(
					jobId,
					"system",
					`Job was cancelled at iteration ${i}`,
				);
				break;
			}

			// Get next task (respecting dependencies)
			const nextTask = getNextSpecTask(specOutput.tasks, completedTaskIds);
			if (!nextTask) {
				completionReason = "all_stories_complete";
				await addJobMessage(
					jobId,
					"system",
					"\n✓ All spec-kit tasks complete!",
				);
				break;
			}

			await updateJob(jobId, { current_iteration: i });
			await addJobMessage(
				jobId,
				"system",
				`\n========== ITERATION ${i}/${maxIterations} ==========`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Working on Task #${nextTask.id}: ${nextTask.title}`,
			);

			// Create iteration record
			const iteration = await createIteration(jobId, i);

			// Build spec-kit iteration prompt with FULL context
			const iterationPrompt = buildSpecIterationPrompt(
				job.prompt,
				specOutput,
				nextTask,
				completedTaskIds,
				i,
				maxIterations,
				job.branch_name,
				job.feature_id || undefined,
			);

			// Run Claude for this iteration
			let result = await runClaudeIteration(
				iterationPrompt,
				worktreePath,
				jobId,
				iteration.id,
				`<task-complete>${nextTask.id}</task-complete>`,
			);

			// Retry once on crash
			if (result.exitCode !== 0 && !result.promiseDetected) {
				await addJobMessage(
					jobId,
					"system",
					`Iteration crashed (exit code ${result.exitCode}), retrying...`,
				);
				result = await runClaudeIteration(
					iterationPrompt,
					worktreePath,
					jobId,
					iteration.id,
					`<task-complete>${nextTask.id}</task-complete>`,
				);
			}

			// Check for iteration failure (after retry)
			if (result.exitCode !== 0) {
				completionReason = "iteration_error";
				await addJobMessage(
					jobId,
					"system",
					`Iteration ${i} failed after retry with exit code ${result.exitCode}`,
				);

				await updateIteration(iteration.id, {
					completed_at: new Date().toISOString(),
					exit_code: result.exitCode,
					error: result.error,
					prompt_used: iterationPrompt,
					promise_detected: false,
					output_summary: result.summary,
				});
				break;
			}

			// Check if task was completed
			if (result.promiseDetected) {
				completedTaskIds.push(nextTask.id);
				await addJobMessage(
					jobId,
					"system",
					`✓ Task #${nextTask.id} completed`,
				);

				// Update spec-tasks.json
				updateSpecTasksFile(worktreePath, nextTask.id);

				// Update spec_output in database with ALL completed tasks
				// This ensures previously completed tasks are also marked
				for (const taskId of completedTaskIds) {
					const task = specOutput.tasks.find((t) => t.id === taskId);
					if (task) task.completed = true;
				}
				await updateJob(jobId, {
					spec_output: specOutput as unknown as Json,
				});

				// Try to find the commit
				let commitSha: string | null = null;
				try {
					const { stdout } = await execAsync(
						`git log --oneline -1 --grep="task-${nextTask.id}" --format="%H"`,
						{ cwd: worktreePath },
					);
					commitSha = stdout.trim() || null;
				} catch {
					// No commit found
				}

				if (commitSha) {
					await updateIteration(iteration.id, {
						commit_sha: commitSha,
						story_id: nextTask.id,
					});
					await addJobMessage(
						jobId,
						"system",
						`Commit: ${commitSha.substring(0, 7)}`,
					);
				}
			}

			// Update iteration record
			await updateIteration(iteration.id, {
				completed_at: new Date().toISOString(),
				exit_code: result.exitCode,
				prompt_used: iterationPrompt,
				promise_detected: result.promiseDetected,
				output_summary: result.summary,
			});

			// Append to progress file
			appendSpecIterationToProgress(
				worktreePath,
				i,
				result.summary,
				result.promiseDetected ? nextTask : null,
			);

			// Push after each completed task to save progress
			if (result.promiseDetected) {
				try {
					pushBranch(worktreePath, job.branch_name);
					await addJobMessage(
						jobId,
						"system",
						`Pushed to origin/${job.branch_name}`,
					);
				} catch (err) {
					await addJobMessage(
						jobId,
						"system",
						`Warning: Failed to push: ${err}`,
					);
				}
			}

			await addJobMessage(
				jobId,
				"system",
				`Iteration ${i} complete. Tasks: ${completedTaskIds.length}/${specOutput.tasks.length}`,
			);
		}

		// Reached max iterations
		if (!completionReason) {
			completionReason = "max_iterations";
			await addJobMessage(
				jobId,
				"system",
				`\nReached maximum iterations (${maxIterations}) without completing all tasks.`,
			);
		}

		// 4. Post-loop: Create PR
		await addJobMessage(jobId, "system", "\n========== CREATING PR ==========");

		if (completedTaskIds.length > 0) {
			const branchRecord = await createCodeBranch({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				name: job.branch_name,
				url: `https://github.com/${repo.owner_name}/${repo.repo_name}/tree/${job.branch_name}`,
			});

			const pr = await createPullRequest(repo, job, worktreePath);

			const prRecord = await createCodePullRequest({
				repositoryId: repo.id,
				featureId: job.feature_id || undefined,
				branchId: branchRecord.id,
				number: pr.number,
				title: pr.title,
				status: "open",
				url: pr.url,
			});

			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				pr_url: pr.url,
				pr_number: pr.number,
				files_changed: pr.filesChanged,
				code_branch_id: branchRecord.id,
				code_pull_request_id: prRecord.id,
				total_iterations: finalIteration,
				completion_reason: completionReason,
			});

			await addJobMessage(
				jobId,
				"system",
				`\nSpec-Kit job completed after ${finalIteration} iterations!`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Completion reason: ${completionReason}`,
			);
			await addJobMessage(
				jobId,
				"system",
				`Tasks completed: ${completedTaskIds.length}/${specOutput.tasks.length}`,
			);
			await addJobMessage(jobId, "system", `PR: ${pr.url}`);

			// Update feature workflow stage
			if (job.feature_id) {
				try {
					await updateFeatureWorkflowStage(
						job.feature_id,
						WORKFLOW_STAGE_READY_FOR_REVIEW,
					);
					await addJobMessage(
						jobId,
						"system",
						`Updated feature workflow stage to "Ready for Review"`,
					);
				} catch (err) {
					await addJobMessage(
						jobId,
						"system",
						`Warning: Failed to update feature workflow stage: ${err}`,
					);
				}
			}
		} else {
			await updateJob(jobId, {
				status: "completed",
				completed_at: new Date().toISOString(),
				exit_code: 0,
				error: "No tasks were completed",
				total_iterations: finalIteration,
				completion_reason: completionReason,
			});

			await addJobMessage(
				jobId,
				"system",
				`\nSpec-Kit job completed after ${finalIteration} iterations but no tasks were completed.`,
			);
		}
	} catch (err) {
		console.error(`Spec-Kit job ${jobId} failed:`, err);

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
			completion_reason: "iteration_error",
		});

		await addJobMessage(
			jobId,
			"system",
			`Spec-Kit job failed: ${(err as Error).message}`,
		);
	}
}

// Get next task that has all dependencies completed
type SpecTask = NonNullable<SpecOutput["tasks"]>[number];

function getNextSpecTask(
	tasks: SpecOutput["tasks"],
	completedIds: number[],
): SpecTask | null {
	if (!tasks) return null;
	return (
		tasks.find(
			(t) =>
				!completedIds.includes(t.id) &&
				t.dependencies.every((d) => completedIds.includes(d)),
		) || null
	);
}

// Initialize spec progress file
function initSpecProgressFile(
	worktreePath: string,
	jobId: string,
	branchName: string,
	specOutput: SpecOutput,
): void {
	const progressPath = join(worktreePath, SPEC_PROGRESS_FILE);
	const content = `# Spec-Kit Progress

Job ID: ${jobId}
Branch: ${branchName}
Started: ${new Date().toISOString()}

## Constitution Summary
${specOutput.constitution?.substring(0, 500) || "N/A"}...

## Tasks Overview
${specOutput.tasks?.map((t) => `- [ ] #${t.id}: ${t.title}`).join("\n") || "N/A"}

## Codebase Patterns
(Discovered patterns will be added here)

---

`;
	writeFileSync(progressPath, content);
}

// Spec tasks JSON file for tracking completion
interface SpecTaskState {
	id: number;
	title: string;
	completed: boolean;
}

function writeSpecTasksFile(
	worktreePath: string,
	tasks: NonNullable<SpecOutput["tasks"]>,
): void {
	const tasksPath = join(worktreePath, SPEC_TASKS_FILE);
	const state: SpecTaskState[] = tasks.map((t) => ({
		id: t.id,
		title: t.title,
		completed: false,
	}));
	writeFileSync(tasksPath, JSON.stringify(state, null, 2));
}

function readSpecTasksFile(worktreePath: string): SpecTaskState[] | null {
	const tasksPath = join(worktreePath, SPEC_TASKS_FILE);
	if (!existsSync(tasksPath)) return null;
	try {
		const content = readFileSync(tasksPath, "utf8");
		return JSON.parse(content) as SpecTaskState[];
	} catch {
		return null;
	}
}

function updateSpecTasksFile(worktreePath: string, taskId: number): void {
	const tasks = readSpecTasksFile(worktreePath);
	if (!tasks) return;
	const task = tasks.find((t) => t.id === taskId);
	if (task) task.completed = true;
	writeFileSync(
		join(worktreePath, SPEC_TASKS_FILE),
		JSON.stringify(tasks, null, 2),
	);
}

function appendSpecIterationToProgress(
	worktreePath: string,
	iteration: number,
	summary: string,
	completedTask: SpecTask | null,
): void {
	const progressPath = join(worktreePath, SPEC_PROGRESS_FILE);

	const taskLine = completedTask
		? `### Completed Task\n- ✓ #${completedTask.id}: ${completedTask.title}\n`
		: "";

	const content = `
## Iteration ${iteration}
Completed: ${new Date().toISOString()}
${taskLine}
### Summary
${summary || "No summary provided."}

---
`;
	appendFileSync(progressPath, content);
}

function buildSpecIterationPrompt(
	basePrompt: string,
	specOutput: SpecOutput,
	currentTask: NonNullable<SpecOutput["tasks"]>[number],
	completedTaskIds: number[],
	iteration: number,
	maxIterations: number,
	branchName: string,
	featureId?: string,
): string {
	// Format clarifications with responses
	const clarificationsSection =
		specOutput.clarifications
			?.filter((c) => c.response)
			.map((c) => `Q: ${c.question}\nA: ${c.response}`)
			.join("\n\n") || "None";

	// Format all tasks with status
	const tasksOverview =
		specOutput.tasks
			?.map((t) => {
				const status = completedTaskIds.includes(t.id)
					? "✓"
					: t.id === currentTask.id
						? "→"
						: "○";
				const deps =
					t.dependencies.length > 0
						? ` (depends on: ${t.dependencies.join(", ")})`
						: "";
				return `${status} #${t.id}: ${t.title}${deps}`;
			})
			.join("\n") || "N/A";

	// Format existing patterns from analysis
	const existingPatterns =
		specOutput.analysis?.existingPatterns?.join("\n- ") || "None identified";

	return `# Spec-Kit Implementation Agent

## Context
- Iteration: ${iteration} of ${maxIterations}
- Branch: ${branchName}
- Feature ID: ${featureId || "N/A"}

## Coding Standards (Constitution)
${specOutput.constitution || "Not available"}

---

## Feature Specification

### Overview
${specOutput.spec?.overview || basePrompt}

### Requirements
${specOutput.spec?.requirements?.map((r) => `- ${r}`).join("\n") || "N/A"}

### Acceptance Criteria
${specOutput.spec?.acceptanceCriteria?.map((c) => `- ${c}`).join("\n") || "N/A"}

### Out of Scope
${specOutput.spec?.outOfScope?.map((o) => `- ${o}`).join("\n") || "N/A"}

---

## Clarifications Answered
${clarificationsSection}

---

## Architecture Plan

### Architecture
${specOutput.plan?.architecture || "N/A"}

### Technical Decisions
${specOutput.plan?.techDecisions?.map((d) => `- ${d}`).join("\n") || "N/A"}

### File Structure
${specOutput.plan?.fileStructure?.map((f) => `- ${f}`).join("\n") || "N/A"}

---

## Existing Patterns to Follow
- ${existingPatterns}

---

## Tasks Overview
${tasksOverview}

---

## CURRENT TASK

**Task #${currentTask.id}: ${currentTask.title}**

${currentTask.description}

**Files to modify:**
${currentTask.files.map((f) => `- ${f}`).join("\n")}

**Dependencies:** ${currentTask.dependencies.length > 0 ? currentTask.dependencies.map((d) => `#${d}`).join(", ") : "None"} (all completed ✓)

---

## Your Instructions

1. Implement ONLY Task #${currentTask.id}
2. Follow the constitution coding standards
3. Follow the architecture plan and technical decisions
4. Run quality checks (typecheck, lint, test)
5. Commit with message: \`feat(spec-${featureId || "task"}): task-${currentTask.id} - ${currentTask.title}\`
6. When the task is complete and committed, output: \`<task-complete>${currentTask.id}</task-complete>\`

## Progress Files
- Read \`.spec-progress.md\` for iteration history
- Read \`.spec-tasks.json\` for task completion state
- Update progress.md with your learnings after completing the task

## Quality Requirements
- ALL commits must pass typecheck, lint, and tests
- Follow existing code patterns from the constitution
- Keep changes focused to the current task only

## Stop Condition
After completing Task #${currentTask.id}:
1. Commit your changes
2. Output \`<task-complete>${currentTask.id}</task-complete>\`
3. Do NOT start the next task - the orchestrator will handle that

**CRITICAL: One task per iteration. Stop after completing Task #${currentTask.id}.**
`;
}

// ===== Standard Job Runner =====

async function runClaudeCode(
	prompt: string,
	cwd: string,
	jobId: string,
): Promise<{ exitCode: number; error?: string }> {
	return new Promise((resolve) => {
		console.log(`Starting Claude Code for job ${jobId}...`);

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"stream-json",
				"--verbose",
				prompt,
			],
			{
				cwd,
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		// Store process for cancellation
		runningProcesses.set(jobId, proc);

		// Store PID
		if (proc.pid) {
			updateJob(jobId, { pid: proc.pid });
		}

		let stderrBuffer = "";

		proc.stdout.on("data", (data: Buffer) => {
			const content = data.toString();
			process.stdout.write(content); // Log to console
			addJobMessage(jobId, "stdout", content);
		});

		proc.stderr.on("data", (data: Buffer) => {
			const content = data.toString();
			process.stderr.write(content); // Log to console
			stderrBuffer += content;
			addJobMessage(jobId, "stderr", content);
		});

		proc.on("close", (code: number | null) => {
			runningProcesses.delete(jobId);
			resolve({
				exitCode: code || 0,
				error: code !== 0 ? stderrBuffer || "Unknown error" : undefined,
			});
		});

		proc.on("error", (err: Error) => {
			runningProcesses.delete(jobId);
			resolve({
				exitCode: 1,
				error: (err as Error).message,
			});
		});
	});
}

// Interactive version for task jobs - allows sending messages via stdin
async function runClaudeCodeInteractive(
	prompt: string,
	cwd: string,
	jobId: string,
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
					type: "http",
					url: "https://os-mcp.vercel.app/api/mcp",
				},
			},
		});

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"stream-json",
				"--input-format",
				"stream-json",
				"--verbose",
				"--disallowedTools",
				"Edit,Write,Bash,NotebookEdit,MultiEdit",
				"--mcp-config",
				mcpConfig,
			],
			{
				cwd,
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);

		// Send initial prompt as JSON (stream-json format requires nested message object)
		const initialMessage = `${JSON.stringify({
			type: "user",
			message: { role: "user", content: prompt },
		})}\n`;
		proc.stdin?.write(initialMessage);

		// Store process for cancellation and message sending
		runningProcesses.set(jobId, proc);
		interactiveProcesses.set(jobId, proc);

		// Store PID
		if (proc.pid) {
			updateJob(jobId, { pid: proc.pid });
		}

		let stderrBuffer = "";

		proc.stdout.on("data", (data: Buffer) => {
			const content = data.toString();
			process.stdout.write(content); // Log to console
			addJobMessage(jobId, "stdout", content);
		});

		proc.stderr.on("data", (data: Buffer) => {
			const content = data.toString();
			process.stderr.write(content); // Log to console
			stderrBuffer += content;
			addJobMessage(jobId, "stderr", content);
		});

		proc.on("close", (code: number | null) => {
			runningProcesses.delete(jobId);
			interactiveProcesses.delete(jobId);
			resolve({
				exitCode: code || 0,
				error: code !== 0 ? stderrBuffer || "Unknown error" : undefined,
			});
		});

		proc.on("error", (err: Error) => {
			runningProcesses.delete(jobId);
			interactiveProcesses.delete(jobId);
			resolve({
				exitCode: 1,
				error: (err as Error).message,
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
	addJobMessage(jobId, "user_input", message);

	// Send as JSON for stream-json input format (requires nested message object)
	const jsonMessage = `${JSON.stringify({
		type: "user",
		message: { role: "user", content: message },
	})}\n`;
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
	addJobMessage(jobId, "system", "User ended the interactive session.");

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
		proc.kill("SIGTERM");

		setTimeout(() => {
			if (runningProcesses.has(jobId)) {
				proc.kill("SIGKILL");
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
	loginType: "subscription" | "api_key" | null;
}> {
	// Get version
	const versionResult = await new Promise<{
		version: string | null;
		authenticated: boolean;
	}>((resolve) => {
		const proc = spawn(CLAUDE_BIN, ["--version"], {
			env: { ...process.env, HOME: HOME_DIR },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let output = "";

		proc.stdout.on("data", (data: Buffer) => {
			output += data.toString();
		});

		proc.on("close", (code: number | null) => {
			resolve({
				authenticated: code === 0,
				version: code === 0 ? output.trim().split("\n")[0] || null : null,
			});
		});

		proc.on("error", () => {
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
	let loginType: "subscription" | "api_key" | null = "subscription";

	try {
		// Check for API key in environment first
		if (process.env.ANTHROPIC_API_KEY) {
			loginType = "api_key";
		} else {
			// Read Claude's settings file for account info
			const settingsPath = join(HOME_DIR, ".claude", "settings.json");
			if (existsSync(settingsPath)) {
				const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
				const hasApiKey = settings.apiKey || settings.anthropicApiKey;
				loginType = hasApiKey ? "api_key" : "subscription";
			} else {
				// Check auth.json for account details
				const authPath = join(HOME_DIR, ".claude", "auth.json");
				if (existsSync(authPath)) {
					const auth = JSON.parse(readFileSync(authPath, "utf8"));
					loginType = auth.apiKey ? "api_key" : "subscription";
				}
			}
		}
	} catch {
		// Keep defaults
	}

	return {
		authenticated: true,
		version: versionResult.version,
		loginType,
	};
}
