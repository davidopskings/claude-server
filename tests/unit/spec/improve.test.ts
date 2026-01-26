/**
 * Unit tests for spec/improve.ts pure logic functions
 * Tests buildImprovePrompt, parseImproveResult, and judge-improve loop logic
 */

import { describe, expect, it } from "bun:test";
import type { SpecOutput } from "../../../src/db/types.js";

// ===== Replicated types and functions from src/spec/improve.ts =====

interface JudgeResult {
	passed: boolean;
	overallScore: number;
	criteria: {
		criterion: string;
		passed: boolean;
		reasoning: string;
		suggestions?: string[];
	}[];
	summary: string;
	improvements: string[];
}

interface ImproveContext {
	jobId: string;
	constitution: string;
	spec: SpecOutput["spec"];
	plan: SpecOutput["plan"];
	judgeResult: JudgeResult;
	cwd: string;
	iteration: number;
}

interface ImproveResult {
	success: boolean;
	improvedPlan: SpecOutput["plan"];
	changesSummary: string[];
	iteration: number;
}

const MAX_IMPROVE_ITERATIONS = 3;

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

function parseImproveResult(output: string, iteration: number): ImproveResult {
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
		} catch (_e) {
			// Fall through
		}
	}

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
		} catch (_e) {
			// Fall through
		}
	}

	return {
		success: false,
		improvedPlan: undefined,
		changesSummary: ["Failed to parse improve output"],
		iteration,
	};
}

// ===== Tests =====

describe("Spec Improve Pure Logic", () => {
	const sampleJudgeResult: JudgeResult = {
		passed: false,
		overallScore: 55,
		criteria: [
			{
				criterion: "Error handling is comprehensive",
				passed: false,
				reasoning: "Missing try-catch in API layer",
				suggestions: ["Add error boundaries", "Handle timeout"],
			},
			{
				criterion: "Code follows existing patterns",
				passed: true,
				reasoning: "Follows service pattern correctly",
			},
			{
				criterion: "No hardcoded values",
				passed: false,
				reasoning: "Found hardcoded API URL",
				suggestions: ["Use env vars"],
			},
		],
		summary: "Needs improvement",
		improvements: ["Fix error handling", "Remove hardcoded values"],
	};

	const sampleCtx: ImproveContext = {
		jobId: "job-1",
		constitution: "# Standards\n- TypeScript strict",
		spec: {
			overview: "Add auth",
			requirements: ["REQ-001"],
			acceptanceCriteria: ["AC-001"],
		},
		plan: {
			architecture: "JWT auth",
			techDecisions: ["Use bcrypt"],
			fileStructure: ["src/auth/index.ts"],
		},
		judgeResult: sampleJudgeResult,
		cwd: "/tmp/work",
		iteration: 0,
	};

	describe("buildImprovePrompt", () => {
		it("should include only failed criteria in feedback section", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("### Error handling is comprehensive");
			expect(prompt).toContain("### No hardcoded values");
			expect(prompt).not.toContain("### Code follows existing patterns");
		});

		it("should include FAILED status for each failed criterion", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("**Status**: FAILED");
		});

		it("should include reasoning for failures", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("Missing try-catch in API layer");
			expect(prompt).toContain("Found hardcoded API URL");
		});

		it("should include suggestions", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("- Add error boundaries");
			expect(prompt).toContain("- Handle timeout");
			expect(prompt).toContain("- Use env vars");
		});

		it("should include constitution", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("## Constitution (Coding Standards)");
			expect(prompt).toContain("TypeScript strict");
		});

		it("should include spec as JSON", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("## Original Specification");
			expect(prompt).toContain('"overview": "Add auth"');
		});

		it("should include plan as JSON", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("## Current Implementation Plan");
			expect(prompt).toContain('"architecture": "JWT auth"');
		});

		it("should include numbered improvements", () => {
			const prompt = buildImprovePrompt(sampleCtx);
			expect(prompt).toContain("1. Fix error handling");
			expect(prompt).toContain("2. Remove hardcoded values");
		});

		it("should handle criteria with no suggestions", () => {
			const ctx: ImproveContext = {
				...sampleCtx,
				judgeResult: {
					...sampleJudgeResult,
					criteria: [
						{
							criterion: "Test",
							passed: false,
							reasoning: "Bad",
						},
					],
				},
			};
			const prompt = buildImprovePrompt(ctx);
			expect(prompt).toContain("None");
		});
	});

	describe("parseImproveResult", () => {
		it("should parse JSON from code block", () => {
			const output = `\`\`\`json
{
  "improvedPlan": {"architecture": "Updated plan"},
  "changesSummary": ["Fixed error handling"]
}
\`\`\``;
			const result = parseImproveResult(output, 1);
			expect(result.success).toBe(true);
			expect(result.improvedPlan).toEqual({ architecture: "Updated plan" });
			expect(result.changesSummary).toEqual(["Fixed error handling"]);
			expect(result.iteration).toBe(1);
		});

		it("should parse raw JSON object", () => {
			const output = `{"improvedPlan": {"architecture": "Better"}, "changesSummary": ["Changed arch"]}`;
			const result = parseImproveResult(output, 2);
			expect(result.success).toBe(true);
			expect(result.iteration).toBe(2);
		});

		it("should return failed result for unparseable output", () => {
			const output = "This is plain text, not JSON";
			const result = parseImproveResult(output, 0);
			expect(result.success).toBe(false);
			expect(result.improvedPlan).toBeUndefined();
			expect(result.changesSummary).toContain("Failed to parse improve output");
		});

		it("should default changesSummary to empty array if missing", () => {
			const output = `\`\`\`json
{"improvedPlan": {"architecture": "Updated"}}
\`\`\``;
			const result = parseImproveResult(output, 1);
			expect(result.success).toBe(true);
			expect(result.changesSummary).toEqual([]);
		});

		it("should preserve iteration number", () => {
			const output = `{"improvedPlan": {}, "changesSummary": []}`;
			const result = parseImproveResult(output, 5);
			expect(result.iteration).toBe(5);
		});

		it("should handle invalid JSON in code block gracefully", () => {
			const output = "```json\n{not valid json\n```";
			const result = parseImproveResult(output, 0);
			expect(result.success).toBe(false);
		});
	});

	describe("Judge-Improve Loop Logic", () => {
		it("should respect MAX_IMPROVE_ITERATIONS constant", () => {
			expect(MAX_IMPROVE_ITERATIONS).toBe(3);
		});

		it("should model loop termination on pass", async () => {
			let iterations = 0;
			const maxIter = MAX_IMPROVE_ITERATIONS;

			// Simulate: judge passes on first try
			const mockRunJudge = async (): Promise<JudgeResult> => {
				return { ...sampleJudgeResult, passed: true, overallScore: 90 };
			};

			while (iterations < maxIter) {
				const judgeResult = await mockRunJudge();
				if (judgeResult.passed) break;
				iterations++;
			}

			expect(iterations).toBe(0);
		});

		it("should model loop termination on max iterations", async () => {
			let iterations = 0;
			const maxIter = MAX_IMPROVE_ITERATIONS;

			// Simulate: judge never passes
			const mockRunJudge = async (): Promise<JudgeResult> => {
				return { ...sampleJudgeResult, passed: false };
			};

			while (iterations < maxIter) {
				const judgeResult = await mockRunJudge();
				if (judgeResult.passed) break;
				iterations++;
			}

			expect(iterations).toBe(MAX_IMPROVE_ITERATIONS);
		});
	});
});
