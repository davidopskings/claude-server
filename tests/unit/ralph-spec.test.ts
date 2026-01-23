/**
 * Unit tests for Spec-Kit Ralph job runner
 * Tests task selection, dependency resolution, and prompt building
 */

import { describe, expect, it } from "bun:test";
import type { SpecOutput } from "../../src/db/types.js";

// Type for spec tasks
type SpecTask = NonNullable<SpecOutput["tasks"]>[number];

describe("Spec Task Selection", () => {
	// Replicate the getNextSpecTask logic for testing
	function getNextSpecTask(
		tasks: SpecTask[] | undefined,
		completedIds: number[],
	): SpecTask | null {
		if (!tasks) return null;
		return (
			tasks.find(
				(t) =>
					!completedIds.includes(t.id) &&
					t.dependencies.every((d) => completedIds.includes(d)),
			) || null
		);
	}

	const sampleTasks: SpecTask[] = [
		{
			id: 1,
			title: "Setup database schema",
			description: "Create initial tables",
			files: ["src/db/schema.ts"],
			dependencies: [],
		},
		{
			id: 2,
			title: "Create API routes",
			description: "RESTful endpoints",
			files: ["src/api/routes.ts"],
			dependencies: [1], // depends on task 1
		},
		{
			id: 3,
			title: "Add authentication",
			description: "JWT auth middleware",
			files: ["src/auth/middleware.ts"],
			dependencies: [1], // depends on task 1
		},
		{
			id: 4,
			title: "Create frontend forms",
			description: "Login/signup forms",
			files: ["src/components/AuthForm.tsx"],
			dependencies: [2, 3], // depends on tasks 2 AND 3
		},
	];

	describe("dependency resolution", () => {
		it("should return first task with no dependencies when nothing completed", () => {
			const next = getNextSpecTask(sampleTasks, []);
			expect(next?.id).toBe(1);
		});

		it("should return task when all dependencies are completed", () => {
			const next = getNextSpecTask(sampleTasks, [1]);
			// Either task 2 or 3 could be next (both depend only on 1)
			expect([2, 3]).toContain(next?.id);
		});

		it("should not return task with unmet dependencies", () => {
			// Task 4 depends on 2 AND 3
			const next = getNextSpecTask(sampleTasks, [1, 2]);
			expect(next?.id).toBe(3); // Task 3 should be next, not 4
		});

		it("should return task 4 when all its dependencies are met", () => {
			const next = getNextSpecTask(sampleTasks, [1, 2, 3]);
			expect(next?.id).toBe(4);
		});

		it("should return null when all tasks are completed", () => {
			const next = getNextSpecTask(sampleTasks, [1, 2, 3, 4]);
			expect(next).toBeNull();
		});

		it("should return null for undefined tasks", () => {
			const next = getNextSpecTask(undefined, []);
			expect(next).toBeNull();
		});

		it("should return null for empty tasks array", () => {
			const next = getNextSpecTask([], []);
			expect(next).toBeNull();
		});
	});

	describe("parallel task eligibility", () => {
		it("should identify tasks that can run in parallel", () => {
			// After task 1 is done, both task 2 and 3 are eligible
			const completed = [1];
			const eligible = sampleTasks.filter(
				(t) =>
					!completed.includes(t.id) &&
					t.dependencies.every((d) => completed.includes(d)),
			);
			expect(eligible).toHaveLength(2);
			expect(eligible.map((t) => t.id)).toContain(2);
			expect(eligible.map((t) => t.id)).toContain(3);
		});

		it("should block tasks with partial dependencies", () => {
			// Task 4 needs both 2 and 3, but only 2 is done
			const completed = [1, 2];
			const task4 = sampleTasks.find((t) => t.id === 4);
			const canStart = task4?.dependencies.every((d) => completed.includes(d));
			expect(canStart).toBe(false);
		});
	});
});

describe("Queue Routing for Spec Mode", () => {
	// Replicate the queue routing logic
	function getRunnerForJob(job: {
		job_type: string;
		prd_mode?: boolean;
		spec_output?: { specMode?: boolean } | null;
	}): string {
		if (job.job_type === "spec") {
			return "runSpecJob";
		}
		if (job.job_type === "ralph") {
			const specOutput = job.spec_output as { specMode?: boolean } | null;
			if (specOutput?.specMode) {
				return "runRalphSpecJob";
			}
			if (job.prd_mode) {
				return "runRalphPrdJob";
			}
			return "runRalphJob";
		}
		return "runJob";
	}

	describe("spec_mode routing", () => {
		it("should route ralph with specMode to runRalphSpecJob", () => {
			const runner = getRunnerForJob({
				job_type: "ralph",
				spec_output: { specMode: true },
			});
			expect(runner).toBe("runRalphSpecJob");
		});

		it("should route ralph with prd_mode to runRalphPrdJob", () => {
			const runner = getRunnerForJob({
				job_type: "ralph",
				prd_mode: true,
			});
			expect(runner).toBe("runRalphPrdJob");
		});

		it("should route plain ralph to runRalphJob", () => {
			const runner = getRunnerForJob({
				job_type: "ralph",
			});
			expect(runner).toBe("runRalphJob");
		});

		it("should prioritize specMode over prd_mode", () => {
			// If both are set (shouldn't happen, but test precedence)
			const runner = getRunnerForJob({
				job_type: "ralph",
				prd_mode: true,
				spec_output: { specMode: true },
			});
			expect(runner).toBe("runRalphSpecJob");
		});

		it("should not affect spec job routing", () => {
			const runner = getRunnerForJob({
				job_type: "spec",
				spec_output: { specMode: true },
			});
			expect(runner).toBe("runSpecJob");
		});

		it("should handle null spec_output", () => {
			const runner = getRunnerForJob({
				job_type: "ralph",
				spec_output: null,
			});
			expect(runner).toBe("runRalphJob");
		});
	});
});

describe("Spec Task State Tracking", () => {
	interface SpecTaskState {
		id: number;
		title: string;
		completed: boolean;
	}

	function createTaskState(tasks: SpecTask[]): SpecTaskState[] {
		return tasks.map((t) => ({
			id: t.id,
			title: t.title,
			completed: false,
		}));
	}

	function markTaskComplete(
		state: SpecTaskState[],
		taskId: number,
	): SpecTaskState[] {
		return state.map((t) => (t.id === taskId ? { ...t, completed: true } : t));
	}

	function getCompletedIds(state: SpecTaskState[]): number[] {
		return state.filter((t) => t.completed).map((t) => t.id);
	}

	const sampleTasks: SpecTask[] = [
		{ id: 1, title: "Task 1", description: "", files: [], dependencies: [] },
		{ id: 2, title: "Task 2", description: "", files: [], dependencies: [1] },
		{ id: 3, title: "Task 3", description: "", files: [], dependencies: [2] },
	];

	it("should initialize all tasks as not completed", () => {
		const state = createTaskState(sampleTasks);
		expect(getCompletedIds(state)).toEqual([]);
	});

	it("should track completed tasks", () => {
		let state = createTaskState(sampleTasks);
		state = markTaskComplete(state, 1);
		expect(getCompletedIds(state)).toEqual([1]);

		state = markTaskComplete(state, 2);
		expect(getCompletedIds(state)).toEqual([1, 2]);
	});

	it("should preserve task titles", () => {
		const state = createTaskState(sampleTasks);
		expect(state[0].title).toBe("Task 1");
		expect(state[1].title).toBe("Task 2");
	});
});

describe("Spec Iteration Prompt Context", () => {
	// Test that spec prompt includes all required sections
	interface SpecPromptContext {
		constitution?: string;
		spec?: { overview?: string; requirements?: string[] };
		clarifications?: Array<{ question: string; response?: string }>;
		plan?: { architecture?: string; techDecisions?: string[] };
		tasks?: SpecTask[];
	}

	function hasRequiredSections(context: SpecPromptContext): {
		hasConstitution: boolean;
		hasSpec: boolean;
		hasClarifications: boolean;
		hasPlan: boolean;
		hasTasks: boolean;
	} {
		return {
			hasConstitution: Boolean(context.constitution),
			hasSpec: Boolean(context.spec?.overview),
			hasClarifications:
				context.clarifications?.some((c) => c.response) ?? false,
			hasPlan: Boolean(context.plan?.architecture),
			hasTasks: (context.tasks?.length ?? 0) > 0,
		};
	}

	it("should identify complete spec output", () => {
		const complete: SpecPromptContext = {
			constitution: "# Standards",
			spec: { overview: "Feature overview", requirements: ["REQ-001"] },
			clarifications: [{ question: "Q?", response: "A" }],
			plan: { architecture: "Microservices", techDecisions: ["Use Redis"] },
			tasks: [
				{ id: 1, title: "Task", description: "", files: [], dependencies: [] },
			],
		};

		const sections = hasRequiredSections(complete);
		expect(sections.hasConstitution).toBe(true);
		expect(sections.hasSpec).toBe(true);
		expect(sections.hasClarifications).toBe(true);
		expect(sections.hasPlan).toBe(true);
		expect(sections.hasTasks).toBe(true);
	});

	it("should identify missing sections", () => {
		const partial: SpecPromptContext = {
			constitution: "# Standards",
			spec: { overview: "Feature" },
			// No clarifications, plan, or tasks
		};

		const sections = hasRequiredSections(partial);
		expect(sections.hasConstitution).toBe(true);
		expect(sections.hasSpec).toBe(true);
		expect(sections.hasClarifications).toBe(false);
		expect(sections.hasPlan).toBe(false);
		expect(sections.hasTasks).toBe(false);
	});

	it("should handle unanswered clarifications", () => {
		const withUnanswered: SpecPromptContext = {
			clarifications: [
				{ question: "Q1?" }, // No response
				{ question: "Q2?", response: "" }, // Empty response
			],
		};

		const sections = hasRequiredSections(withUnanswered);
		expect(sections.hasClarifications).toBe(false);
	});
});

describe("Task Completion Token Detection", () => {
	function detectTaskCompletion(output: string, taskId: number): boolean {
		return output.includes(`<task-complete>${taskId}</task-complete>`);
	}

	it("should detect task completion token", () => {
		const output =
			"Task implemented successfully.\n<task-complete>1</task-complete>";
		expect(detectTaskCompletion(output, 1)).toBe(true);
	});

	it("should not detect wrong task ID", () => {
		const output = "<task-complete>2</task-complete>";
		expect(detectTaskCompletion(output, 1)).toBe(false);
	});

	it("should not detect partial tokens", () => {
		const output = "<task-complete>1";
		expect(detectTaskCompletion(output, 1)).toBe(false);
	});

	it("should detect token in longer output", () => {
		const output = `
## Implementation

Added authentication middleware.

## Files Changed
- src/auth/middleware.ts
- src/api/routes.ts

<task-complete>3</task-complete>
`;
		expect(detectTaskCompletion(output, 3)).toBe(true);
	});
});
