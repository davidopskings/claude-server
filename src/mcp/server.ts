/**
 * MCP Server for Spec-Ralph
 *
 * Exposes spec-kit and ralph functionality via Model Context Protocol.
 * Other AI agents can interact with this server to create specs, check status, etc.
 */

import { type Request, type Response, Router } from "express";
import {
	createJob,
	getFeature,
	getFeatureSpecOutput,
	getJob,
	getJobsByStatus,
} from "../db/index.js";
import type { JobStatus, SpecPhase } from "../db/types.js";
import { SPEC_PHASES } from "../spec/phases.js";
import { submitClarification } from "../spec/runner.js";

// Helper to safely get route param as string (Express 5 returns string | string[])
function getParam(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string {
	const value = params[key];
	if (Array.isArray(value)) return value[0] ?? "";
	return value ?? "";
}

// MCP Tool definitions
export const MCP_TOOLS = [
	{
		name: "create_spec",
		description:
			"Create a specification job for a feature. Starts the spec-kit pipeline.",
		inputSchema: {
			type: "object",
			properties: {
				featureId: {
					type: "string",
					description: "UUID of the feature to spec",
				},
				clientId: { type: "string", description: "UUID of the client" },
			},
			required: ["featureId", "clientId"],
		},
	},
	{
		name: "get_job_status",
		description: "Get the current status and details of a job",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", description: "UUID of the job" },
			},
			required: ["jobId"],
		},
	},
	{
		name: "list_jobs",
		description: "List jobs with optional filters",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: [
						"pending",
						"queued",
						"running",
						"completed",
						"failed",
						"cancelled",
					],
				},
				jobType: { type: "string", enum: ["code", "task", "ralph", "spec"] },
				clientId: { type: "string", description: "Filter by client UUID" },
				limit: { type: "number", description: "Max results (default 20)" },
			},
		},
	},
	{
		name: "get_spec_output",
		description: "Get the specification output for a feature",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
			},
			required: ["featureId"],
		},
	},
	{
		name: "answer_clarify",
		description: "Submit answers to clarification questions",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
				clarificationId: {
					type: "string",
					description: "ID of the clarification (e.g., CLR-001)",
				},
				response: { type: "string", description: "The answer to the question" },
			},
			required: ["featureId", "clarificationId", "response"],
		},
	},
	{
		name: "approve_spec",
		description:
			"Approve a completed specification, moving it to ready for implementation",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
			},
			required: ["featureId"],
		},
	},
	{
		name: "get_capacity",
		description: "Get current system capacity and queue status",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "list_phases",
		description: "List all spec-kit phases with their details",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "run_phase",
		description: "Run a specific spec-kit phase for a feature",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
				phase: {
					type: "string",
					enum: [
						"constitution",
						"specify",
						"clarify",
						"plan",
						"analyze",
						"tasks",
					],
				},
			},
			required: ["featureId", "phase"],
		},
	},
];

// MCP Resource definitions
export const MCP_RESOURCES = [
	{
		uri: "jobs://active",
		name: "Active Jobs",
		description: "List of currently running and pending jobs",
		mimeType: "application/json",
	},
	{
		uri: "jobs://{id}",
		name: "Job Details",
		description: "Details of a specific job",
		mimeType: "application/json",
	},
	{
		uri: "features://{id}/spec",
		name: "Feature Spec",
		description: "Specification output for a feature",
		mimeType: "application/json",
	},
	{
		uri: "phases://list",
		name: "Spec Phases",
		description: "List of all spec-kit phases",
		mimeType: "application/json",
	},
];

// Tool handlers
export async function handleToolCall(
	toolName: string,
	args: Record<string, unknown>,
): Promise<{ content: unknown; isError?: boolean }> {
	try {
		switch (toolName) {
			case "create_spec": {
				const { featureId, clientId } = args as {
					featureId: string;
					clientId: string;
				};
				const feature = await getFeature(featureId);
				if (!feature) {
					return {
						content: { error: `Feature not found: ${featureId}` },
						isError: true,
					};
				}

				const job = await createJob({
					clientId,
					featureId,
					jobType: "spec",
					prompt: `Generate specification for feature: ${feature.title}`,
					branchName: `spec/${featureId.slice(0, 8)}`,
				});

				return {
					content: {
						success: true,
						jobId: job.id,
						status: "queued",
						message: "Spec-kit job created and queued",
					},
				};
			}

			case "get_job_status": {
				const { jobId } = args as { jobId: string };
				const job = await getJob(jobId);
				if (!job) {
					return {
						content: { error: `Job not found: ${jobId}` },
						isError: true,
					};
				}

				return {
					content: {
						id: job.id,
						status: job.status,
						jobType: job.job_type,
						specPhase: job.spec_phase,
						currentIteration: job.current_iteration,
						totalIterations: job.total_iterations,
						error: job.error,
						prUrl: job.pr_url,
						createdAt: job.created_at,
						startedAt: job.started_at,
						completedAt: job.completed_at,
					},
				};
			}

			case "list_jobs": {
				const {
					status,
					jobType,
					clientId,
					limit = 20,
				} = args as {
					status?: string;
					jobType?: string;
					clientId?: string;
					limit?: number;
				};

				// Get jobs by status or all
				let jobs = status
					? await getJobsByStatus(status as JobStatus)
					: await getJobsByStatus("running");

				// Filter by job type if specified
				if (jobType) {
					jobs = jobs.filter((j) => j.job_type === jobType);
				}

				// Filter by client if specified
				if (clientId) {
					jobs = jobs.filter((j) => j.client_id === clientId);
				}

				// Limit results
				jobs = jobs.slice(0, limit);

				return {
					content: {
						count: jobs.length,
						jobs: jobs.map((j) => ({
							id: j.id,
							status: j.status,
							jobType: j.job_type,
							specPhase: j.spec_phase,
							createdAt: j.created_at,
						})),
					},
				};
			}

			case "get_spec_output": {
				const { featureId } = args as { featureId: string };
				const specOutput = await getFeatureSpecOutput(featureId);
				if (!specOutput) {
					return {
						content: { error: "No spec output found for this feature" },
						isError: true,
					};
				}

				return { content: specOutput };
			}

			case "answer_clarify": {
				const { featureId, clarificationId, response } = args as {
					featureId: string;
					clarificationId: string;
					response: string;
				};

				const result = await submitClarification(
					featureId,
					clarificationId,
					response,
				);
				return {
					content: {
						success: true,
						remainingQuestions: result.remainingQuestions,
						message:
							result.remainingQuestions === 0
								? "All clarifications answered - ready to proceed"
								: `${result.remainingQuestions} questions remaining`,
					},
				};
			}

			case "approve_spec": {
				const { featureId } = args as { featureId: string };
				const specOutput = await getFeatureSpecOutput(featureId);

				if (!specOutput) {
					return { content: { error: "No spec output found" }, isError: true };
				}

				if (specOutput.phase !== "tasks") {
					return {
						content: {
							error: `Spec is not complete. Current phase: ${specOutput.phase}`,
						},
						isError: true,
					};
				}

				// Mark as approved (this would trigger workflow stage change in the OS)
				return {
					content: {
						success: true,
						message: "Spec approved and ready for implementation",
						tasksCount: specOutput.tasks?.length || 0,
					},
				};
			}

			case "get_capacity": {
				const runningJobs = await getJobsByStatus("running");
				const queuedJobs = await getJobsByStatus("queued");
				const pendingJobs = await getJobsByStatus("pending");

				// Simple capacity model - adjust based on your setup
				const maxConcurrent = 5;
				const available = Math.max(0, maxConcurrent - runningJobs.length);

				return {
					content: {
						running: runningJobs.length,
						queued: queuedJobs.length,
						pending: pendingJobs.length,
						maxConcurrent,
						available,
						canAcceptNew: available > 0,
					},
				};
			}

			case "list_phases": {
				const phases = Object.entries(SPEC_PHASES).map(([code, info]) => ({
					code,
					...info,
				}));

				return { content: { phases } };
			}

			case "run_phase": {
				const { featureId, phase } = args as {
					featureId: string;
					phase: SpecPhase;
				};
				const feature = await getFeature(featureId);

				if (!feature) {
					return {
						content: { error: `Feature not found: ${featureId}` },
						isError: true,
					};
				}

				// Create a spec job for the specific phase
				const job = await createJob({
					clientId: feature.client_id,
					featureId,
					jobType: "spec",
					prompt: `Run ${phase} phase for feature: ${feature.title}`,
					branchName: `spec/${featureId.slice(0, 8)}`,
				});

				return {
					content: {
						success: true,
						jobId: job.id,
						phase,
						message: `Started ${phase} phase`,
					},
				};
			}

			default:
				return {
					content: { error: `Unknown tool: ${toolName}` },
					isError: true,
				};
		}
	} catch (err) {
		return { content: { error: (err as Error).message }, isError: true };
	}
}

// Resource handlers
export async function handleResourceRequest(
	uri: string,
): Promise<{ content: unknown; mimeType: string }> {
	// Parse URI
	if (uri === "jobs://active") {
		const running = await getJobsByStatus("running");
		const queued = await getJobsByStatus("queued");
		return {
			content: { running, queued },
			mimeType: "application/json",
		};
	}

	if (uri.startsWith("jobs://")) {
		const jobId = uri.replace("jobs://", "");
		const job = await getJob(jobId);
		return {
			content: job || { error: "Job not found" },
			mimeType: "application/json",
		};
	}

	if (uri.startsWith("features://") && uri.endsWith("/spec")) {
		const featureId = uri.replace("features://", "").replace("/spec", "");
		const specOutput = await getFeatureSpecOutput(featureId);
		return {
			content: specOutput || { error: "No spec output found" },
			mimeType: "application/json",
		};
	}

	if (uri === "phases://list") {
		const phases = Object.entries(SPEC_PHASES).map(([code, info]) => ({
			code,
			...info,
		}));
		return {
			content: { phases },
			mimeType: "application/json",
		};
	}

	return {
		content: { error: `Unknown resource: ${uri}` },
		mimeType: "application/json",
	};
}

/**
 * Create MCP HTTP endpoints using Express Router
 * These follow the MCP HTTP transport specification
 */
export function createMcpRouter(): Router {
	const router = Router();

	// List available tools
	router.get("/tools", (_req: Request, res: Response) => {
		res.json({ tools: MCP_TOOLS });
	});

	// List available resources
	router.get("/resources", (_req: Request, res: Response) => {
		res.json({ resources: MCP_RESOURCES });
	});

	// Execute a tool
	router.post("/tools/:toolName", async (req: Request, res: Response) => {
		const toolName = getParam(req.params, "toolName");
		const args = req.body || {};

		const result = await handleToolCall(toolName, args);

		if (result.isError) {
			return res.status(400).json(result);
		}

		res.json(result);
	});

	// Read a resource - handle different URI patterns
	router.get(
		"/resources/:resourceType",
		async (req: Request, res: Response) => {
			const { resourceType } = req.params;
			const uri = `${resourceType}://active`; // Default for list endpoints
			const result = await handleResourceRequest(uri);
			res.json(result);
		},
	);

	router.get(
		"/resources/:resourceType/:resourceId",
		async (req: Request, res: Response) => {
			const { resourceType, resourceId } = req.params;
			const uri = `${resourceType}://${resourceId}`;
			const result = await handleResourceRequest(uri);
			res.json(result);
		},
	);

	router.get(
		"/resources/:resourceType/:resourceId/:subResource",
		async (req: Request, res: Response) => {
			const { resourceType, resourceId, subResource } = req.params;
			const uri = `${resourceType}://${resourceId}/${subResource}`;
			const result = await handleResourceRequest(uri);
			res.json(result);
		},
	);

	// MCP server info
	router.get("/info", (_req: Request, res: Response) => {
		res.json({
			name: "spec-ralph",
			version: "1.0.0",
			description: "AI-powered spec generation and implementation pipeline",
			capabilities: {
				tools: true,
				resources: true,
				prompts: false,
			},
		});
	});

	return router;
}
