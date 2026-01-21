import { type ChildProcess, spawn } from "node:child_process";
import {
	addJobMessage,
	type CodeRepository,
	getFeature,
	getFeatureSpecOutput,
	getJob,
	updateFeatureSpecOutput,
	updateJob,
} from "../db/index.js";
import { getRepositoryByClientId, getRepositoryById } from "../db/queries.js";
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

		// Build context for prompt (including memories)
		const memoriesContext =
			relevantMemories.length > 0
				? formatMemoriesForPrompt(relevantMemories)
				: undefined;

		const promptContext: PhasePromptContext = {
			featureTitle: feature.title,
			featureDescription: feature.functionality_notes || undefined,
			clientName: feature.client?.name || "Unknown",
			repoName: `${repo.owner_name}/${repo.repo_name}`,
			existingConstitution: existingOutput?.constitution,
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

		// Build prompt for this phase
		const promptBuilder = getPhasePromptBuilder(specPhase);
		const prompt = promptBuilder(promptContext);

		await addJobMessage(
			jobId,
			"system",
			`Running Claude Code for ${phaseInfo.name} phase...`,
		);

		// Run Claude Code
		const result = await runClaudeForSpec(prompt, worktreePath, jobId);

		if (result.exitCode !== 0) {
			throw new Error(
				result.error || `Claude Code exited with code ${result.exitCode}`,
			);
		}

		// Parse Claude's output
		const parsedOutput = parseSpecOutput(result.output, specPhase);

		// Merge with existing output
		const mergedOutput: SpecOutput = {
			...existingOutput,
			phase: specPhase,
			...parsedOutput,
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
					(mergedOutput.plan as { techDecisions?: string[] })?.techDecisions ||
					[];
				discoveries.insights = techDecisions;
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

		if (needsHumanInput) {
			await addJobMessage(
				jobId,
				"system",
				"Waiting for human input on clarifications",
			);
		} else if (nextPhase) {
			await addJobMessage(
				jobId,
				"system",
				`Next phase: ${SPEC_PHASES[nextPhase].name}`,
			);
		} else if (specPhase === "tasks") {
			await addJobMessage(
				jobId,
				"system",
				"Spec-Kit complete! Feature is ready for implementation (Ralph)",
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

// Parse Claude's output to extract the JSON
function parseSpecOutput(
	output: string,
	phase: SpecPhase,
): Partial<SpecOutput> {
	// Try to find JSON in the output
	const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[1]);
			return mapParsedToSpecOutput(parsed, phase);
		} catch (e) {
			console.error("Failed to parse JSON from output:", e);
		}
	}

	// Try to find raw JSON object
	const rawJsonMatch = output.match(/\{[\s\S]*\}/);
	if (rawJsonMatch) {
		try {
			const parsed = JSON.parse(rawJsonMatch[0]);
			return mapParsedToSpecOutput(parsed, phase);
		} catch (e) {
			console.error("Failed to parse raw JSON from output:", e);
		}
	}

	// Return empty partial if we couldn't parse
	console.error("Could not find valid JSON in Claude output");
	return {};
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
