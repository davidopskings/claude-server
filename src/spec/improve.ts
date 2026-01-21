import { spawn } from "node:child_process";
import { addJobMessage } from "../db/index.js";
import type { SpecOutput } from "../db/types.js";
import type { JudgeResult } from "./judge.js";

const HOME_DIR = process.env.HOME || "/Users/davidcavarlacic";
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

const MAX_IMPROVE_ITERATIONS = 3;

export interface ImproveContext {
	jobId: string;
	constitution: string;
	spec: SpecOutput["spec"];
	plan: SpecOutput["plan"];
	judgeResult: JudgeResult;
	cwd: string;
	iteration: number;
}

export interface ImproveResult {
	success: boolean;
	improvedPlan: SpecOutput["plan"];
	changesSummary: string[];
	iteration: number;
}

/**
 * Auto-improve loop: Revise plan based on judge feedback
 */
export async function autoImprove(ctx: ImproveContext): Promise<ImproveResult> {
	if (ctx.iteration >= MAX_IMPROVE_ITERATIONS) {
		await addJobMessage(
			ctx.jobId,
			"system",
			`Max improve iterations (${MAX_IMPROVE_ITERATIONS}) reached. Manual review required.`,
		);
		return {
			success: false,
			improvedPlan: ctx.plan,
			changesSummary: ["Max iterations reached"],
			iteration: ctx.iteration,
		};
	}

	await addJobMessage(
		ctx.jobId,
		"system",
		`Auto-improve iteration ${ctx.iteration + 1}/${MAX_IMPROVE_ITERATIONS}...`,
	);

	const prompt = buildImprovePrompt(ctx);
	const result = await runClaudeImprove(prompt, ctx.cwd, ctx.jobId);

	if (result.exitCode !== 0) {
		throw new Error(
			result.error || `Improve failed with code ${result.exitCode}`,
		);
	}

	const improveResult = parseImproveResult(result.output, ctx.iteration + 1);

	await addJobMessage(
		ctx.jobId,
		"system",
		`Improve iteration ${ctx.iteration + 1} completed. Changes: ${improveResult.changesSummary.length}`,
	);

	return improveResult;
}

/**
 * Build the improve prompt with feedback
 */
function buildImprovePrompt(ctx: ImproveContext): string {
	const failedCriteria = ctx.judgeResult.criteria.filter((c) => !c.passed);
	const feedbackSection = failedCriteria
		.map(
			(c) =>
				`### ${c.criterion}\n**Status**: FAILED\n**Reasoning**: ${c.reasoning}\n**Suggestions**:\n${c.suggestions?.map((s) => `- ${s}`).join("\n") || "None"}`,
		)
		.join("\n\n");

	return `# Auto-Improve: Plan Revision

You are revising an implementation plan based on quality feedback from a code review.

## Task
Address the failed quality criteria by improving the implementation plan.
Make targeted changes to fix the issues - don't rewrite everything.

## Constitution (Coding Standards)
${ctx.constitution}

## Original Specification
\`\`\`json
${JSON.stringify(ctx.spec, null, 2)}
\`\`\`

## Current Implementation Plan
\`\`\`json
${JSON.stringify(ctx.plan, null, 2)}
\`\`\`

## Quality Feedback (Issues to Fix)
${feedbackSection}

## Overall Improvements Needed
${ctx.judgeResult.improvements.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

## Instructions
1. Review each failed criterion carefully
2. Make specific changes to address the feedback
3. Keep changes focused - only modify what's needed
4. Maintain consistency with the constitution
5. Document what you changed and why

## Output Format
Return a JSON object:
\`\`\`json
{
  "improvedPlan": {
    "architecture": "Updated architecture markdown...",
    "techDecisions": [...],
    "fileStructure": [...],
    "dependencies": [...]
  },
  "changes": [
    {
      "criterion": "Error handling is comprehensive",
      "whatChanged": "Added try-catch blocks to all API calls",
      "details": "Specifically updated fetchUser and updateProfile functions"
    }
  ],
  "changesSummary": [
    "Added comprehensive error handling",
    "Removed hardcoded configuration values"
  ]
}
\`\`\`

**IMPORTANT**:
- Address ALL failed criteria
- Be specific about what changed
- Preserve what was already good
- Follow the codebase patterns from constitution`;
}

/**
 * Run Claude to improve the plan
 */
async function runClaudeImprove(
	prompt: string,
	cwd: string,
	jobId: string,
): Promise<{ exitCode: number; output: string; error?: string }> {
	return new Promise((resolve) => {
		console.log(`Starting Claude Improve for job ${jobId}...`);

		const proc = spawn(
			CLAUDE_BIN,
			[
				"--print",
				"--dangerously-skip-permissions",
				"--output-format",
				"text",
				"--verbose",
				prompt,
			],
			{
				cwd,
				env: { ...process.env, HOME: HOME_DIR },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stdout = "";
		let stderrBuffer = "";

		proc.stdout.on("data", (data: Buffer) => {
			const content = data.toString();
			stdout += content;
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderrBuffer += data.toString();
		});

		proc.on("close", (code: number | null) => {
			resolve({
				exitCode: code || 0,
				output: stdout,
				error: code !== 0 ? stderrBuffer || "Unknown error" : undefined,
			});
		});

		proc.on("error", (err: Error) => {
			resolve({
				exitCode: 1,
				output: "",
				error: err.message,
			});
		});
	});
}

/**
 * Parse improve output to structured result
 */
function parseImproveResult(output: string, iteration: number): ImproveResult {
	// Try to find JSON in the output
	const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[1]);
			return {
				success: true,
				improvedPlan: parsed.improvedPlan,
				changesSummary: parsed.changesSummary || [],
				iteration,
			};
		} catch (e) {
			console.error("Failed to parse JSON from improve output:", e);
		}
	}

	// Try to find raw JSON object
	const rawJsonMatch = output.match(/\{[\s\S]*\}/);
	if (rawJsonMatch) {
		try {
			const parsed = JSON.parse(rawJsonMatch[0]);
			return {
				success: true,
				improvedPlan: parsed.improvedPlan,
				changesSummary: parsed.changesSummary || [],
				iteration,
			};
		} catch (e) {
			console.error("Failed to parse raw JSON from improve output:", e);
		}
	}

	// Default failed result
	return {
		success: false,
		improvedPlan: undefined,
		changesSummary: ["Failed to parse improve output"],
		iteration,
	};
}

/**
 * Run the full judge-improve loop
 */
export async function runJudgeImproveLoop(
	ctx: Omit<ImproveContext, "judgeResult" | "iteration">,
	runJudge: (plan: SpecOutput["plan"]) => Promise<JudgeResult>,
): Promise<{
	finalPlan: SpecOutput["plan"];
	judgeResult: JudgeResult;
	iterations: number;
}> {
	let currentPlan = ctx.plan;
	let iterations = 0;

	while (iterations < MAX_IMPROVE_ITERATIONS) {
		// Run judge
		const judgeResult = await runJudge(currentPlan);

		if (judgeResult.passed) {
			return { finalPlan: currentPlan, judgeResult, iterations };
		}

		// Run improve
		const improveResult = await autoImprove({
			...ctx,
			plan: currentPlan,
			judgeResult,
			iteration: iterations,
		});

		if (!improveResult.success || !improveResult.improvedPlan) {
			// Improve failed, return current state
			return { finalPlan: currentPlan, judgeResult, iterations };
		}

		currentPlan = improveResult.improvedPlan;
		iterations++;
	}

	// Max iterations reached, run final judge
	const finalJudge = await runJudge(currentPlan);
	return { finalPlan: currentPlan, judgeResult: finalJudge, iterations };
}
