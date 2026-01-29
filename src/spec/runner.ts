import { type ChildProcess, spawn } from "node:child_process";
import {
	addJobMessage,
	type CodeRepository,
	getFeature,
	getFeatureSpecOutput,
	getJob,
	SPEC_STAGE_CODES,
	updateFeatureSpecOutput,
	updateFeatureWorkflowStageByCode,
	updateJob,
} from "../db/index.js";
import {
	createSpecJob,
	getClientConstitution,
	getRepositoryByClientId,
	getRepositoryById,
	updateClientConstitution,
} from "../db/queries.js";
import type { SpecOutput, SpecPhase } from "../db/types.js";
import { createWorktree, ensureBareRepo, fetchOrigin } from "../git.js";
import {
	formatMemoriesForPrompt,
	learnFromSpecPhase,
	type Memory,
	recallForClient,
} from "../memory/index.js";
import {
	addSpanEvent,
	endSpan,
	recordException,
	setSpanAttributes,
	startTrace,
} from "../observability/index.js";
import { autoImprove } from "./improve.js";
import { type JudgeContext, runLLMJudge } from "./judge.js";
import {
	getNextPhase,
	getPhasePromptBuilder,
	type PhasePromptContext,
	SPEC_PHASES,
} from "./phases.js";

const HOME_DIR = process.env.HOME || "/Users/davidcavarlacic";
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

// Helper to get stage codes for spec phases
function getPhaseStageCode(
	phase: SpecPhase,
	state: "running" | "complete" | "waiting" | "failed",
): string | null {
	const phaseMap: Record<SpecPhase, Record<string, string>> = {
		constitution: {
			running: SPEC_STAGE_CODES.constitution_running,
			complete: SPEC_STAGE_CODES.constitution_complete,
		},
		specify: {
			running: SPEC_STAGE_CODES.specify_running,
			complete: SPEC_STAGE_CODES.specify_complete,
		},
		clarify: {
			running: SPEC_STAGE_CODES.clarify_running,
			complete: SPEC_STAGE_CODES.clarify_complete,
			waiting: SPEC_STAGE_CODES.clarify_waiting,
		},
		plan: {
			running: SPEC_STAGE_CODES.plan_running,
			complete: SPEC_STAGE_CODES.plan_complete,
		},
		analyze: {
			running: SPEC_STAGE_CODES.analyze_running,
			complete: SPEC_STAGE_CODES.analyze_complete,
			failed: SPEC_STAGE_CODES.analyze_failed,
		},
		tasks: {
			running: SPEC_STAGE_CODES.tasks_running,
			complete: SPEC_STAGE_CODES.tasks_complete,
		},
	};

	return phaseMap[phase]?.[state] || null;
}

// Helper to update feature workflow stage with logging
async function setFeatureStage(
	featureId: string,
	stageCode: string,
	jobId: string,
): Promise<void> {
	try {
		const success = await updateFeatureWorkflowStageByCode(
			featureId,
			stageCode,
		);
		if (success) {
			await addJobMessage(
				jobId,
				"system",
				`Updated workflow stage to: ${stageCode}`,
			);
		} else {
			console.error(`Failed to update stage to ${stageCode} - stage not found`);
		}
	} catch (err) {
		console.error("Error updating workflow stage:", err);
		// Don't throw - stage update failure shouldn't fail the job
	}
}

export async function runSpecJob(jobId: string): Promise<void> {
	// Start trace for spec job
	const trace = startTrace("spec_job", {
		"job.id": jobId,
		"job.type": "spec",
	});

	const job = await getJob(jobId);
	if (!job) {
		endSpan(trace, "error", { "error.message": "Job not found" });
		throw new Error(`Job not found: ${jobId}`);
	}

	// Get feature info
	if (!job.feature_id) {
		await updateJob(jobId, {
			status: "failed",
			error: "Spec jobs require a feature_id",
			completed_at: new Date().toISOString(),
		});
		endSpan(trace, "error", { "error.message": "No feature_id" });
		return;
	}

	const feature = await getFeature(job.feature_id);
	if (!feature) {
		await updateJob(jobId, {
			status: "failed",
			error: `Feature not found: ${job.feature_id}`,
			completed_at: new Date().toISOString(),
		});
		endSpan(trace, "error", { "error.message": "Feature not found" });
		return;
	}

	setSpanAttributes(trace, {
		"feature.id": job.feature_id,
		"feature.title": feature.title,
		"job.client_id": job.client_id,
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

	// Determine which phase to run
	const specPhase = (job.spec_phase as SpecPhase) || "constitution";
	const phaseInfo = SPEC_PHASES[specPhase];

	setSpanAttributes(trace, {
		"spec.phase": specPhase,
		"spec.phase_order": phaseInfo.order,
	});

	let worktreePath: string | null = null;

	// Recall relevant memories for this client/feature
	let relevantMemories: Memory[] = [];
	try {
		relevantMemories = await recallForClient(
			job.client_id,
			`${feature.title} ${feature.functionality_notes || ""} ${specPhase}`,
			{ limit: 10 },
		);
		if (relevantMemories.length > 0) {
			addSpanEvent(trace, "memories_recalled", {
				count: relevantMemories.length,
			});
		}
	} catch (memErr) {
		// Memory recall failed, continue without it
		console.error("Memory recall failed:", memErr);
	}

	try {
		// Update status to running
		await updateJob(jobId, {
			status: "running",
			started_at: new Date().toISOString(),
		});

		// Update workflow stage to running
		const runningStage = getPhaseStageCode(specPhase, "running");
		if (runningStage) {
			await setFeatureStage(job.feature_id, runningStage, jobId);
		}

		addSpanEvent(trace, "spec_phase_started", { phase: specPhase });
		await addJobMessage(
			jobId,
			"system",
			`Starting Spec-Kit Phase ${phaseInfo.order}: ${phaseInfo.name}`,
		);
		await addJobMessage(jobId, "system", `Feature: ${feature.title}`);
		await addJobMessage(
			jobId,
			"system",
			`Repository: ${repo.owner_name}/${repo.repo_name}`,
		);

		if (relevantMemories.length > 0) {
			await addJobMessage(
				jobId,
				"system",
				`Recalled ${relevantMemories.length} relevant memories from previous work`,
			);
		}

		// Setup git worktree (needed for codebase analysis)
		await addJobMessage(jobId, "system", "Setting up worktree...");
		await ensureBareRepo(repo);
		await fetchOrigin(repo);
		worktreePath = await createWorktree(repo, job);
		await updateJob(jobId, { worktree_path: worktreePath });

		// Load existing spec output from feature
		const existingOutput = await getFeatureSpecOutput(job.feature_id);

		// Check if we should use existing client constitution (for constitution phase)
		// forceRegenerate can be set via job.spec_output.forceRegenerate
		const forceRegenerate =
			(job.spec_output as { forceRegenerate?: boolean } | null)
				?.forceRegenerate === true;

		let useExistingConstitution = false;
		let clientConstitution: string | null = null;

		if (specPhase === "constitution" && !forceRegenerate) {
			const existingClientConstitution = await getClientConstitution(
				job.client_id,
			);
			if (existingClientConstitution) {
				clientConstitution = existingClientConstitution.constitution;
				useExistingConstitution = true;
				await addJobMessage(
					jobId,
					"system",
					`Using existing client constitution (generated ${existingClientConstitution.generatedAt})`,
				);
			}
		}

		// Build context for prompt (including memories)
		const memoriesContext =
			relevantMemories.length > 0
				? formatMemoriesForPrompt(relevantMemories)
				: undefined;

		const promptContext: PhasePromptContext = {
			featureTitle: feature.title,
			featureDescription: feature.functionality_notes || undefined,
			featureTypeId: feature.feature_type_id,
			clientName: feature.client?.name || "Unknown",
			repoName: `${repo.owner_name}/${repo.repo_name}`,
			existingConstitution: clientConstitution || existingOutput?.constitution,
			existingSpec: existingOutput?.spec
				? JSON.stringify(existingOutput.spec, null, 2)
				: undefined,
			existingPlan: existingOutput?.plan
				? JSON.stringify(existingOutput.plan, null, 2)
				: undefined,
			clarificationResponses: existingOutput?.clarifications
				?.filter((c): c is typeof c & { response: string } =>
					Boolean(c.response),
				)
				.map((c) => ({ question: c.question, answer: c.response })),
			// Add memories to context
			relevantMemories: memoriesContext,
		};

		// If using existing client constitution, skip Claude and use it directly
		let result: { exitCode: number; output: string; error?: string };
		let parseResult: ReturnType<typeof parseSpecOutput>;

		if (useExistingConstitution && clientConstitution) {
			// Use existing constitution without running Claude
			result = { exitCode: 0, output: clientConstitution };
			parseResult = {
				success: true,
				output: { constitution: clientConstitution },
			};
			await addJobMessage(
				jobId,
				"system",
				"Skipped Claude run - using existing client constitution",
			);
		} else {
			// Build prompt for this phase
			const promptBuilder = getPhasePromptBuilder(specPhase);
			const prompt = promptBuilder(promptContext);

			await addJobMessage(
				jobId,
				"system",
				`Running Claude Code for ${phaseInfo.name} phase...`,
			);

			// Run Claude Code
			result = await runClaudeForSpec(prompt, worktreePath, jobId);

			if (result.exitCode !== 0) {
				throw new Error(
					result.error || `Claude Code exited with code ${result.exitCode}`,
				);
			}

			// Note: raw output is already streamed to job_messages via addJobMessage in runClaudeForSpec
			// Parse Claude's output
			parseResult = parseSpecOutput(result.output, specPhase);

			// Handle parse failure - attempt recovery by asking Claude to reformat
			if (!parseResult.success) {
				await addJobMessage(
					jobId,
					"stderr",
					`Failed to parse spec output: ${parseResult.error}\nLast 500 chars: ${parseResult.rawOutput}`,
				);

				// Attempt recovery - ask Claude to reformat the output as JSON
				await addJobMessage(
					jobId,
					"system",
					"Attempting recovery: asking Claude to reformat output as JSON...",
				);

				const recoveryResult = await attemptJsonRecovery(
					result.output,
					specPhase,
					worktreePath,
					jobId,
				);

				if (recoveryResult.success) {
					parseResult = recoveryResult.parseResult;
					await addJobMessage(
						jobId,
						"system",
						"Recovery successful: JSON extracted from reformatted output",
					);
				} else {
					await addJobMessage(
						jobId,
						"stderr",
						`Recovery failed: ${recoveryResult.error}`,
					);
					throw new Error(
						`Spec phase ${specPhase} failed: ${parseResult.error}. Recovery also failed: ${recoveryResult.error}`,
					);
				}
			}

			// parseResult must be successful here (we throw on failure above)
			if (!parseResult.success) {
				throw new Error("Unexpected: parseResult not successful after recovery");
			}

			// Save constitution to client for reuse across features
			if (specPhase === "constitution" && parseResult.output.constitution) {
				try {
					await updateClientConstitution(
						job.client_id,
						parseResult.output.constitution,
					);
					await addJobMessage(
						jobId,
						"system",
						"Saved constitution to client for reuse across features",
					);
				} catch (saveErr) {
					// Log but don't fail - constitution is still saved to feature
					await addJobMessage(
						jobId,
						"system",
						`Warning: Failed to save constitution to client: ${(saveErr as Error).message}`,
					);
				}
			}
		}

		// At this point parseResult must be successful (we throw otherwise in both branches)
		if (!parseResult.success) {
			throw new Error(
				"Unexpected: parseResult not successful after parse/recovery",
			);
		}

		// Merge with existing output
		const mergedOutput: SpecOutput = {
			...existingOutput,
			phase: specPhase,
			...parseResult.output,
		};

		// Save to feature
		await updateFeatureSpecOutput(job.feature_id, mergedOutput);

		// Determine next steps
		let nextPhase = getNextPhase(specPhase);
		let needsHumanInput = false;

		// Special handling for clarify phase
		if (specPhase === "clarify" && mergedOutput.clarifications?.length) {
			const unanswered = mergedOutput.clarifications.filter((c) => !c.response);
			if (unanswered.length > 0) {
				needsHumanInput = true;
				await addJobMessage(
					jobId,
					"system",
					`Found ${unanswered.length} questions needing human input`,
				);
			}
		}

		// Special handling for analyze phase - run LLM-as-Judge and auto-improve
		if (specPhase === "analyze") {
			if (
				mergedOutput.constitution &&
				mergedOutput.spec &&
				mergedOutput.plan &&
				worktreePath
			) {
				// Run LLM-as-Judge for quality evaluation
				const judgeContext: JudgeContext = {
					jobId,
					clientId: job.client_id,
					constitution: mergedOutput.constitution,
					spec: mergedOutput.spec,
					plan: mergedOutput.plan,
					cwd: worktreePath,
				};

				try {
					const judgeResult = await runLLMJudge(judgeContext);

					// Store judge result in analysis
					mergedOutput.analysis = {
						passed: judgeResult.passed,
						issues: judgeResult.criteria
							.filter((c) => !c.passed)
							.map((c) => c.reasoning),
						suggestions: judgeResult.improvements,
						existingPatterns: mergedOutput.analysis?.existingPatterns || [],
					};

					// If judge failed, run auto-improve loop
					if (!judgeResult.passed) {
						await addJobMessage(
							jobId,
							"system",
							"Quality gate failed. Running auto-improve loop...",
						);

						let improveIterations = 0;
						let currentPlan = mergedOutput.plan;
						let lastJudgeResult = judgeResult;

						while (!lastJudgeResult.passed && improveIterations < 3) {
							const improveResult = await autoImprove({
								jobId,
								constitution: mergedOutput.constitution,
								spec: mergedOutput.spec,
								plan: currentPlan,
								judgeResult: lastJudgeResult,
								cwd: worktreePath,
								iteration: improveIterations,
							});

							if (!improveResult.success || !improveResult.improvedPlan) {
								await addJobMessage(
									jobId,
									"system",
									`Auto-improve iteration ${improveIterations + 1} failed to produce improved plan`,
								);
								break;
							}

							// Update plan
							currentPlan = improveResult.improvedPlan;
							mergedOutput.plan = currentPlan;

							// Re-run judge
							lastJudgeResult = await runLLMJudge({
								...judgeContext,
								plan: currentPlan,
							});

							// Update analysis
							mergedOutput.analysis = {
								passed: lastJudgeResult.passed,
								issues: lastJudgeResult.criteria
									.filter((c) => !c.passed)
									.map((c) => c.reasoning),
								suggestions: lastJudgeResult.improvements,
								existingPatterns: mergedOutput.analysis.existingPatterns,
							};

							improveIterations++;
						}

						if (lastJudgeResult.passed) {
							await addJobMessage(
								jobId,
								"system",
								`Auto-improve succeeded after ${improveIterations} iteration(s)`,
							);
						} else {
							await addJobMessage(
								jobId,
								"system",
								`Auto-improve completed but quality gate still failing after ${improveIterations} iterations`,
							);
						}
					}
				} catch (judgeErr) {
					await addJobMessage(
						jobId,
						"system",
						`LLM-as-Judge error: ${(judgeErr as Error).message}. Proceeding with basic analysis.`,
					);
				}
			}

			// Don't proceed to tasks if analysis failed
			if (mergedOutput.analysis && !mergedOutput.analysis.passed) {
				await addJobMessage(
					jobId,
					"system",
					"Analysis found issues - manual review required before proceeding to tasks",
				);
				nextPhase = null;
				// Set analyze_failed stage
				await setFeatureStage(
					job.feature_id,
					SPEC_STAGE_CODES.analyze_failed,
					jobId,
				);
			}
		}

		// Complete the job
		await updateJob(jobId, {
			status: "completed",
			completed_at: new Date().toISOString(),
			exit_code: 0,
			spec_output: JSON.parse(JSON.stringify(mergedOutput)),
		});

		addSpanEvent(trace, "spec_phase_completed", { phase: specPhase });
		await addJobMessage(
			jobId,
			"system",
			`Phase ${phaseInfo.name} completed successfully`,
		);

		// Learn from this spec phase for future work
		try {
			const discoveries: {
				patterns?: string[];
				insights?: string[];
				issues?: string[];
			} = {};

			// Extract learnings based on phase
			if (specPhase === "constitution" && mergedOutput.constitution) {
				discoveries.patterns = [
					`Constitution created for ${promptContext.repoName}`,
				];
			}
			if (specPhase === "analyze" && mergedOutput.analysis) {
				if (mergedOutput.analysis.existingPatterns?.length) {
					discoveries.patterns = mergedOutput.analysis.existingPatterns.map(
						(p: unknown) =>
							typeof p === "string" ? p : (p as { pattern: string }).pattern,
					);
				}
				if (mergedOutput.analysis.issues?.length) {
					discoveries.issues = mergedOutput.analysis.issues.map((i: unknown) =>
						typeof i === "string"
							? i
							: (i as { description: string }).description,
					);
				}
			}
			if (specPhase === "plan" && mergedOutput.plan) {
				const techDecisions =
					(mergedOutput.plan as { techDecisions?: unknown[] })?.techDecisions ||
					[];
				// Convert any non-strings to strings
				discoveries.insights = techDecisions.map((td) =>
					typeof td === "string" ? td : JSON.stringify(td),
				);
			}

			if (Object.keys(discoveries).length > 0) {
				await learnFromSpecPhase(jobId, specPhase, job.client_id, discoveries);
				addSpanEvent(trace, "memories_created", {
					count: Object.values(discoveries).flat().length,
				});
			}
		} catch (learnErr) {
			// Learning failed, continue without it
			console.error("Learning from spec phase failed:", learnErr);
		}

		// Update workflow stage based on outcome
		if (needsHumanInput) {
			await addJobMessage(
				jobId,
				"system",
				"Waiting for human input on clarifications",
			);
			// Set clarify_waiting stage
			await setFeatureStage(
				job.feature_id,
				SPEC_STAGE_CODES.clarify_waiting,
				jobId,
			);
		} else if (nextPhase) {
			await addJobMessage(
				jobId,
				"system",
				`Next phase: ${SPEC_PHASES[nextPhase].name}`,
			);
			// Set phase complete stage (if not already set by special case)
			const completeStage = getPhaseStageCode(specPhase, "complete");
			if (completeStage) {
				await setFeatureStage(job.feature_id, completeStage, jobId);
			}

			// Auto-create next phase job
			await addJobMessage(
				jobId,
				"system",
				`Auto-progressing to ${SPEC_PHASES[nextPhase].name}...`,
			);
			const nextJob = await createSpecJob({
				clientId: job.client_id,
				featureId: job.feature_id,
				repositoryId: job.repository_id ?? undefined,
				specPhase: nextPhase,
			});
			await addJobMessage(
				jobId,
				"system",
				`Queued next phase job: ${nextJob.id}`,
			);
		} else if (specPhase === "tasks") {
			await addJobMessage(
				jobId,
				"system",
				"Spec-Kit complete! Feature is ready for implementation (Ralph)",
			);
			// Set tasks_complete, then spec_complete
			await setFeatureStage(
				job.feature_id,
				SPEC_STAGE_CODES.tasks_complete,
				jobId,
			);
			await setFeatureStage(
				job.feature_id,
				SPEC_STAGE_CODES.spec_complete,
				jobId,
			);
		}

		endSpan(trace, "ok", {
			"spec.phase_completed": specPhase,
			"spec.needs_human_input": needsHumanInput,
		});
	} catch (err) {
		console.error(`Spec job ${jobId} failed:`, err);
		recordException(trace, err instanceof Error ? err : new Error(String(err)));

		await updateJob(jobId, {
			status: "failed",
			completed_at: new Date().toISOString(),
			error: (err as Error).message || String(err),
		});

		await addJobMessage(
			jobId,
			"system",
			`Spec job failed: ${(err as Error).message}`,
		);
		endSpan(trace, "error");
	}
}

// Run Claude Code for spec generation
async function runClaudeForSpec(
	prompt: string,
	cwd: string,
	jobId: string,
): Promise<{ exitCode: number; output: string; error?: string }> {
	return new Promise((resolve) => {
		console.log(`Starting Claude Code (spec) for job ${jobId}...`);

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"text", // Use text for easier JSON extraction
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
			resolve({
				exitCode: code || 0,
				output: stdout,
				error: code !== 0 ? stderrBuffer || "Unknown error" : undefined,
			});
		});

		proc.on("error", (err: Error) => {
			runningProcesses.delete(jobId);
			resolve({
				exitCode: 1,
				output: "",
				error: (err as Error).message,
			});
		});
	});
}

// Build a recovery prompt to ask Claude to reformat output as JSON
function buildRecoveryPrompt(rawOutput: string, phase: SpecPhase): string {
	const phaseSchemas: Record<SpecPhase, string> = {
		constitution: `{
  "constitution": "markdown string with all coding principles",
  "techStack": { "frontend": [], "backend": [], "testing": [], "build": [] },
  "keyPatterns": []
}`,
		specify: `{
  "spec": {
    "overview": "markdown description",
    "requirements": [{ "id": "REQ-001", "description": "...", "priority": "must" }],
    "acceptanceCriteria": [{ "id": "AC-001", "requirement": "REQ-001", "criteria": "..." }],
    "outOfScope": [],
    "edgeCases": []
  }
}`,
		clarify: `{
  "clarifications": [{ "id": "CLR-001", "category": "...", "question": "...", "context": "..." }],
  "assumptions": [],
  "risksIfUnclarified": []
}`,
		plan: `{
  "plan": {
    "architecture": "markdown overview",
    "techDecisions": [{ "decision": "...", "rationale": "...", "alternatives": [] }],
    "fileStructure": { "create": [], "modify": [] },
    "schemaChanges": [],
    "apiChanges": [],
    "dependencies": []
  }
}`,
		analyze: `{
  "analysis": {
    "passed": true,
    "issues": [{ "severity": "error|warning|info", "description": "...", "suggestion": "..." }],
    "existingPatterns": [],
    "reusableCode": [],
    "suggestions": []
  }
}`,
		tasks: `{
  "tasks": [
    {
      "id": 1,
      "title": "Short task title",
      "description": "Detailed description",
      "files": [],
      "tests": [],
      "dependencies": [],
      "estimatePoints": 1,
      "acceptanceCriteria": []
    }
  ],
  "totalEstimatePoints": 0,
  "criticalPath": [],
  "parallelizable": []
}`,
	};

	// Truncate raw output if too long (keep last 15000 chars which likely has the content)
	const maxOutputLength = 15000;
	const truncatedOutput =
		rawOutput.length > maxOutputLength
			? `[...truncated...]\n${rawOutput.slice(-maxOutputLength)}`
			: rawOutput;

	return `The previous response did not contain valid JSON. Please extract the information from this output and reformat it as valid JSON.

## Expected JSON Schema for "${phase}" phase:
\`\`\`json
${phaseSchemas[phase]}
\`\`\`

## Previous Output to Extract From:
${truncatedOutput}

IMPORTANT: Respond with ONLY a valid JSON object inside a \`\`\`json code block. No explanations, no summaries, just the JSON. Extract all the relevant information from the previous output and structure it according to the schema above.`;
}

// Attempt to recover from a parse failure by asking Claude to reformat
async function attemptJsonRecovery(
	rawOutput: string,
	phase: SpecPhase,
	cwd: string,
	jobId: string,
): Promise<
	| { success: true; parseResult: ParseResult & { success: true } }
	| { success: false; error: string }
> {
	const recoveryPrompt = buildRecoveryPrompt(rawOutput, phase);

	try {
		const result = await runClaudeForSpec(recoveryPrompt, cwd, jobId);

		if (result.exitCode !== 0) {
			return {
				success: false,
				error: `Recovery Claude call failed: ${result.error || `exit code ${result.exitCode}`}`,
			};
		}

		const parseResult = parseSpecOutput(result.output, phase);

		if (!parseResult.success) {
			return {
				success: false,
				error: `Recovery output still not valid JSON: ${parseResult.error}`,
			};
		}

		return { success: true, parseResult };
	} catch (err) {
		return {
			success: false,
			error: `Recovery attempt threw: ${(err as Error).message}`,
		};
	}
}

// Result type for parseSpecOutput
type ParseResult =
	| { success: true; output: Partial<SpecOutput> }
	| { success: false; error: string; rawOutput: string };

// Fix common JSON issues from LLM output (unescaped newlines in strings)
function fixJsonString(json: string): string {
	// Replace literal newlines inside JSON strings with \n
	// This regex finds strings and escapes any raw newlines inside them
	const fixed = json;
	let inString = false;
	let escaped = false;
	let result = "";

	for (let i = 0; i < fixed.length; i++) {
		const char = fixed[i];

		if (escaped) {
			result += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			escaped = true;
			result += char;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			result += char;
			continue;
		}

		if (inString && char === "\n") {
			result += "\\n";
			continue;
		}

		if (inString && char === "\r") {
			result += "\\r";
			continue;
		}

		if (inString && char === "\t") {
			result += "\\t";
			continue;
		}

		result += char;
	}

	return result;
}

// Try to parse JSON with fallback to fixed version
function tryParseJson(
	json: string,
): { parsed: unknown; fixed: boolean } | null {
	// First try as-is
	try {
		return { parsed: JSON.parse(json), fixed: false };
	} catch {
		// Try with fixes applied
		try {
			const fixed = fixJsonString(json);
			return { parsed: JSON.parse(fixed), fixed: true };
		} catch {
			return null;
		}
	}
}

// Parse Claude's output to extract the JSON
function parseSpecOutput(output: string, phase: SpecPhase): ParseResult {
	const errors: string[] = [];

	// Try to find ALL json code blocks and parse each one (last one is usually the answer)
	const jsonBlocks = [...output.matchAll(/```json\s*([\s\S]*?)```/g)];
	if (jsonBlocks.length > 0) {
		// Try from last to first (final answer is usually last)
		for (let i = jsonBlocks.length - 1; i >= 0; i--) {
			const result = tryParseJson(jsonBlocks[i][1]);
			if (result) {
				if (result.fixed) {
					console.log("JSON parsed after fixing escaped characters");
				}
				return {
					success: true,
					output: mapParsedToSpecOutput(result.parsed as ParsedSpecJson, phase),
				};
			}
			errors.push(`Block ${i + 1}: parse failed`);
		}
		console.error(
			`Failed to parse ${jsonBlocks.length} JSON blocks:`,
			errors.join("; "),
		);
	}

	// Try to find the largest raw JSON object (greedy match from first { to last })
	const rawJsonMatch = output.match(/\{[\s\S]*\}/);
	if (rawJsonMatch) {
		const result = tryParseJson(rawJsonMatch[0]);
		if (result) {
			if (result.fixed) {
				console.log("Raw JSON parsed after fixing escaped characters");
			}
			return {
				success: true,
				output: mapParsedToSpecOutput(result.parsed as ParsedSpecJson, phase),
			};
		}
		errors.push("Raw JSON: parse failed");
		console.error("Failed to parse raw JSON from output");
	}

	// Check if output looks truncated
	const trimmed = output.trimEnd();
	const likelyTruncated =
		trimmed.endsWith('"') ||
		trimmed.endsWith(",") ||
		(output.includes("```json") && !output.includes("```\n"));

	// Return error if we couldn't parse
	console.error("Could not find valid JSON in Claude output");
	const errorDetail = errors.length > 0 ? ` (${errors.join("; ")})` : "";
	return {
		success: false,
		error: likelyTruncated
			? `Output truncated - no valid JSON found${errorDetail}`
			: `No valid JSON found in output${errorDetail}`,
		rawOutput: output.slice(-500),
	};
}

// Parsed JSON type for spec outputs
interface ParsedSpecJson {
	constitution?: string;
	spec?: SpecOutput["spec"];
	overview?: string;
	requirements?: string[];
	acceptanceCriteria?: string[];
	outOfScope?: string[];
	clarifications?: Array<{ id?: string; question: string; context?: string }>;
	plan?: SpecOutput["plan"];
	architecture?: string;
	techDecisions?: string[];
	fileStructure?: string[];
	dependencies?: string[];
	analysis?: SpecOutput["analysis"];
	passed?: boolean;
	issues?: string[];
	suggestions?: string[];
	existingPatterns?: string[];
	tasks?: Array<ParsedTaskItem>;
}

// Type aliases for parsed items
type ParsedClarificationItem = NonNullable<
	ParsedSpecJson["clarifications"]
>[number];
type ParsedTaskItem = {
	id?: number;
	title: string;
	description?: string;
	files?: string[];
	dependencies?: number[];
};

// Map parsed JSON to SpecOutput structure based on phase
function mapParsedToSpecOutput(
	parsed: ParsedSpecJson,
	phase: SpecPhase,
): Partial<SpecOutput> {
	switch (phase) {
		case "constitution":
			return {
				constitution: parsed.constitution || JSON.stringify(parsed, null, 2),
			};

		case "specify":
			return {
				spec: parsed.spec || {
					overview: parsed.overview || "",
					requirements: parsed.requirements || [],
					acceptanceCriteria: parsed.acceptanceCriteria || [],
					outOfScope: parsed.outOfScope || [],
				},
			};

		case "clarify":
			return {
				clarifications: (parsed.clarifications || []).map(
					(c: ParsedClarificationItem, i: number) => ({
						id: c.id || `CLR-${String(i + 1).padStart(3, "0")}`,
						question: c.question,
						context: c.context,
					}),
				),
			};

		case "plan":
			return {
				plan: parsed.plan || {
					architecture: parsed.architecture || "",
					techDecisions: parsed.techDecisions || [],
					fileStructure: parsed.fileStructure || [],
					dependencies: parsed.dependencies || [],
				},
			};

		case "analyze":
			return {
				analysis: parsed.analysis || {
					passed: parsed.passed ?? true,
					issues: parsed.issues || [],
					suggestions: parsed.suggestions || [],
					existingPatterns: parsed.existingPatterns || [],
				},
			};

		case "tasks":
			return {
				tasks: (parsed.tasks || []).map((t: ParsedTaskItem, index: number) => ({
					id: t.id ?? index + 1,
					title: t.title,
					description: t.description ?? "",
					files: t.files || [],
					dependencies: t.dependencies || [],
				})),
			};

		default:
			return {};
	}
}

// Submit a clarification response
export async function submitClarification(
	featureId: string,
	clarificationId: string,
	response: string,
): Promise<{ success: boolean; remainingQuestions: number }> {
	const output = await getFeatureSpecOutput(featureId);
	if (!output || !output.clarifications) {
		throw new Error("No clarifications found for this feature");
	}

	const clarification = output.clarifications.find(
		(c) => c.id === clarificationId,
	);
	if (!clarification) {
		throw new Error(`Clarification ${clarificationId} not found`);
	}

	clarification.response = response;
	clarification.respondedAt = new Date().toISOString();

	await updateFeatureSpecOutput(featureId, output);

	const remaining = output.clarifications.filter((c) => !c.response).length;
	return { success: true, remainingQuestions: remaining };
}

// Check if all clarifications are answered
export async function allClarificationsAnswered(
	featureId: string,
): Promise<boolean> {
	const output = await getFeatureSpecOutput(featureId);
	if (!output || !output.clarifications) return true;
	return output.clarifications.every((c) => !!c.response);
}

// Cancel a running spec job
export function cancelSpecJob(jobId: string): boolean {
	const proc = runningProcesses.get(jobId);
	if (proc) {
		proc.kill("SIGTERM");
		runningProcesses.delete(jobId);
		return true;
	}
	return false;
}

export function isSpecJobRunning(jobId: string): boolean {
	return runningProcesses.has(jobId);
}
