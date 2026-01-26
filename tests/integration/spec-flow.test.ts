/**
 * Integration tests for Spec-Kit flow
 * Tests phase transitions and data flow through the spec pipeline
 */

import { describe, expect, it } from "bun:test";
import type { SpecOutput, SpecPhase } from "../../src/db/types.js";
import {
	getNextPhase,
	phaseRequiresHumanInput,
	SPEC_PHASES,
} from "../../src/spec/phases.js";
import {
	analyzeOutput,
	clarifyOutput,
	constitutionOutput,
	planOutput,
	specifyOutput,
	tasksOutput,
} from "../fixtures/index.js";

describe("Spec-Kit Phase Flow", () => {
	describe("Phase Progression", () => {
		it("should progress through all phases in order", () => {
			const phases: SpecPhase[] = [];
			let currentPhase: SpecPhase | null = "constitution";

			while (currentPhase) {
				phases.push(currentPhase);
				currentPhase = getNextPhase(currentPhase);
			}

			expect(phases).toEqual([
				"constitution",
				"specify",
				"clarify",
				"plan",
				"analyze",
				"tasks",
			]);
		});

		it("should stop at tasks phase (no next phase)", () => {
			expect(getNextPhase("tasks")).toBeNull();
		});
	});

	describe("Human Input Gates", () => {
		it("should only require human input at clarify phase", () => {
			const humanInputPhases = (Object.keys(SPEC_PHASES) as SpecPhase[]).filter(
				(phase) => phaseRequiresHumanInput(phase),
			);

			expect(humanInputPhases).toEqual(["clarify"]);
		});

		it("should allow auto-progression through non-human phases", () => {
			const autoPhases = (Object.keys(SPEC_PHASES) as SpecPhase[]).filter(
				(phase) => !phaseRequiresHumanInput(phase),
			);

			expect(autoPhases).toContain("constitution");
			expect(autoPhases).toContain("specify");
			expect(autoPhases).toContain("plan");
			expect(autoPhases).toContain("analyze");
			expect(autoPhases).toContain("tasks");
		});
	});

	describe("Spec Output Accumulation", () => {
		it("should accumulate data through phases", () => {
			// Constitution only has constitution
			expect(constitutionOutput.constitution).toBeDefined();
			expect(constitutionOutput.spec).toBeUndefined();

			// Specify adds spec, keeps constitution
			expect(specifyOutput.constitution).toBeDefined();
			expect(specifyOutput.spec).toBeDefined();

			// Clarify adds clarifications
			expect(clarifyOutput.clarifications).toBeDefined();

			// Plan adds plan
			expect(planOutput.plan).toBeDefined();

			// Analyze adds analysis
			expect(analyzeOutput.analysis).toBeDefined();

			// Tasks has everything + tasks
			expect(tasksOutput.constitution).toBeDefined();
			expect(tasksOutput.spec).toBeDefined();
			expect(tasksOutput.clarifications).toBeDefined();
			expect(tasksOutput.plan).toBeDefined();
			expect(tasksOutput.analysis).toBeDefined();
			expect(tasksOutput.tasks).toBeDefined();
		});

		it("should preserve earlier phase data in later phases", () => {
			// Tasks (final phase) should have all prior data
			const finalOutput = tasksOutput;

			expect(finalOutput.constitution).toBe(constitutionOutput.constitution);
			expect(finalOutput.spec).toEqual(specifyOutput.spec);
		});
	});

	describe("Clarification Flow", () => {
		it("should generate clarifications with required fields", () => {
			const clarifications = clarifyOutput.clarifications || [];

			for (const clarification of clarifications) {
				expect(clarification.id).toBeDefined();
				expect(clarification.question).toBeDefined();
				expect(typeof clarification.id).toBe("string");
				expect(typeof clarification.question).toBe("string");
			}
		});

		it("should track answered vs unanswered clarifications", () => {
			const clarifications = clarifyOutput.clarifications || [];

			const answered = clarifications.filter((c) => c.response !== undefined);
			const unanswered = clarifications.filter((c) => c.response === undefined);

			expect(answered.length + unanswered.length).toBe(clarifications.length);
		});

		it("should allow proceeding when all clarifications are answered", () => {
			// Simulate all answered
			const allAnswered = (clarifyOutput.clarifications || []).map((c) => ({
				...c,
				response: c.response || "Sample answer",
				respondedAt: c.respondedAt || new Date().toISOString(),
			}));

			const hasUnanswered = allAnswered.some((c) => !c.response);
			expect(hasUnanswered).toBe(false);
		});
	});

	describe("Analysis Quality Gate", () => {
		it("should have passed flag in analysis", () => {
			expect(analyzeOutput.analysis?.passed).toBeDefined();
			expect(typeof analyzeOutput.analysis?.passed).toBe("boolean");
		});

		it("should allow proceeding when analysis passes", () => {
			expect(analyzeOutput.analysis?.passed).toBe(true);
		});

		it("should block when analysis fails", () => {
			if (!analyzeOutput.analysis)
				throw new Error("Test fixture missing analysis");
			const failedAnalysis: SpecOutput = {
				...analyzeOutput,
				analysis: {
					...analyzeOutput.analysis,
					passed: false,
					issues: ["Critical issue found"],
				},
			};

			expect(failedAnalysis.analysis?.passed).toBe(false);
			// In this case, the improve.ts module would be triggered
		});

		it("should include suggestions for improvement", () => {
			expect(analyzeOutput.analysis?.suggestions).toBeDefined();
			expect(Array.isArray(analyzeOutput.analysis?.suggestions)).toBe(true);
		});
	});

	describe("Tasks Generation", () => {
		it("should generate tasks with required fields", () => {
			const tasks = tasksOutput.tasks || [];

			for (const task of tasks) {
				expect(task.id).toBeDefined();
				expect(task.title).toBeDefined();
				expect(task.description).toBeDefined();
				expect(task.files).toBeDefined();
				expect(task.dependencies).toBeDefined();
				expect(typeof task.id).toBe("number");
				expect(Array.isArray(task.files)).toBe(true);
				expect(Array.isArray(task.dependencies)).toBe(true);
			}
		});

		it("should have valid dependency references", () => {
			const tasks = tasksOutput.tasks || [];
			const taskIds = tasks.map((t) => t.id);

			for (const task of tasks) {
				for (const depId of task.dependencies) {
					// Dependencies should reference earlier tasks
					expect(taskIds).toContain(depId);
					expect(depId).toBeLessThan(task.id);
				}
			}
		});

		it("should have at least one task with no dependencies (root)", () => {
			const tasks = tasksOutput.tasks || [];
			const rootTasks = tasks.filter((t) => t.dependencies.length === 0);

			expect(rootTasks.length).toBeGreaterThan(0);
		});

		it("should order tasks so dependencies come first", () => {
			const tasks = tasksOutput.tasks || [];

			for (const task of tasks) {
				for (const depId of task.dependencies) {
					const depIndex = tasks.findIndex((t) => t.id === depId);
					const taskIndex = tasks.findIndex((t) => t.id === task.id);
					expect(depIndex).toBeLessThan(taskIndex);
				}
			}
		});
	});

	describe("Phase State Machine", () => {
		// Test state transitions
		interface PhaseState {
			phase: SpecPhase;
			status: "pending" | "running" | "completed" | "waiting_input" | "failed";
		}

		function getNextState(
			current: PhaseState,
			event: "complete" | "fail" | "input_received",
		): PhaseState {
			if (event === "fail") {
				return { phase: current.phase, status: "failed" };
			}

			if (event === "complete") {
				if (phaseRequiresHumanInput(current.phase)) {
					return { phase: current.phase, status: "waiting_input" };
				}

				const nextPhase = getNextPhase(current.phase);
				if (nextPhase) {
					return { phase: nextPhase, status: "pending" };
				}
				return { phase: current.phase, status: "completed" };
			}

			if (event === "input_received" && current.status === "waiting_input") {
				const nextPhase = getNextPhase(current.phase);
				if (nextPhase) {
					return { phase: nextPhase, status: "pending" };
				}
			}

			return current;
		}

		it("should transition to waiting_input after clarify completes", () => {
			const state: PhaseState = { phase: "clarify", status: "running" };
			const nextState = getNextState(state, "complete");

			expect(nextState.phase).toBe("clarify");
			expect(nextState.status).toBe("waiting_input");
		});

		it("should transition to plan after clarify receives input", () => {
			const state: PhaseState = { phase: "clarify", status: "waiting_input" };
			const nextState = getNextState(state, "input_received");

			expect(nextState.phase).toBe("plan");
			expect(nextState.status).toBe("pending");
		});

		it("should transition to next phase after non-input phase completes", () => {
			const state: PhaseState = { phase: "constitution", status: "running" };
			const nextState = getNextState(state, "complete");

			expect(nextState.phase).toBe("specify");
			expect(nextState.status).toBe("pending");
		});

		it("should stay completed after tasks phase", () => {
			const state: PhaseState = { phase: "tasks", status: "running" };
			const nextState = getNextState(state, "complete");

			expect(nextState.phase).toBe("tasks");
			expect(nextState.status).toBe("completed");
		});

		it("should handle failures", () => {
			const state: PhaseState = { phase: "plan", status: "running" };
			const nextState = getNextState(state, "fail");

			expect(nextState.phase).toBe("plan");
			expect(nextState.status).toBe("failed");
		});
	});
});

describe("Spec Output Validation", () => {
	function validateSpecOutput(output: SpecOutput): {
		valid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];

		if (!output.phase) {
			errors.push("phase is required");
		}

		// Phase-specific validation
		if (output.phase === "tasks" && !output.tasks) {
			errors.push("tasks phase must have tasks array");
		}

		if (output.phase === "analyze" && !output.analysis) {
			errors.push("analyze phase must have analysis object");
		}

		if (output.phase === "plan" && !output.plan) {
			errors.push("plan phase must have plan object");
		}

		if (output.clarifications) {
			for (const c of output.clarifications) {
				if (!c.id || !c.question) {
					errors.push("clarifications must have id and question");
				}
			}
		}

		if (output.tasks) {
			for (const t of output.tasks) {
				if (typeof t.id !== "number") {
					errors.push("task id must be a number");
				}
				if (!t.title) {
					errors.push("task must have title");
				}
			}
		}

		return { valid: errors.length === 0, errors };
	}

	it("should validate constitution output", () => {
		const result = validateSpecOutput(constitutionOutput);
		expect(result.valid).toBe(true);
	});

	it("should validate tasks output", () => {
		const result = validateSpecOutput(tasksOutput);
		expect(result.valid).toBe(true);
	});

	it("should reject tasks phase without tasks", () => {
		const invalid: SpecOutput = { phase: "tasks" };
		const result = validateSpecOutput(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("tasks phase must have tasks array");
	});

	it("should reject analyze phase without analysis", () => {
		const invalid: SpecOutput = { phase: "analyze" };
		const result = validateSpecOutput(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("analyze phase must have analysis object");
	});
});
