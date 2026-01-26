import { spawn } from "node:child_process";
import { addJobMessage } from "../db/index.js";
import type { SpecOutput } from "../db/types.js";

const HOME_DIR = process.env.HOME || "/Users/davidcavarlacic";
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// Default quality criteria for all projects
export const DEFAULT_QUALITY_CRITERIA = [
	"Code follows existing patterns in the codebase",
	"Error handling is comprehensive",
	"No hardcoded values that should be config",
	"Functions are focused and under 50 lines",
	"Comments explain 'why', not 'what'",
	"TypeScript types are strict (no 'any')",
	"API calls have proper error boundaries",
	"Security considerations are addressed",
	"Performance implications are considered",
];

export interface JudgeResult {
	passed: boolean;
	overallScore: number; // 0-100
	criteria: {
		criterion: string;
		passed: boolean;
		reasoning: string;
		suggestions?: string[];
	}[];
	summary: string;
	improvements: string[];
}

export interface JudgeContext {
	jobId: string;
	clientId?: string;
	constitution: string;
	spec: SpecOutput["spec"];
	plan: SpecOutput["plan"];
	cwd: string;
}

/**
 * LLM-as-Judge: Evaluate plan quality against criteria
 */
export async function runLLMJudge(ctx: JudgeContext): Promise<JudgeResult> {
	const criteria = await getQualityCriteria(ctx.clientId);

	const prompt = buildJudgePrompt(ctx, criteria);

	await addJobMessage(
		ctx.jobId,
		"system",
		`Running LLM-as-Judge with ${criteria.length} quality criteria...`,
	);

	const result = await runClaudeJudge(prompt, ctx.cwd, ctx.jobId);

	if (result.exitCode !== 0) {
		throw new Error(
			result.error || `Judge failed with code ${result.exitCode}`,
		);
	}

	const judgeResult = parseJudgeResult(result.output);

	await addJobMessage(
		ctx.jobId,
		"system",
		`Judge result: ${judgeResult.passed ? "PASSED" : "FAILED"} (score: ${judgeResult.overallScore}/100)`,
	);

	// Log failed criteria
	const failedCriteria = judgeResult.criteria.filter((c) => !c.passed);
	if (failedCriteria.length > 0) {
		await addJobMessage(
			ctx.jobId,
			"system",
			`Failed criteria: ${failedCriteria.map((c) => c.criterion).join(", ")}`,
		);
	}

	return judgeResult;
}

/**
 * Get quality criteria for a client (or defaults)
 */
async function getQualityCriteria(_clientId?: string): Promise<string[]> {
	// TODO: Load client-specific criteria from database
	// For now, return defaults
	return DEFAULT_QUALITY_CRITERIA;
}

/**
 * Build the judge prompt
 */
function buildJudgePrompt(ctx: JudgeContext, criteria: string[]): string {
	return `# LLM-as-Judge: Quality Evaluation

You are a senior software architect evaluating an implementation plan for quality.

## Task
Evaluate the implementation plan against the following quality criteria.
For each criterion, determine if it PASSES or FAILS with brief reasoning.

## Quality Criteria
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Constitution (Coding Standards)
${ctx.constitution}

## Specification
\`\`\`json
${JSON.stringify(ctx.spec, null, 2)}
\`\`\`

## Implementation Plan
\`\`\`json
${JSON.stringify(ctx.plan, null, 2)}
\`\`\`

## Instructions
1. Analyze the plan against each criterion
2. For each criterion, determine PASS or FAIL
3. Provide clear reasoning
4. Suggest specific improvements for failures
5. Calculate overall score (0-100)

## Output Format
Return a JSON object:
\`\`\`json
{
  "passed": true/false,
  "overallScore": 85,
  "criteria": [
    {
      "criterion": "Code follows existing patterns",
      "passed": true,
      "reasoning": "The plan correctly uses existing service patterns...",
      "suggestions": []
    },
    {
      "criterion": "Error handling is comprehensive",
      "passed": false,
      "reasoning": "Missing error handling for API failures in...",
      "suggestions": ["Add try-catch in fetchUser function", "Handle network timeout"]
    }
  ],
  "summary": "Overall assessment summary",
  "improvements": [
    "Specific improvement 1",
    "Specific improvement 2"
  ]
}
\`\`\`

**IMPORTANT**:
- Set \`passed: true\` only if ALL criteria pass
- Be strict but fair
- Focus on actionable feedback
- Consider the specific codebase patterns from the constitution`;
}

/**
 * Run Claude as a judge
 */
async function runClaudeJudge(
	prompt: string,
	cwd: string,
	jobId: string,
): Promise<{ exitCode: number; output: string; error?: string }> {
	return new Promise((resolve) => {
		console.log(`Starting Claude Judge for job ${jobId}...`);

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
 * Parse judge output to structured result
 */
function parseJudgeResult(output: string): JudgeResult {
	// Try to find JSON in the output
	const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[1]) as JudgeResult;
		} catch (e) {
			console.error("Failed to parse JSON from judge output:", e);
		}
	}

	// Try to find raw JSON object
	const rawJsonMatch = output.match(/\{[\s\S]*\}/);
	if (rawJsonMatch) {
		try {
			return JSON.parse(rawJsonMatch[0]) as JudgeResult;
		} catch (e) {
			console.error("Failed to parse raw JSON from judge output:", e);
		}
	}

	// Default failed result if we couldn't parse
	return {
		passed: false,
		overallScore: 0,
		criteria: [],
		summary: "Failed to parse judge output",
		improvements: ["Unable to evaluate - judge output could not be parsed"],
	};
}
