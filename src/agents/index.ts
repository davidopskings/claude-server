/**
 * Multi-Agent Orchestration
 *
 * Specialized agents for each concern, coordinated by a Conductor.
 * Uses different Claude models based on task complexity.
 */

import { spawn } from "node:child_process";
import { addJobMessage } from "../db/index.js";
import type { TraceContext } from "../observability/index.js";

const HOME_DIR = process.env.HOME || "/Users/davidcavarlacic";
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// Agent type definitions
export type AgentType = "conductor" | "spec" | "code" | "test" | "review";

export interface AgentConfig {
	name: string;
	type: AgentType;
	model: "claude-opus-4" | "claude-sonnet-4" | "claude-haiku";
	role: string;
	systemPrompt: string;
	tools: string[];
	maxParallel: number;
}

export interface AgentTask {
	id: string;
	agentType: AgentType;
	prompt: string;
	context?: Record<string, unknown>;
	dependencies?: string[]; // Task IDs that must complete first
}

export interface AgentResult {
	taskId: string;
	agentType: AgentType;
	success: boolean;
	output: string;
	error?: string;
	tokensUsed?: number;
}

// Agent configurations
export const AGENTS: Record<AgentType, AgentConfig> = {
	conductor: {
		name: "Conductor",
		type: "conductor",
		model: "claude-opus-4",
		role: "Orchestrate agents, make decisions, handle escalations",
		systemPrompt: `You are the Conductor - a senior technical architect who orchestrates other AI agents.

Your responsibilities:
1. Break down complex tasks into subtasks for specialized agents
2. Assign tasks to the appropriate agent type
3. Review outputs and decide on next steps
4. Handle escalations when agents encounter issues
5. Make final decisions on technical trade-offs

You have access to these agent types:
- spec_agent: Generates specifications and clarification questions
- code_agent: Implements code following specs and patterns
- test_agent: Writes and fixes tests
- review_agent: Reviews code for quality and security

Output your decisions in JSON format for orchestration.`,
		tools: ["read", "analyze"],
		maxParallel: 1,
	},

	spec: {
		name: "Spec Agent",
		type: "spec",
		model: "claude-sonnet-4",
		role: "Generate specifications, ask clarifying questions",
		systemPrompt: `You are a Spec Agent - you create detailed technical specifications.

Your responsibilities:
1. Analyze feature requests and understand requirements
2. Generate clear, implementable specifications
3. Identify ambiguities and create clarification questions
4. Plan the technical approach

Focus on the WHAT and WHY, not the HOW. Output specifications in a structured JSON format.`,
		tools: ["read", "search"],
		maxParallel: 10,
	},

	code: {
		name: "Code Agent",
		type: "code",
		model: "claude-sonnet-4",
		role: "Implement code following specs and patterns",
		systemPrompt: `You are a Code Agent - you implement code based on specifications.

Your responsibilities:
1. Read and understand specifications
2. Implement code that meets all requirements
3. Follow existing codebase patterns and conventions
4. Write clean, maintainable code
5. Include basic inline documentation

Always check existing code patterns before implementing. Do not deviate from the spec.`,
		tools: ["read", "write", "edit", "bash"],
		maxParallel: 5,
	},

	test: {
		name: "Test Agent",
		type: "test",
		model: "claude-sonnet-4",
		role: "Write and fix tests",
		systemPrompt: `You are a Test Agent - you ensure code quality through testing.

Your responsibilities:
1. Write comprehensive tests for new code
2. Fix failing tests
3. Ensure good test coverage
4. Validate edge cases and error handling

Match the existing testing patterns in the codebase. Focus on meaningful tests, not just coverage numbers.`,
		tools: ["read", "write", "bash"],
		maxParallel: 5,
	},

	review: {
		name: "Review Agent",
		type: "review",
		model: "claude-opus-4",
		role: "Review code for quality, security, patterns",
		systemPrompt: `You are a Review Agent - a senior code reviewer focused on quality and security.

Your responsibilities:
1. Review code changes for quality
2. Identify security vulnerabilities
3. Check adherence to patterns and conventions
4. Suggest improvements
5. Approve or request changes

Be thorough but fair. Flag blocking issues vs nice-to-haves. Output in structured JSON.`,
		tools: ["read", "analyze"],
		maxParallel: 2,
	},
};

/**
 * Run an agent with a specific task
 */
export async function runAgent(
	task: AgentTask,
	cwd: string,
	jobId: string,
	_parentTrace?: TraceContext,
): Promise<AgentResult> {
	const config = AGENTS[task.agentType];

	await addJobMessage(
		jobId,
		"system",
		`[${config.name}] Starting task: ${task.id}`,
	);

	// Build the full prompt
	const fullPrompt = buildAgentPrompt(config, task);

	try {
		const output = await runClaudeWithAgent(
			fullPrompt,
			cwd,
			jobId,
			config.model,
		);

		await addJobMessage(
			jobId,
			"system",
			`[${config.name}] Completed task: ${task.id}`,
		);

		return {
			taskId: task.id,
			agentType: task.agentType,
			success: true,
			output,
		};
	} catch (err) {
		await addJobMessage(
			jobId,
			"system",
			`[${config.name}] Failed task: ${task.id} - ${(err as Error).message}`,
		);

		return {
			taskId: task.id,
			agentType: task.agentType,
			success: false,
			output: "",
			error: (err as Error).message,
		};
	}
}

/**
 * Build the complete prompt for an agent
 */
function buildAgentPrompt(config: AgentConfig, task: AgentTask): string {
	let prompt = `# ${config.name} Task

## Your Role
${config.role}

## System Instructions
${config.systemPrompt}

## Task
${task.prompt}
`;

	if (task.context) {
		prompt += `
## Context
\`\`\`json
${JSON.stringify(task.context, null, 2)}
\`\`\`
`;
	}

	return prompt;
}

/**
 * Run Claude CLI with specific agent configuration
 */
async function runClaudeWithAgent(
	prompt: string,
	cwd: string,
	_jobId: string,
	model: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		// Map model name to actual model parameter
		const modelArg =
			model === "claude-opus-4"
				? "opus"
				: model === "claude-sonnet-4"
					? "sonnet"
					: "haiku";

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"text",
				"--model",
				modelArg,
				prompt,
			],
			{
				cwd,
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code: number | null) => {
			if (code !== 0) {
				reject(new Error(stderr || `Agent exited with code ${code}`));
			} else {
				resolve(stdout);
			}
		});

		proc.on("error", (err: Error) => {
			reject(err);
		});
	});
}

/**
 * Conductor workflow - orchestrate multiple agents for a complex task
 */
export async function conductorWorkflow(
	jobId: string,
	cwd: string,
	task: string,
	context: Record<string, unknown> = {},
): Promise<{ success: boolean; results: AgentResult[] }> {
	const results: AgentResult[] = [];

	await addJobMessage(jobId, "system", "=== Starting Conductor Workflow ===");

	// Step 1: Have conductor analyze and plan
	const planningTask: AgentTask = {
		id: "conductor-plan",
		agentType: "conductor",
		prompt: `Analyze this task and create an execution plan:

Task: ${task}

Context:
${JSON.stringify(context, null, 2)}

Output a JSON object with:
{
  "analysis": "Your analysis of the task",
  "plan": [
    { "step": 1, "agent": "spec|code|test|review", "task": "description" }
  ],
  "risks": ["potential risks"],
  "estimatedComplexity": "low|medium|high"
}`,
	};

	const planResult = await runAgent(planningTask, cwd, jobId);
	results.push(planResult);

	if (!planResult.success) {
		return { success: false, results };
	}

	// Parse conductor's plan
	let plan: { step: number; agent: AgentType; task: string }[] = [];
	try {
		const planJson = extractJson(planResult.output) as {
			plan?: { step: number; agent: AgentType; task: string }[];
		} | null;
		if (planJson?.plan) {
			plan = planJson.plan;
		}
	} catch (_err) {
		await addJobMessage(
			jobId,
			"system",
			"Failed to parse conductor plan, using default workflow",
		);
		// Default workflow: spec -> code -> test -> review
		plan = [
			{ step: 1, agent: "spec", task: "Generate specification" },
			{ step: 2, agent: "code", task: "Implement code" },
			{ step: 3, agent: "test", task: "Write tests" },
			{ step: 4, agent: "review", task: "Review changes" },
		];
	}

	await addJobMessage(
		jobId,
		"system",
		`Conductor planned ${plan.length} steps`,
	);

	// Step 2: Execute each step in the plan
	let accumulatedContext = { ...context };

	for (const step of plan) {
		const stepTask: AgentTask = {
			id: `step-${step.step}-${step.agent}`,
			agentType: step.agent as AgentType,
			prompt: step.task,
			context: accumulatedContext,
		};

		const stepResult = await runAgent(stepTask, cwd, jobId);
		results.push(stepResult);

		if (!stepResult.success) {
			// Ask conductor how to handle failure
			const recoveryTask: AgentTask = {
				id: "conductor-recovery",
				agentType: "conductor",
				prompt: `Step ${step.step} (${step.agent}) failed with error: ${stepResult.error}

Original task: ${step.task}

Decide how to proceed:
1. Retry with modifications
2. Skip and continue
3. Abort workflow

Output JSON: { "decision": "retry|skip|abort", "reason": "...", "modifications": "..." }`,
				context: accumulatedContext,
			};

			const recoveryResult = await runAgent(recoveryTask, cwd, jobId);
			results.push(recoveryResult);

			try {
				const recovery = extractJson(recoveryResult.output) as {
					decision?: "retry" | "skip" | "abort";
					reason?: string;
				} | null;
				if (recovery?.decision === "abort") {
					await addJobMessage(
						jobId,
						"system",
						`Conductor decided to abort: ${recovery?.reason ?? "unknown reason"}`,
					);
					return { success: false, results };
				}
				// For retry/skip, continue to next step
			} catch {
				// Default: continue on failure
			}
		} else {
			// Add step output to context for next steps
			accumulatedContext = {
				...accumulatedContext,
				[`step${step.step}_output`]: stepResult.output,
			};
		}
	}

	// Step 3: Final conductor review
	const reviewTask: AgentTask = {
		id: "conductor-final",
		agentType: "conductor",
		prompt: `Review the completed workflow and provide a summary:

Original task: ${task}
Steps completed: ${plan.length}

Output JSON: { "success": true/false, "summary": "...", "recommendations": ["..."] }`,
		context: accumulatedContext,
	};

	const finalResult = await runAgent(reviewTask, cwd, jobId);
	results.push(finalResult);

	await addJobMessage(jobId, "system", "=== Conductor Workflow Complete ===");

	return {
		success: results.every((r) => r.success),
		results,
	};
}

/**
 * Run agents in parallel (for independent tasks)
 */
export async function runAgentsParallel(
	tasks: AgentTask[],
	cwd: string,
	jobId: string,
): Promise<AgentResult[]> {
	await addJobMessage(
		jobId,
		"system",
		`Running ${tasks.length} agents in parallel`,
	);

	const results = await Promise.all(
		tasks.map((task) => runAgent(task, cwd, jobId)),
	);

	const succeeded = results.filter((r) => r.success).length;
	await addJobMessage(
		jobId,
		"system",
		`Parallel execution: ${succeeded}/${tasks.length} succeeded`,
	);

	return results;
}

/**
 * Extract JSON from a string (handles markdown code blocks)
 */
function extractJson(text: string): unknown {
	// Try to find JSON in code block
	const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return JSON.parse(codeBlockMatch[1]);
	}

	// Try to find raw JSON object
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		return JSON.parse(jsonMatch[0]);
	}

	throw new Error("No JSON found in output");
}
