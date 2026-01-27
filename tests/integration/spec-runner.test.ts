/**
 * Integration tests for runSpecJob
 *
 * Uses mock.module() to intercept all external dependencies,
 * then tests the real runSpecJob function end-to-end.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SpecOutput, SpecPhase } from "../../src/db/types.js";
import type { JudgeResult } from "../../src/spec/judge.js";
// Fixtures
import {
	clarifyOutput,
	constitutionOutput,
	planOutput,
	specifyOutput,
} from "../fixtures/index.js";
import {
	createMockClaudeSpawn,
	setDefaultResponse,
	specPhaseResponses,
} from "../mocks/claude.js";
// Import mock modules (these provide the in-memory implementations)
import * as mockDb from "../mocks/db.js";
import * as mockGit from "../mocks/git.js";
import * as mockImprove from "../mocks/improve.js";
import { resetAllMocks } from "../mocks/index.js";
import * as mockJudge from "../mocks/judge.js";
import * as mockMemory from "../mocks/memory.js";
import * as mockObservability from "../mocks/observability.js";

// ----- Mock all module dependencies BEFORE importing runner -----

mock.module("../../src/db/index.js", () => mockDb);
mock.module("../../src/db/queries.js", () => mockDb);
mock.module("../../src/git.js", () => mockGit);
mock.module("../../src/memory/index.js", () => mockMemory);
mock.module("../../src/observability/index.js", () => mockObservability);
mock.module("../../src/spec/judge.js", () => mockJudge);
mock.module("../../src/spec/improve.js", () => mockImprove);
mock.module("node:child_process", () => ({
	spawn: createMockClaudeSpawn(),
}));

// Now import the real runner (its deps are mocked)
const { runSpecJob } = await import("../../src/spec/runner.js");

// ----- Helpers -----

function seedTestData(
	phase: SpecPhase,
	existingSpecOutput?: SpecOutput | null,
) {
	const repo = mockDb.seedRepository({
		id: "repo-test-1",
		client_id: "client-test-1",
		owner_name: "test-org",
		repo_name: "test-app",
		default_branch: "main",
		provider: "github",
		url: "https://github.com/test-org/test-app",
	});

	const feature = mockDb.seedFeature({
		id: "feature-test-1",
		client_id: "client-test-1",
		title: "Add user authentication",
		functionality_notes: "Should support email/password auth",
		spec_output: existingSpecOutput
			? (existingSpecOutput as unknown as ReturnType<
					typeof mockDb.seedFeature
				>["spec_output"])
			: null,
	});

	const job = mockDb.seedJob({
		id: "job-test-1",
		client_id: "client-test-1",
		status: "queued",
		job_type: "spec",
		branch_name: "spec/auth-feature",
		feature_id: "feature-test-1",
		repository_id: "repo-test-1",
		spec_phase: phase,
		prompt: `Run ${phase} phase`,
	});

	return { job, feature, repo };
}

function setupClaudeResponse(phase: SpecPhase) {
	setDefaultResponse(specPhaseResponses[phase]);
}

const FAILED_JUDGE: JudgeResult = {
	passed: false,
	overallScore: 40,
	criteria: [
		{
			criterion: "Error handling is comprehensive",
			passed: false,
			reasoning: "Missing error handling for API calls",
			suggestions: ["Add try-catch blocks"],
		},
	],
	summary: "Quality gate failed",
	improvements: ["Add comprehensive error handling"],
};

const PASSED_JUDGE: JudgeResult = {
	passed: true,
	overallScore: 90,
	criteria: [
		{
			criterion: "Code follows existing patterns",
			passed: true,
			reasoning: "Plan follows established patterns",
		},
	],
	summary: "Quality gate passed",
	improvements: [],
};

// ----- Tests -----

describe("runSpecJob", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	describe("Constitution phase", () => {
		it("should complete and auto-progress to specify", async () => {
			seedTestData("constitution");
			setupClaudeResponse("constitution");

			await runSpecJob("job-test-1");

			// Job should be completed
			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");
			expect(job?.exit_code).toBe(0);

			// Feature should have spec_output with constitution
			const specOutput = await mockDb.getFeatureSpecOutput("feature-test-1");
			expect(specOutput?.phase).toBe("constitution");
			expect(specOutput?.constitution).toBeDefined();

			// Should have auto-created next job for specify phase
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("specify");
			expect(creations[0].clientId).toBe("client-test-1");
			expect(creations[0].featureId).toBe("feature-test-1");

			// Should have updated workflow stages
			const stages = mockDb.getStoredWorkflowStages();
			expect(stages.some((s) => s.stageCode === "constitution_running")).toBe(
				true,
			);
			expect(stages.some((s) => s.stageCode === "constitution_complete")).toBe(
				true,
			);
		});

		it("should reuse existing client constitution", async () => {
			seedTestData("constitution");
			mockDb.seedClientConstitution(
				"client-test-1",
				"# Existing Standards\n- TypeScript strict",
				"2025-01-01T00:00:00.000Z",
			);

			await runSpecJob("job-test-1");

			// Job should be completed
			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Feature spec_output should have the existing constitution
			const specOutput = await mockDb.getFeatureSpecOutput("feature-test-1");
			expect(specOutput?.constitution).toBe(
				"# Existing Standards\n- TypeScript strict",
			);

			// Messages should indicate skipping Claude
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) =>
					m.content.includes("Skipped Claude run - using existing"),
				),
			).toBe(true);

			// Should still auto-progress to specify
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("specify");
		});
	});

	describe("Phase transitions", () => {
		it("should progress from specify to clarify", async () => {
			seedTestData("specify", constitutionOutput);
			setupClaudeResponse("specify");

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("clarify");
		});

		it("should progress from clarify to plan when no questions", async () => {
			seedTestData("clarify", specifyOutput);
			// Claude returns empty clarifications => no human input needed
			setDefaultResponse({
				stdout: JSON.stringify({ clarifications: [] }),
				stderr: "",
				exitCode: 0,
			});

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("plan");
		});

		it("should progress from plan to analyze", async () => {
			seedTestData("plan", clarifyOutput);
			setupClaudeResponse("plan");

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("analyze");
		});

		it("should progress from analyze to tasks when judge passes", async () => {
			seedTestData("analyze", planOutput);
			setupClaudeResponse("analyze");
			mockJudge.setJudgeResult(PASSED_JUDGE);

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("tasks");
		});
	});

	describe("Human input gate", () => {
		it("should pause at clarify_waiting with unanswered questions", async () => {
			seedTestData("clarify", specifyOutput);
			// Claude returns clarifications that need answers
			setDefaultResponse({
				stdout: JSON.stringify({
					clarifications: [
						{
							id: "CLR-001",
							question: "Should password have minimum requirements?",
							context: "Affects validation logic",
						},
						{
							id: "CLR-002",
							question: "Should we lock accounts after failed attempts?",
							context: "Security consideration",
						},
					],
				}),
				stderr: "",
				exitCode: 0,
			});

			await runSpecJob("job-test-1");

			// Job should still complete (this phase's job completes)
			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Should NOT create next job
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(0);

			// Should set clarify_waiting stage
			const stages = mockDb.getStoredWorkflowStages();
			expect(stages.some((s) => s.stageCode === "clarify_waiting")).toBe(true);

			// Messages should mention waiting for human input
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) => m.content.includes("needing human input")),
			).toBe(true);
		});
	});

	describe("Analyze quality gate", () => {
		it("should set analyze_failed when judge fails and improve fails", async () => {
			seedTestData("analyze", planOutput);
			setupClaudeResponse("analyze");
			mockJudge.setJudgeResult(FAILED_JUDGE);
			mockImprove.setImproveResult({
				success: false,
				improvedPlan: undefined,
				changesSummary: ["Failed to improve"],
				iteration: 0,
			});

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Should NOT create next job
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(0);

			// Should set analyze_failed stage
			const stages = mockDb.getStoredWorkflowStages();
			expect(stages.some((s) => s.stageCode === "analyze_failed")).toBe(true);

			// Messages should mention manual review
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) => m.content.includes("manual review required")),
			).toBe(true);
		});

		it("should succeed after auto-improve loop", async () => {
			seedTestData("analyze", planOutput);
			setupClaudeResponse("analyze");

			// First judge call fails, second passes
			mockJudge.setJudgeResultSequence([FAILED_JUDGE, PASSED_JUDGE]);

			// Improve returns an improved plan
			mockImprove.setImproveResult({
				success: true,
				improvedPlan: {
					architecture: "Improved architecture with error handling",
					techDecisions: ["Use JWT", "Add rate limiting"],
					fileStructure: ["src/auth/index.ts"],
				},
				changesSummary: ["Added error handling"],
				iteration: 0,
			});

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Judge should have been called twice (initial + after improve)
			const judgeCalls = mockJudge.getJudgeCalls();
			expect(judgeCalls.length).toBe(2);

			// Improve should have been called once
			const improveCalls = mockImprove.getImproveCalls();
			expect(improveCalls.length).toBe(1);

			// Should create next job since judge passed on retry
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("tasks");

			// Messages should mention auto-improve success
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) => m.content.includes("Auto-improve succeeded")),
			).toBe(true);
		});
	});

	describe("Pipeline end", () => {
		it("should set spec_complete on tasks phase with no next job", async () => {
			seedTestData("tasks", planOutput);
			setupClaudeResponse("tasks");

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Should NOT create any next job
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(0);

			// Should set tasks_complete and spec_complete stages
			const stages = mockDb.getStoredWorkflowStages();
			expect(stages.some((s) => s.stageCode === "tasks_complete")).toBe(true);
			expect(stages.some((s) => s.stageCode === "spec_complete")).toBe(true);

			// Messages should mention ready for Ralph
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) => m.content.includes("ready for implementation")),
			).toBe(true);
		});
	});

	describe("Error handling", () => {
		it("should fail when feature_id is missing", async () => {
			mockDb.seedRepository({
				id: "repo-test-1",
				client_id: "client-test-1",
			});
			mockDb.seedJob({
				id: "job-no-feature",
				client_id: "client-test-1",
				status: "queued",
				job_type: "spec",
				branch_name: "spec/no-feature",
				feature_id: null,
				spec_phase: "constitution",
				prompt: "Run constitution",
			});

			await runSpecJob("job-no-feature");

			const job = await mockDb.getJob("job-no-feature");
			expect(job?.status).toBe("failed");
			expect(job?.error).toContain("feature_id");
		});

		it("should fail when feature not found", async () => {
			mockDb.seedRepository({
				id: "repo-test-1",
				client_id: "client-test-1",
			});
			mockDb.seedJob({
				id: "job-missing-feature",
				client_id: "client-test-1",
				status: "queued",
				job_type: "spec",
				branch_name: "spec/missing",
				feature_id: "nonexistent-feature",
				spec_phase: "constitution",
				prompt: "Run constitution",
			});

			await runSpecJob("job-missing-feature");

			const job = await mockDb.getJob("job-missing-feature");
			expect(job?.status).toBe("failed");
			expect(job?.error).toContain("Feature not found");
		});

		it("should fail when repository not found", async () => {
			// No repository seeded
			mockDb.seedFeature({
				id: "feature-test-1",
				client_id: "client-test-1",
				title: "Test Feature",
			});
			mockDb.seedJob({
				id: "job-no-repo",
				client_id: "client-test-1",
				status: "queued",
				job_type: "spec",
				branch_name: "spec/no-repo",
				feature_id: "feature-test-1",
				spec_phase: "constitution",
				prompt: "Run constitution",
			});

			await runSpecJob("job-no-repo");

			const job = await mockDb.getJob("job-no-repo");
			expect(job?.status).toBe("failed");
			expect(job?.error).toContain("No repository found");
		});

		it("should fail when Claude exits with non-zero code", async () => {
			seedTestData("constitution");
			setDefaultResponse({
				stdout: "",
				stderr: "Claude process crashed",
				exitCode: 1,
			});

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("failed");
			expect(job?.error).toContain("Claude process crashed");
		});

		it("should fail when Claude output is unparseable JSON", async () => {
			seedTestData("constitution");
			setDefaultResponse({
				stdout: "This is not JSON at all, just plain text output",
				stderr: "",
				exitCode: 0,
			});

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("failed");
			expect(job?.error).toContain("Spec phase constitution failed");
		});

		it("should throw when job not found", async () => {
			await expect(runSpecJob("nonexistent-job")).rejects.toThrow(
				"Job not found",
			);
		});
	});

	describe("Memory integration", () => {
		it("should recall memories and include in messages", async () => {
			seedTestData("constitution");
			setupClaudeResponse("constitution");

			// Set up mock memories
			mockMemory.setMockMemories([
				mockMemory.createMockMemory({
					key: "auth_pattern",
					value: { pattern: "Use JWT for auth" },
					memoryType: "pattern",
				}),
			]);

			await runSpecJob("job-test-1");

			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Messages should mention recalled memories
			const messages = mockDb.getStoredMessages();
			expect(
				messages.some((m) => m.content.includes("Recalled 1 relevant")),
			).toBe(true);
		});

		it("should learn from completed phase", async () => {
			seedTestData("constitution");
			setupClaudeResponse("constitution");

			await runSpecJob("job-test-1");

			// Should have called learnFromSpecPhase
			const learnCalls = mockMemory.getLearnCalls();
			expect(learnCalls.length).toBeGreaterThan(0);
			expect(learnCalls[0].phase).toBe("constitution");
			expect(learnCalls[0].clientId).toBe("client-test-1");
		});

		it("should continue when memory recall fails", async () => {
			seedTestData("constitution");
			setupClaudeResponse("constitution");
			mockMemory.setRecallError(new Error("Database connection failed"));

			await runSpecJob("job-test-1");

			// Job should still complete despite memory failure
			const job = await mockDb.getJob("job-test-1");
			expect(job?.status).toBe("completed");

			// Should still auto-progress
			const creations = mockDb.getSpecJobCreations();
			expect(creations).toHaveLength(1);
			expect(creations[0].specPhase).toBe("specify");
		});
	});
});
