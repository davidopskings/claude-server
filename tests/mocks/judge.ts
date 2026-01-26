/**
 * Mock Judge module for testing
 * Provides configurable LLM judge results
 */

import type { JudgeContext, JudgeResult } from "../../src/spec/judge.js";

// Re-export types for convenience
export type { JudgeContext, JudgeResult };

let mockJudgeResult: JudgeResult = {
	passed: true,
	overallScore: 85,
	criteria: [
		{
			criterion: "Code follows existing patterns",
			passed: true,
			reasoning: "Plan follows established patterns",
		},
	],
	summary: "Plan passes quality gate",
	improvements: [],
};

let judgeCalls: JudgeContext[] = [];
let judgeResultSequence: JudgeResult[] | null = null;
let callIndex = 0;

export function resetMockJudge(): void {
	mockJudgeResult = {
		passed: true,
		overallScore: 85,
		criteria: [
			{
				criterion: "Code follows existing patterns",
				passed: true,
				reasoning: "Plan follows established patterns",
			},
		],
		summary: "Plan passes quality gate",
		improvements: [],
	};
	judgeCalls = [];
	judgeResultSequence = null;
	callIndex = 0;
}

export function setJudgeResult(result: JudgeResult): void {
	mockJudgeResult = result;
	judgeResultSequence = null;
}

export function setJudgeResultSequence(results: JudgeResult[]): void {
	judgeResultSequence = results;
	callIndex = 0;
}

export function getJudgeCalls(): JudgeContext[] {
	return judgeCalls;
}

export async function runLLMJudge(ctx: JudgeContext): Promise<JudgeResult> {
	judgeCalls.push(ctx);
	if (judgeResultSequence && callIndex < judgeResultSequence.length) {
		return judgeResultSequence[callIndex++];
	}
	return mockJudgeResult;
}
