/**
 * Integration tests for submitClarification and allClarificationsAnswered
 *
 * Uses mock.module() to intercept DB dependencies,
 * then tests the real functions from spec/runner.ts.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SpecOutput } from "../../src/db/types.js";
import { createMockClaudeSpawn } from "../mocks/claude.js";
// Import mock modules
import * as mockDb from "../mocks/db.js";
import * as mockGit from "../mocks/git.js";
import * as mockImprove from "../mocks/improve.js";
import { resetAllMocks } from "../mocks/index.js";
import * as mockJudge from "../mocks/judge.js";
import * as mockMemory from "../mocks/memory.js";
import * as mockObservability from "../mocks/observability.js";

// ----- Mock all module dependencies -----

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

// Import real functions
const { submitClarification, allClarificationsAnswered } = await import(
	"../../src/spec/runner.js"
);

// ----- Helpers -----

function seedFeatureWithClarifications(
	clarifications: SpecOutput["clarifications"],
) {
	const specOutput: SpecOutput = {
		phase: "clarify",
		constitution: "# Standards",
		spec: {
			overview: "Test feature",
			requirements: ["REQ-001"],
			acceptanceCriteria: ["AC-001"],
		},
		clarifications,
	};

	mockDb.seedFeature({
		id: "feature-clr-1",
		client_id: "client-test-1",
		title: "Feature with clarifications",
		spec_output: specOutput as unknown as ReturnType<
			typeof mockDb.seedFeature
		>["spec_output"],
	});

	return specOutput;
}

// ----- Tests -----

describe("submitClarification", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should update clarification response in spec_output", async () => {
		seedFeatureWithClarifications([
			{ id: "CLR-001", question: "Question one?", context: "Context" },
			{ id: "CLR-002", question: "Question two?", context: "Context" },
		]);

		const result = await submitClarification(
			"feature-clr-1",
			"CLR-001",
			"Answer to question one",
		);

		expect(result.success).toBe(true);

		// Verify the spec_output was updated
		const output = await mockDb.getFeatureSpecOutput("feature-clr-1");
		const clr = output?.clarifications?.find((c) => c.id === "CLR-001");
		expect(clr?.response).toBe("Answer to question one");
		expect(clr?.respondedAt).toBeDefined();
	});

	it("should return correct remainingQuestions count", async () => {
		seedFeatureWithClarifications([
			{ id: "CLR-001", question: "Q1?", context: "C1" },
			{ id: "CLR-002", question: "Q2?", context: "C2" },
			{ id: "CLR-003", question: "Q3?", context: "C3" },
		]);

		const result = await submitClarification(
			"feature-clr-1",
			"CLR-001",
			"Answer 1",
		);
		expect(result.remainingQuestions).toBe(2);
	});

	it("should return 0 remaining when last question answered", async () => {
		seedFeatureWithClarifications([
			{
				id: "CLR-001",
				question: "Q1?",
				context: "C1",
				response: "Already answered",
				respondedAt: "2025-01-01T00:00:00.000Z",
			},
			{ id: "CLR-002", question: "Q2?", context: "C2" },
		]);

		const result = await submitClarification(
			"feature-clr-1",
			"CLR-002",
			"Last answer",
		);
		expect(result.remainingQuestions).toBe(0);
	});

	it("should throw when no clarifications exist", async () => {
		// Feature with no spec_output at all
		mockDb.seedFeature({
			id: "feature-no-spec",
			client_id: "client-test-1",
			title: "No spec output",
		});

		await expect(
			submitClarification("feature-no-spec", "CLR-001", "Answer"),
		).rejects.toThrow("No clarifications found");
	});

	it("should throw when clarification ID not found", async () => {
		seedFeatureWithClarifications([
			{ id: "CLR-001", question: "Q1?", context: "C1" },
		]);

		await expect(
			submitClarification("feature-clr-1", "CLR-999", "Answer"),
		).rejects.toThrow("CLR-999 not found");
	});
});

describe("allClarificationsAnswered", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should return true when all clarifications have responses", async () => {
		seedFeatureWithClarifications([
			{
				id: "CLR-001",
				question: "Q1?",
				context: "C1",
				response: "A1",
				respondedAt: "2025-01-01T00:00:00.000Z",
			},
			{
				id: "CLR-002",
				question: "Q2?",
				context: "C2",
				response: "A2",
				respondedAt: "2025-01-01T00:00:00.000Z",
			},
		]);

		const result = await allClarificationsAnswered("feature-clr-1");
		expect(result).toBe(true);
	});

	it("should return false when unanswered clarifications remain", async () => {
		seedFeatureWithClarifications([
			{
				id: "CLR-001",
				question: "Q1?",
				context: "C1",
				response: "A1",
				respondedAt: "2025-01-01T00:00:00.000Z",
			},
			{ id: "CLR-002", question: "Q2?", context: "C2" },
		]);

		const result = await allClarificationsAnswered("feature-clr-1");
		expect(result).toBe(false);
	});

	it("should return true when no clarifications exist", async () => {
		// Feature with spec_output but no clarifications
		const specOutput: SpecOutput = {
			phase: "specify",
			constitution: "# Standards",
		};
		mockDb.seedFeature({
			id: "feature-no-clr",
			client_id: "client-test-1",
			title: "No clarifications",
			spec_output: specOutput as unknown as ReturnType<
				typeof mockDb.seedFeature
			>["spec_output"],
		});

		const result = await allClarificationsAnswered("feature-no-clr");
		expect(result).toBe(true);
	});
});
