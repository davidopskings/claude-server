/**
 * Unit tests for spec/phases.ts
 * Tests phase metadata, transitions, and prompt builders
 */

import { describe, expect, it } from "bun:test";
import type { SpecPhase } from "../../../src/db/types.js";
import {
	buildAnalyzePrompt,
	buildClarifyPrompt,
	buildConstitutionPrompt,
	buildPlanPrompt,
	buildSpecifyPrompt,
	buildTasksPrompt,
	getNextPhase,
	getPhasePromptBuilder,
	type PhasePromptContext,
	phaseRequiresHumanInput,
	SPEC_PHASES,
} from "../../../src/spec/phases.js";

// Sample context for testing prompts
const sampleContext: PhasePromptContext = {
	featureTitle: "Add user authentication",
	featureDescription: "Implement login and signup",
	clientName: "Test Client",
	repoName: "test-repo",
	techStack: "TypeScript, React, Node.js",
};

const contextWithPriorPhases: PhasePromptContext = {
	...sampleContext,
	existingConstitution: "# Standards\n- Use TypeScript strict mode",
	existingSpec: '{"overview": "Auth feature", "requirements": []}',
	existingPlan: '{"architecture": "JWT-based auth"}',
	clarificationResponses: [
		{ question: "Min password length?", answer: "8 characters" },
	],
	relevantMemories: "Previous auth implementations used bcrypt for hashing",
};

describe("SPEC_PHASES metadata", () => {
	it("should have all 6 phases defined", () => {
		const phases: SpecPhase[] = [
			"constitution",
			"specify",
			"clarify",
			"plan",
			"analyze",
			"tasks",
		];
		for (const phase of phases) {
			expect(SPEC_PHASES[phase]).toBeDefined();
		}
	});

	it("should have correct phase order (1-6)", () => {
		expect(SPEC_PHASES.constitution.order).toBe(1);
		expect(SPEC_PHASES.specify.order).toBe(2);
		expect(SPEC_PHASES.clarify.order).toBe(3);
		expect(SPEC_PHASES.plan.order).toBe(4);
		expect(SPEC_PHASES.analyze.order).toBe(5);
		expect(SPEC_PHASES.tasks.order).toBe(6);
	});

	it("should have correct next phase transitions", () => {
		expect(SPEC_PHASES.constitution.nextPhase).toBe("specify");
		expect(SPEC_PHASES.specify.nextPhase).toBe("clarify");
		expect(SPEC_PHASES.clarify.nextPhase).toBe("plan");
		expect(SPEC_PHASES.plan.nextPhase).toBe("analyze");
		expect(SPEC_PHASES.analyze.nextPhase).toBe("tasks");
		expect(SPEC_PHASES.tasks.nextPhase).toBeNull();
	});

	it("should mark only clarify as requiring human input", () => {
		expect(SPEC_PHASES.constitution.requiresHumanInput).toBe(false);
		expect(SPEC_PHASES.specify.requiresHumanInput).toBe(false);
		expect(SPEC_PHASES.clarify.requiresHumanInput).toBe(true);
		expect(SPEC_PHASES.plan.requiresHumanInput).toBe(false);
		expect(SPEC_PHASES.analyze.requiresHumanInput).toBe(false);
		expect(SPEC_PHASES.tasks.requiresHumanInput).toBe(false);
	});

	it("should have name and description for each phase", () => {
		for (const phase of Object.values(SPEC_PHASES)) {
			expect(phase.name).toBeTruthy();
			expect(phase.description).toBeTruthy();
		}
	});
});

describe("getNextPhase", () => {
	it("should return correct next phase for each phase", () => {
		expect(getNextPhase("constitution")).toBe("specify");
		expect(getNextPhase("specify")).toBe("clarify");
		expect(getNextPhase("clarify")).toBe("plan");
		expect(getNextPhase("plan")).toBe("analyze");
		expect(getNextPhase("analyze")).toBe("tasks");
	});

	it("should return null for tasks (final phase)", () => {
		expect(getNextPhase("tasks")).toBeNull();
	});
});

describe("phaseRequiresHumanInput", () => {
	it("should return true only for clarify phase", () => {
		expect(phaseRequiresHumanInput("constitution")).toBe(false);
		expect(phaseRequiresHumanInput("specify")).toBe(false);
		expect(phaseRequiresHumanInput("clarify")).toBe(true);
		expect(phaseRequiresHumanInput("plan")).toBe(false);
		expect(phaseRequiresHumanInput("analyze")).toBe(false);
		expect(phaseRequiresHumanInput("tasks")).toBe(false);
	});
});

describe("buildConstitutionPrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).toContain("Phase 1: Constitution");
	});

	it("should include context variables", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).toContain(sampleContext.clientName);
		expect(prompt).toContain(sampleContext.repoName);
		expect(prompt).toContain(sampleContext.featureTitle);
	});

	it("should include key sections to analyze", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).toContain("Code Style");
		expect(prompt).toContain("Architecture Patterns");
		expect(prompt).toContain("Testing Conventions");
		expect(prompt).toContain("Tech Stack");
	});

	it("should enforce TDD in testing conventions", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).toContain("Test-Driven Development");
		expect(prompt).toContain(
			"writing tests before or alongside implementation",
		);
	});

	it("should specify JSON output format", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).toContain("```json");
		expect(prompt).toContain('"constitution"');
		expect(prompt).toContain('"techStack"');
	});

	it("should include relevant memories when provided", () => {
		const prompt = buildConstitutionPrompt(contextWithPriorPhases);
		expect(prompt).toContain("Learnings from Previous Work");
		expect(prompt).toContain("bcrypt");
	});

	it("should not include memories section when not provided", () => {
		const prompt = buildConstitutionPrompt(sampleContext);
		expect(prompt).not.toContain("Learnings from Previous Work");
	});

	it("should include UI regression testing section for cosmetic features", () => {
		const cosmeticContext: PhasePromptContext = {
			...sampleContext,
			featureTypeId: "acd9cd67-b58f-4cdf-b588-b386d812f69c",
		};
		const prompt = buildConstitutionPrompt(cosmeticContext);
		expect(prompt).toContain("UI & Regression Testing Standards");
		expect(prompt).toContain("Playwright");
		expect(prompt).toContain("cosmetic/UI feature");
		expect(prompt).toContain("Feature Type: Cosmetic/UI Change");
	});

	it("should not include UI regression section for non-cosmetic features", () => {
		const nonCosmeticContext: PhasePromptContext = {
			...sampleContext,
			featureTypeId: "0a083f70-3839-4ae4-af69-067c29ac29f5",
		};
		const prompt = buildConstitutionPrompt(nonCosmeticContext);
		expect(prompt).not.toContain("UI & Regression Testing Standards");
		expect(prompt).not.toContain("Feature Type: Cosmetic/UI Change");
	});

	it("should not include UI regression section when featureTypeId is null", () => {
		const noTypeContext: PhasePromptContext = {
			...sampleContext,
			featureTypeId: null,
		};
		const prompt = buildConstitutionPrompt(noTypeContext);
		expect(prompt).not.toContain("UI & Regression Testing Standards");
	});
});

describe("buildSpecifyPrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildSpecifyPrompt(sampleContext);
		expect(prompt).toContain("Phase 2: Specify");
	});

	it("should include requirement structure", () => {
		const prompt = buildSpecifyPrompt(sampleContext);
		expect(prompt).toContain("Functional Requirements");
		expect(prompt).toContain("Acceptance Criteria");
		expect(prompt).toContain("Out of Scope");
		expect(prompt).toContain("Edge Cases");
	});

	it("should specify requirement ID format", () => {
		const prompt = buildSpecifyPrompt(sampleContext);
		expect(prompt).toContain("REQ-001");
	});

	it("should include constitution when provided", () => {
		const prompt = buildSpecifyPrompt(contextWithPriorPhases);
		expect(prompt).toContain("TypeScript strict mode");
	});
});

describe("buildClarifyPrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildClarifyPrompt(sampleContext);
		expect(prompt).toContain("Phase 3: Clarify");
	});

	it("should list question categories", () => {
		const prompt = buildClarifyPrompt(sampleContext);
		expect(prompt).toContain("Business Logic");
		expect(prompt).toContain("UX/Design");
		expect(prompt).toContain("Data");
		expect(prompt).toContain("Security");
	});

	it("should specify clarification ID format", () => {
		const prompt = buildClarifyPrompt(sampleContext);
		expect(prompt).toContain("CLR-001");
	});

	it("should allow for no questions scenario", () => {
		const prompt = buildClarifyPrompt(sampleContext);
		expect(prompt).toContain('"clarifications": []');
	});
});

describe("buildPlanPrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildPlanPrompt(sampleContext);
		expect(prompt).toContain("Phase 4: Plan");
	});

	it("should include planning sections", () => {
		const prompt = buildPlanPrompt(sampleContext);
		expect(prompt).toContain("Architecture Overview");
		expect(prompt).toContain("Technical Decisions");
		expect(prompt).toContain("File Structure");
		expect(prompt).toContain("Database/Schema Changes");
		expect(prompt).toContain("API Changes");
		expect(prompt).toContain("Dependencies");
	});

	it("should include clarification responses when provided", () => {
		const prompt = buildPlanPrompt(contextWithPriorPhases);
		expect(prompt).toContain("Clarification Responses");
		expect(prompt).toContain("Min password length?");
		expect(prompt).toContain("8 characters");
	});

	it("should not include clarification section when no responses", () => {
		const prompt = buildPlanPrompt(sampleContext);
		expect(prompt).not.toContain("Clarification Responses");
	});
});

describe("buildAnalyzePrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildAnalyzePrompt(sampleContext);
		expect(prompt).toContain("Phase 5: Analyze");
	});

	it("should include analysis areas", () => {
		const prompt = buildAnalyzePrompt(sampleContext);
		expect(prompt).toContain("Conflicts with Existing Code");
		expect(prompt).toContain("Missing Considerations");
		expect(prompt).toContain("Technical Risks");
		expect(prompt).toContain("Dependencies Check");
	});

	it("should specify passed flag behavior", () => {
		const prompt = buildAnalyzePrompt(sampleContext);
		expect(prompt).toContain("passed: false");
		expect(prompt).toContain("passed: true");
		expect(prompt).toContain("error");
		expect(prompt).toContain("warning");
	});
});

describe("buildTasksPrompt", () => {
	it("should include phase identifier", () => {
		const prompt = buildTasksPrompt(sampleContext);
		expect(prompt).toContain("Phase 6: Tasks");
	});

	it("should specify task properties", () => {
		const prompt = buildTasksPrompt(sampleContext);
		expect(prompt).toContain("Self-Contained");
		expect(prompt).toContain("Clear Dependencies");
		expect(prompt).toContain("Ordered Logically");
	});

	it("should include task structure in output format", () => {
		const prompt = buildTasksPrompt(sampleContext);
		expect(prompt).toContain('"tasks"');
		expect(prompt).toContain('"id"');
		expect(prompt).toContain('"title"');
		expect(prompt).toContain('"dependencies"');
		expect(prompt).toContain('"estimatePoints"');
	});

	it("should include parallelization info", () => {
		const prompt = buildTasksPrompt(sampleContext);
		expect(prompt).toContain("criticalPath");
		expect(prompt).toContain("parallelizable");
	});
});

describe("getPhasePromptBuilder", () => {
	it("should return correct builder for each phase", () => {
		expect(getPhasePromptBuilder("constitution")).toBe(buildConstitutionPrompt);
		expect(getPhasePromptBuilder("specify")).toBe(buildSpecifyPrompt);
		expect(getPhasePromptBuilder("clarify")).toBe(buildClarifyPrompt);
		expect(getPhasePromptBuilder("plan")).toBe(buildPlanPrompt);
		expect(getPhasePromptBuilder("analyze")).toBe(buildAnalyzePrompt);
		expect(getPhasePromptBuilder("tasks")).toBe(buildTasksPrompt);
	});

	it("returned builder should produce valid prompt", () => {
		for (const phase of Object.keys(SPEC_PHASES) as SpecPhase[]) {
			const builder = getPhasePromptBuilder(phase);
			const prompt = builder(sampleContext);
			expect(typeof prompt).toBe("string");
			expect(prompt.length).toBeGreaterThan(100);
		}
	});
});
