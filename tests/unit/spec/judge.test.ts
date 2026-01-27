/**
 * Unit tests for spec/judge.ts pure logic functions
 * Tests DEFAULT_QUALITY_CRITERIA, buildJudgePrompt, parseJudgeResult
 */

import { describe, expect, it } from "bun:test";
import type { SpecOutput } from "../../../src/db/types.js";

// ===== Replicated constants and functions from src/spec/judge.ts =====

const DEFAULT_QUALITY_CRITERIA = [
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

interface JudgeContext {
	jobId: string;
	clientId?: string;
	constitution: string;
	spec: SpecOutput["spec"];
	plan: SpecOutput["plan"];
	cwd: string;
}

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

function parseJudgeResult(output: string): JudgeResult {
	const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[1]) as JudgeResult;
		} catch (_e) {
			// Fall through to next attempt
		}
	}

	const rawJsonMatch = output.match(/\{[\s\S]*\}/);
	if (rawJsonMatch) {
		try {
			return JSON.parse(rawJsonMatch[0]) as JudgeResult;
		} catch (_e) {
			// Fall through to default
		}
	}

	return {
		passed: false,
		overallScore: 0,
		criteria: [],
		summary: "Failed to parse judge output",
		improvements: ["Unable to evaluate - judge output could not be parsed"],
	};
}

// ===== Tests =====

describe("Spec Judge Pure Logic", () => {
	describe("DEFAULT_QUALITY_CRITERIA", () => {
		it("should have 9 criteria", () => {
			expect(DEFAULT_QUALITY_CRITERIA).toHaveLength(9);
		});

		it("should all be non-empty strings", () => {
			for (const criterion of DEFAULT_QUALITY_CRITERIA) {
				expect(typeof criterion).toBe("string");
				expect(criterion.length).toBeGreaterThan(0);
			}
		});

		it("should include TypeScript strict types criterion", () => {
			const hasTypesCriterion = DEFAULT_QUALITY_CRITERIA.some((c) =>
				c.includes("any"),
			);
			expect(hasTypesCriterion).toBe(true);
		});

		it("should include error handling criterion", () => {
			const hasErrorHandling = DEFAULT_QUALITY_CRITERIA.some((c) =>
				c.toLowerCase().includes("error handling"),
			);
			expect(hasErrorHandling).toBe(true);
		});

		it("should include security criterion", () => {
			const hasSecurity = DEFAULT_QUALITY_CRITERIA.some((c) =>
				c.toLowerCase().includes("security"),
			);
			expect(hasSecurity).toBe(true);
		});
	});

	describe("buildJudgePrompt", () => {
		const ctx: JudgeContext = {
			jobId: "job-1",
			constitution: "# Standards\n- Use TypeScript",
			spec: {
				overview: "Add auth",
				requirements: ["REQ-001"],
				acceptanceCriteria: ["AC-001"],
			},
			plan: {
				architecture: "JWT-based auth",
				techDecisions: ["Use bcrypt"],
				fileStructure: ["src/auth/index.ts"],
			},
			cwd: "/tmp/work",
		};

		it("should include quality criteria numbered list", () => {
			const prompt = buildJudgePrompt(ctx, DEFAULT_QUALITY_CRITERIA);
			expect(prompt).toContain("1. Code follows existing patterns");
			expect(prompt).toContain("9. Performance implications");
		});

		it("should include constitution", () => {
			const prompt = buildJudgePrompt(ctx, DEFAULT_QUALITY_CRITERIA);
			expect(prompt).toContain("## Constitution (Coding Standards)");
			expect(prompt).toContain("Use TypeScript");
		});

		it("should include spec as JSON", () => {
			const prompt = buildJudgePrompt(ctx, DEFAULT_QUALITY_CRITERIA);
			expect(prompt).toContain("## Specification");
			expect(prompt).toContain('"overview": "Add auth"');
		});

		it("should include plan as JSON", () => {
			const prompt = buildJudgePrompt(ctx, DEFAULT_QUALITY_CRITERIA);
			expect(prompt).toContain("## Implementation Plan");
			expect(prompt).toContain('"architecture": "JWT-based auth"');
		});

		it("should include output format instructions", () => {
			const prompt = buildJudgePrompt(ctx, DEFAULT_QUALITY_CRITERIA);
			expect(prompt).toContain("## Output Format");
			expect(prompt).toContain('"passed": true/false');
		});
	});

	describe("parseJudgeResult", () => {
		it("should parse JSON from code block", () => {
			const output = `Here is my analysis:
\`\`\`json
{
  "passed": true,
  "overallScore": 85,
  "criteria": [],
  "summary": "Good quality",
  "improvements": []
}
\`\`\``;
			const result = parseJudgeResult(output);
			expect(result.passed).toBe(true);
			expect(result.overallScore).toBe(85);
			expect(result.summary).toBe("Good quality");
		});

		it("should parse raw JSON object", () => {
			const output = `{"passed": false, "overallScore": 40, "criteria": [], "summary": "Needs work", "improvements": ["Fix errors"]}`;
			const result = parseJudgeResult(output);
			expect(result.passed).toBe(false);
			expect(result.overallScore).toBe(40);
			expect(result.improvements).toContain("Fix errors");
		});

		it("should return default failed result for unparseable output", () => {
			const output = "This is not JSON at all!";
			const result = parseJudgeResult(output);
			expect(result.passed).toBe(false);
			expect(result.overallScore).toBe(0);
			expect(result.criteria).toHaveLength(0);
			expect(result.summary).toContain("Failed to parse");
		});

		it("should return default result for invalid JSON in code block", () => {
			const output = "```json\n{invalid json here}\n```";
			const result = parseJudgeResult(output);
			expect(result.passed).toBe(false);
			expect(result.overallScore).toBe(0);
		});

		it("should parse criteria with suggestions", () => {
			const judgeOutput = `\`\`\`json
{
  "passed": false,
  "overallScore": 60,
  "criteria": [
    {
      "criterion": "Error handling",
      "passed": false,
      "reasoning": "Missing try-catch",
      "suggestions": ["Add error boundaries"]
    }
  ],
  "summary": "Partial pass",
  "improvements": ["Improve error handling"]
}
\`\`\``;
			const result = parseJudgeResult(judgeOutput);
			expect(result.criteria).toHaveLength(1);
			expect(result.criteria[0].passed).toBe(false);
			expect(result.criteria[0].suggestions).toContain("Add error boundaries");
		});
	});
});
