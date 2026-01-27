/**
 * Unit tests for Spec-Kit auto-progression logic
 *
 * Tests the decision logic in:
 * - src/spec/runner.ts — auto-creating next phase jobs after completion
 * - src/index.ts — auto-triggering plan phase when last clarification is answered
 */

import { describe, expect, it } from "bun:test";
import type { SpecOutput, SpecPhase } from "../../../src/db/types.js";
import { getNextPhase } from "../../../src/spec/phases.js";
import {
	analyzeOutput,
	clarifyOutput,
	constitutionOutput,
	planOutput,
	specifyOutput,
	tasksOutput,
} from "../../fixtures/index.js";

// ===== Replicated decision logic from src/spec/runner.ts =====

/**
 * Determines auto-progression outcome after a spec phase completes.
 * Mirrors the logic at runner.ts lines 392-658.
 */
function determineAutoProgression(
	specPhase: SpecPhase,
	mergedOutput: SpecOutput,
): {
	nextPhase: SpecPhase | null;
	needsHumanInput: boolean;
	action: "auto_progress" | "wait_human" | "analyze_failed" | "spec_complete";
} {
	let nextPhase = getNextPhase(specPhase);
	let needsHumanInput = false;

	// Special handling for clarify phase
	if (specPhase === "clarify" && mergedOutput.clarifications?.length) {
		const unanswered = mergedOutput.clarifications.filter((c) => !c.response);
		if (unanswered.length > 0) {
			needsHumanInput = true;
		}
	}

	// Special handling for analyze phase - don't proceed if analysis failed
	if (specPhase === "analyze") {
		if (mergedOutput.analysis && !mergedOutput.analysis.passed) {
			nextPhase = null;
		}
	}

	// Determine action
	if (needsHumanInput) {
		return { nextPhase, needsHumanInput, action: "wait_human" };
	}
	if (nextPhase) {
		return { nextPhase, needsHumanInput, action: "auto_progress" };
	}
	if (specPhase === "analyze" && !mergedOutput.analysis?.passed) {
		return { nextPhase: null, needsHumanInput, action: "analyze_failed" };
	}
	return { nextPhase: null, needsHumanInput, action: "spec_complete" };
}

// ===== Replicated decision logic from src/index.ts clarification endpoint =====

/**
 * Determines whether submitting a clarification should auto-trigger the plan phase.
 * Mirrors the logic at index.ts lines 1111-1135.
 */
function determineClarificationAutoTrigger(remainingQuestions: number): {
	shouldAutoProgress: boolean;
	autoProgressedTo: SpecPhase | null;
} {
	if (remainingQuestions === 0) {
		return { shouldAutoProgress: true, autoProgressedTo: "plan" };
	}
	return { shouldAutoProgress: false, autoProgressedTo: null };
}

// ===== Tests =====

describe("Spec-Kit Auto-Progression (runner.ts)", () => {
	describe("createSpecJob called with correct nextPhase", () => {
		it("should auto-progress constitution → specify", () => {
			const result = determineAutoProgression(
				"constitution",
				constitutionOutput,
			);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("specify");
			expect(result.needsHumanInput).toBe(false);
		});

		it("should auto-progress specify → clarify", () => {
			const result = determineAutoProgression("specify", specifyOutput);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("clarify");
			expect(result.needsHumanInput).toBe(false);
		});

		it("should auto-progress clarify → plan when all questions answered", () => {
			const allAnswered: SpecOutput = {
				...clarifyOutput,
				clarifications: clarifyOutput.clarifications?.map((c) => ({
					...c,
					response: c.response || "Answered",
					respondedAt: c.respondedAt || new Date().toISOString(),
				})),
			};
			const result = determineAutoProgression("clarify", allAnswered);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("plan");
			expect(result.needsHumanInput).toBe(false);
		});

		it("should auto-progress plan → analyze", () => {
			const result = determineAutoProgression("plan", planOutput);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("analyze");
			expect(result.needsHumanInput).toBe(false);
		});

		it("should auto-progress analyze → tasks when analysis passes", () => {
			const result = determineAutoProgression("analyze", analyzeOutput);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("tasks");
			expect(result.needsHumanInput).toBe(false);
		});

		it("should complete pipeline after tasks phase (no nextPhase)", () => {
			const result = determineAutoProgression("tasks", tasksOutput);
			expect(result.action).toBe("spec_complete");
			expect(result.nextPhase).toBeNull();
			expect(result.needsHumanInput).toBe(false);
		});
	});

	describe("auto-progression skipped when needsHumanInput is true", () => {
		it("should pause at clarify_waiting when questions are unanswered", () => {
			// clarifyOutput fixture has CLR-002 without a response
			const result = determineAutoProgression("clarify", clarifyOutput);
			expect(result.action).toBe("wait_human");
			expect(result.needsHumanInput).toBe(true);
		});

		it("should pause when all clarifications are unanswered", () => {
			const allUnanswered: SpecOutput = {
				...clarifyOutput,
				clarifications: [
					{ id: "CLR-001", question: "Question 1?" },
					{ id: "CLR-002", question: "Question 2?" },
					{ id: "CLR-003", question: "Question 3?" },
				],
			};
			const result = determineAutoProgression("clarify", allUnanswered);
			expect(result.action).toBe("wait_human");
			expect(result.needsHumanInput).toBe(true);
		});

		it("should pause when even one clarification is unanswered", () => {
			const oneUnanswered: SpecOutput = {
				...clarifyOutput,
				clarifications: [
					{
						id: "CLR-001",
						question: "Q1?",
						response: "A1",
						respondedAt: new Date().toISOString(),
					},
					{
						id: "CLR-002",
						question: "Q2?",
						response: "A2",
						respondedAt: new Date().toISOString(),
					},
					{ id: "CLR-003", question: "Q3?" }, // unanswered
				],
			};
			const result = determineAutoProgression("clarify", oneUnanswered);
			expect(result.action).toBe("wait_human");
			expect(result.needsHumanInput).toBe(true);
		});

		it("should NOT pause when clarifications array is empty", () => {
			const noClarifications: SpecOutput = {
				...specifyOutput,
				phase: "clarify",
				clarifications: [],
			};
			const result = determineAutoProgression("clarify", noClarifications);
			expect(result.action).toBe("auto_progress");
			expect(result.needsHumanInput).toBe(false);
			expect(result.nextPhase).toBe("plan");
		});
	});

	describe("auto-progression skipped when analyze fails", () => {
		it("should set nextPhase to null when analysis fails", () => {
			const failedAnalysis: SpecOutput = {
				...analyzeOutput,
				analysis: {
					passed: false,
					issues: ["Critical issue: missing error handling"],
					suggestions: analyzeOutput.analysis?.suggestions ?? [],
					existingPatterns: analyzeOutput.analysis?.existingPatterns ?? [],
				},
			};
			const result = determineAutoProgression("analyze", failedAnalysis);
			expect(result.action).toBe("analyze_failed");
			expect(result.nextPhase).toBeNull();
			expect(result.needsHumanInput).toBe(false);
		});

		it("should proceed when analysis passes", () => {
			const passedAnalysis: SpecOutput = {
				...analyzeOutput,
				analysis: {
					passed: true,
					issues: [],
					suggestions: [],
					existingPatterns: [],
				},
			};
			const result = determineAutoProgression("analyze", passedAnalysis);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("tasks");
		});

		it("should handle analysis with issues but still passing", () => {
			const passedWithIssues: SpecOutput = {
				...analyzeOutput,
				analysis: {
					passed: true,
					issues: ["Minor: consider adding logging"],
					suggestions: ["Use structured logging"],
					existingPatterns: ["Winston logger in src/utils/"],
				},
			};
			const result = determineAutoProgression("analyze", passedWithIssues);
			expect(result.action).toBe("auto_progress");
			expect(result.nextPhase).toBe("tasks");
		});
	});

	describe("full pipeline flow simulation", () => {
		it("should auto-progress through entire pipeline without human stops", () => {
			const phases: SpecPhase[] = [
				"constitution",
				"specify",
				"clarify",
				"plan",
				"analyze",
				"tasks",
			];
			const outputs: Record<SpecPhase, SpecOutput> = {
				constitution: constitutionOutput,
				specify: specifyOutput,
				// All clarifications answered for auto-progression
				clarify: {
					...clarifyOutput,
					clarifications: clarifyOutput.clarifications?.map((c) => ({
						...c,
						response: c.response || "Answered",
						respondedAt: c.respondedAt || new Date().toISOString(),
					})),
				},
				plan: planOutput,
				analyze: analyzeOutput, // passes
				tasks: tasksOutput,
			};

			const visitedPhases: SpecPhase[] = [];
			let currentPhase: SpecPhase | null = "constitution";

			while (currentPhase) {
				visitedPhases.push(currentPhase);
				const result = determineAutoProgression(
					currentPhase,
					outputs[currentPhase],
				);

				if (result.action !== "auto_progress") {
					break;
				}
				currentPhase = result.nextPhase;
			}

			expect(visitedPhases).toEqual(phases);
		});

		it("should stop at clarify when questions need answers", () => {
			const visitedPhases: SpecPhase[] = [];
			let currentPhase: SpecPhase | null = "constitution";

			const outputs: Record<string, SpecOutput> = {
				constitution: constitutionOutput,
				specify: specifyOutput,
				clarify: clarifyOutput, // has unanswered questions
			};

			while (currentPhase) {
				visitedPhases.push(currentPhase);
				const result = determineAutoProgression(
					currentPhase,
					outputs[currentPhase],
				);

				if (result.action !== "auto_progress") {
					expect(result.action).toBe("wait_human");
					break;
				}
				currentPhase = result.nextPhase;
			}

			expect(visitedPhases).toEqual(["constitution", "specify", "clarify"]);
		});

		it("should stop at analyze when quality gate fails", () => {
			const failedAnalyzeOutput: SpecOutput = {
				...analyzeOutput,
				analysis: {
					passed: false,
					issues: ["Major: missing auth middleware"],
					suggestions: analyzeOutput.analysis?.suggestions ?? [],
					existingPatterns: analyzeOutput.analysis?.existingPatterns ?? [],
				},
			};

			const visitedPhases: SpecPhase[] = [];
			let currentPhase: SpecPhase | null = "constitution";

			const outputs: Record<string, SpecOutput> = {
				constitution: constitutionOutput,
				specify: specifyOutput,
				clarify: {
					...clarifyOutput,
					clarifications: clarifyOutput.clarifications?.map((c) => ({
						...c,
						response: c.response || "Answered",
						respondedAt: c.respondedAt || new Date().toISOString(),
					})),
				},
				plan: planOutput,
				analyze: failedAnalyzeOutput,
			};

			while (currentPhase) {
				visitedPhases.push(currentPhase);
				const result = determineAutoProgression(
					currentPhase,
					outputs[currentPhase],
				);

				if (result.action !== "auto_progress") {
					expect(result.action).toBe("analyze_failed");
					break;
				}
				currentPhase = result.nextPhase;
			}

			expect(visitedPhases).toEqual([
				"constitution",
				"specify",
				"clarify",
				"plan",
				"analyze",
			]);
		});
	});
});

describe("Clarification Endpoint Auto-Trigger (index.ts)", () => {
	describe("creates plan job when remainingQuestions === 0", () => {
		it("should auto-progress to plan when last question is answered", () => {
			const result = determineClarificationAutoTrigger(0);
			expect(result.shouldAutoProgress).toBe(true);
			expect(result.autoProgressedTo).toBe("plan");
		});
	});

	describe("does NOT create job when questions remain", () => {
		it("should not auto-progress when 1 question remains", () => {
			const result = determineClarificationAutoTrigger(1);
			expect(result.shouldAutoProgress).toBe(false);
			expect(result.autoProgressedTo).toBeNull();
		});

		it("should not auto-progress when multiple questions remain", () => {
			const result = determineClarificationAutoTrigger(5);
			expect(result.shouldAutoProgress).toBe(false);
			expect(result.autoProgressedTo).toBeNull();
		});
	});

	describe("clarification tracking simulation", () => {
		it("should track remaining questions as they are answered", () => {
			const clarifications = [
				{ id: "CLR-001", question: "Q1?" },
				{ id: "CLR-002", question: "Q2?" },
				{ id: "CLR-003", question: "Q3?" },
			];

			// Answer first question
			clarifications[0] = {
				...clarifications[0],
				...{ response: "A1", respondedAt: new Date().toISOString() },
			};
			let remaining = clarifications.filter(
				(c) => !("response" in c && c.response),
			).length;
			let trigger = determineClarificationAutoTrigger(remaining);
			expect(trigger.shouldAutoProgress).toBe(false);
			expect(remaining).toBe(2);

			// Answer second question
			clarifications[1] = {
				...clarifications[1],
				...{ response: "A2", respondedAt: new Date().toISOString() },
			};
			remaining = clarifications.filter(
				(c) => !("response" in c && c.response),
			).length;
			trigger = determineClarificationAutoTrigger(remaining);
			expect(trigger.shouldAutoProgress).toBe(false);
			expect(remaining).toBe(1);

			// Answer last question — should trigger auto-progress
			clarifications[2] = {
				...clarifications[2],
				...{ response: "A3", respondedAt: new Date().toISOString() },
			};
			remaining = clarifications.filter(
				(c) => !("response" in c && c.response),
			).length;
			trigger = determineClarificationAutoTrigger(remaining);
			expect(trigger.shouldAutoProgress).toBe(true);
			expect(trigger.autoProgressedTo).toBe("plan");
			expect(remaining).toBe(0);
		});
	});
});
