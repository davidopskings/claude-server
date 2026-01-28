import type { SpecPhase } from "../db/types.js";
import { isCosmeticFeature } from "../playwright/detection.js";

// Phase order and metadata
export const SPEC_PHASES: Record<
	SpecPhase,
	{
		order: number;
		name: string;
		description: string;
		nextPhase: SpecPhase | null;
		requiresHumanInput: boolean;
	}
> = {
	constitution: {
		order: 1,
		name: "Constitution",
		description: "Load coding principles and standards for this client/repo",
		nextPhase: "specify",
		requiresHumanInput: false,
	},
	specify: {
		order: 2,
		name: "Specify",
		description: "Generate specification (WHAT and WHY)",
		nextPhase: "clarify",
		requiresHumanInput: false,
	},
	clarify: {
		order: 3,
		name: "Clarify",
		description: "Identify ambiguities and generate questions",
		nextPhase: "plan",
		requiresHumanInput: true, // Needs human to answer questions
	},
	plan: {
		order: 4,
		name: "Plan",
		description: "Generate implementation plan (HOW)",
		nextPhase: "analyze",
		requiresHumanInput: false,
	},
	analyze: {
		order: 5,
		name: "Analyze",
		description: "Validate plan against existing codebase",
		nextPhase: "tasks",
		requiresHumanInput: false, // But may loop back if issues found
	},
	tasks: {
		order: 6,
		name: "Tasks",
		description: "Break into atomic implementation tasks",
		nextPhase: null, // End of spec-kit, ready for Ralph
		requiresHumanInput: false,
	},
};

// Get next phase or null if complete
export function getNextPhase(currentPhase: SpecPhase): SpecPhase | null {
	return SPEC_PHASES[currentPhase].nextPhase;
}

// Check if phase requires human input before proceeding
export function phaseRequiresHumanInput(phase: SpecPhase): boolean {
	return SPEC_PHASES[phase].requiresHumanInput;
}

// Phase prompts
export interface PhasePromptContext {
	featureTitle: string;
	featureDescription?: string;
	featureTypeId?: string | null;
	clientName: string;
	repoName: string;
	techStack?: string;
	existingConstitution?: string;
	existingSpec?: string;
	existingPlan?: string;
	clarificationResponses?: { question: string; answer: string }[];
	// Memory layer - relevant learnings from past work
	relevantMemories?: string;
}

export function buildConstitutionPrompt(ctx: PhasePromptContext): string {
	const memoriesSection = ctx.relevantMemories
		? `\n## Learnings from Previous Work\n${ctx.relevantMemories}\n`
		: "";

	const isCosmetic = isCosmeticFeature(ctx.featureTypeId);

	const cosmeticSection = isCosmetic
		? `
6. **UI & Regression Testing Standards**
   - Existing e2e or visual regression test setup (Playwright, Cypress, etc.)
   - Component testing patterns (Storybook, Testing Library, etc.)
   - Screenshot or visual snapshot conventions
   - Responsive breakpoints and viewport sizes to test
   - Design system or component library in use
   - CSS/styling approach (CSS modules, Tailwind, styled-components, etc.)
   - Accessibility testing requirements (axe, lighthouse, etc.)

IMPORTANT: This is a **cosmetic/UI feature**. The constitution MUST include a dedicated "UI & Regression Testing" section in the output. If the codebase has no existing e2e or visual testing setup, explicitly state that Playwright should be adopted with:
- \`playwright.config.ts\` with \`screenshot: 'on'\` and a \`webServer\` block
- Tests in an \`e2e/\` directory
- Screenshots saved to \`test-results/\`
- Chromium-only for speed
`
		: "";

	return `# Spec-Kit Phase 1: Constitution

You are analyzing a codebase to extract coding principles and standards.
${memoriesSection}
## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}${isCosmetic ? "\n- Feature Type: Cosmetic/UI Change" : ""}

## Your Task
Analyze the codebase and generate a "constitution" - a document that captures:

1. **Code Style & Conventions**
   - Naming conventions (files, functions, variables, components)
   - File/folder organization patterns
   - Import/export patterns

2. **Architecture Patterns**
   - How the app is structured (layers, modules)
   - State management approach
   - API/data fetching patterns
   - Error handling patterns

3. **Testing Conventions**
   - Test file locations and naming
   - Testing frameworks used
   - Coverage expectations
   - Test-Driven Development (TDD): the constitution MUST require writing tests before or alongside implementation. Every new function, component, or endpoint should have corresponding test coverage. If the codebase has no tests, the constitution should mandate setting up a test framework and writing tests for all new code.

4. **Tech Stack Details**
   - Key frameworks and libraries
   - Build tools and configuration
   - TypeScript/type strictness level

5. **Existing AGENTS.md or CLAUDE.md Files**
   - Look for any existing AI assistant guidance files
   - Incorporate their instructions
${cosmeticSection}
## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "constitution": "markdown string with all coding principles",
  "techStack": {
    "frontend": ["list", "of", "technologies"],
    "backend": ["list", "of", "technologies"],
    "testing": ["list", "of", "technologies"],
    "build": ["list", "of", "technologies"]
  },
  "keyPatterns": ["list of important patterns discovered"]
}
\`\`\`

Be thorough - this constitution will guide all implementation work.`;
}

export function buildSpecifyPrompt(ctx: PhasePromptContext): string {
	const memoriesSection = ctx.relevantMemories
		? `\n## Learnings from Previous Work\n${ctx.relevantMemories}\n`
		: "";

	return `# Spec-Kit Phase 2: Specify

You are generating a detailed specification for a feature request.
${memoriesSection}
## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}
${ctx.featureDescription ? `- Description: ${ctx.featureDescription}` : ""}

## Constitution (Coding Standards)
${ctx.existingConstitution || "No constitution loaded yet."}

## Your Task
Generate a detailed specification document that covers:

1. **Overview**
   - What is this feature?
   - Why is it needed?
   - Who are the users/stakeholders?

2. **Functional Requirements**
   - List specific, testable requirements
   - Use clear "The system shall..." or "Users can..." language
   - Number each requirement (REQ-001, REQ-002, etc.)

3. **Acceptance Criteria**
   - Define success criteria for each requirement
   - These should be verifiable/testable
   - Use Given/When/Then format where appropriate

4. **Out of Scope**
   - Explicitly list what this feature does NOT include
   - Prevents scope creep

5. **Edge Cases**
   - Error conditions to handle
   - Boundary conditions
   - Empty/null states

## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "spec": {
    "overview": "markdown description",
    "requirements": [
      { "id": "REQ-001", "description": "...", "priority": "must" }
    ],
    "acceptanceCriteria": [
      { "id": "AC-001", "requirement": "REQ-001", "criteria": "Given... When... Then..." }
    ],
    "outOfScope": ["list of things explicitly not included"],
    "edgeCases": ["list of edge cases to handle"]
  }
}
\`\`\`

Be specific and thorough - vague specs lead to incorrect implementations.`;
}

export function buildClarifyPrompt(ctx: PhasePromptContext): string {
	return `# Spec-Kit Phase 3: Clarify

You are reviewing a specification to identify ambiguities and generate clarifying questions.

## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}

## Current Specification
${ctx.existingSpec || "No spec loaded yet."}

## Constitution (Coding Standards)
${ctx.existingConstitution || "No constitution loaded yet."}

## Your Task
Review the specification and identify any ambiguities, missing information, or unclear requirements.

Generate questions that need human answers before proceeding with implementation planning.

Categories of questions to consider:
1. **Business Logic** - How should X behave when Y?
2. **UX/Design** - What should the user see/experience?
3. **Data** - What data is needed? Where does it come from?
4. **Integrations** - How does this connect to existing features?
5. **Performance** - Any specific performance requirements?
6. **Security** - Any security/permission considerations?

## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "clarifications": [
    {
      "id": "CLR-001",
      "category": "business_logic",
      "question": "The specific question",
      "context": "Why this matters for implementation",
      "suggestedDefault": "Optional: what we'd assume if no answer"
    }
  ],
  "assumptions": [
    "List of reasonable assumptions we're making"
  ],
  "risksIfUnclarified": [
    "Potential issues if we proceed without answers"
  ]
}
\`\`\`

If the spec is clear enough and no questions are needed, return:
\`\`\`json
{
  "clarifications": [],
  "assumptions": ["list any assumptions"],
  "risksIfUnclarified": []
}
\`\`\`

Only ask questions that truly need human input - don't ask for things you can determine from the codebase.`;
}

export function buildPlanPrompt(ctx: PhasePromptContext): string {
	const clarificationSection = ctx.clarificationResponses?.length
		? `
## Clarification Responses
${ctx.clarificationResponses.map((c) => `Q: ${c.question}\nA: ${c.answer}`).join("\n\n")}`
		: "";

	const memoriesSection = ctx.relevantMemories
		? `\n## Learnings from Previous Work\n${ctx.relevantMemories}\n`
		: "";

	return `# Spec-Kit Phase 4: Plan

You are generating an implementation plan for a feature.
${memoriesSection}
## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}

## Constitution (Coding Standards)
${ctx.existingConstitution || "No constitution loaded yet."}

## Specification
${ctx.existingSpec || "No spec loaded yet."}
${clarificationSection}

## Your Task
Generate a detailed implementation plan that covers:

1. **Architecture Overview**
   - How this feature fits into the existing system
   - New components/modules needed
   - Data flow diagram (as text)

2. **Technical Decisions**
   - Key technology choices
   - Patterns to use (from constitution)
   - Trade-offs considered

3. **File Structure**
   - New files to create
   - Existing files to modify
   - File organization

4. **Database/Schema Changes**
   - New tables/columns needed
   - Migrations required
   - Index considerations

5. **API Changes**
   - New endpoints
   - Modified endpoints
   - Request/response schemas

6. **Dependencies**
   - New packages needed
   - Version considerations

## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "plan": {
    "architecture": "markdown overview of architecture",
    "techDecisions": [
      { "decision": "...", "rationale": "...", "alternatives": ["..."] }
    ],
    "fileStructure": {
      "create": [{ "path": "...", "purpose": "..." }],
      "modify": [{ "path": "...", "changes": "..." }]
    },
    "schemaChanges": [
      { "type": "create_table|alter_table|migration", "details": "..." }
    ],
    "apiChanges": [
      { "method": "POST", "path": "/api/...", "purpose": "..." }
    ],
    "dependencies": [
      { "package": "...", "version": "...", "reason": "..." }
    ]
  }
}
\`\`\`

Follow the constitution's patterns. The plan should be detailed enough that a developer could implement it without guessing.`;
}

export function buildAnalyzePrompt(ctx: PhasePromptContext): string {
	return `# Spec-Kit Phase 5: Analyze

You are analyzing an implementation plan against the existing codebase.

## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}

## Constitution (Coding Standards)
${ctx.existingConstitution || "No constitution loaded yet."}

## Specification
${ctx.existingSpec || "No spec loaded yet."}

## Implementation Plan
${ctx.existingPlan || "No plan loaded yet."}

## Your Task
Analyze the plan against the actual codebase to identify:

1. **Conflicts with Existing Code**
   - Files that exist but weren't considered
   - Naming conflicts
   - Pattern violations

2. **Missing Considerations**
   - Existing utilities that should be reused
   - Shared components that fit
   - Existing patterns to follow

3. **Technical Risks**
   - Performance concerns
   - Security gaps
   - Scalability issues

4. **Dependencies Check**
   - Are proposed packages already in use (different version)?
   - Are there existing alternatives in the codebase?

5. **Existing Patterns to Follow**
   - Similar features already implemented
   - Patterns to maintain consistency

## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "analysis": {
    "passed": true/false,
    "issues": [
      { "severity": "error|warning|info", "description": "...", "suggestion": "..." }
    ],
    "existingPatterns": [
      { "pattern": "...", "location": "...", "howToApply": "..." }
    ],
    "reusableCode": [
      { "path": "...", "what": "...", "howToUse": "..." }
    ],
    "suggestions": [
      "List of improvement suggestions"
    ]
  }
}
\`\`\`

Set \`passed: false\` only if there are "error" severity issues that must be addressed before implementation.
Set \`passed: true\` if the plan is ready (warnings/info are acceptable).

Be thorough - catching issues now prevents rework later.`;
}

export function buildTasksPrompt(ctx: PhasePromptContext): string {
	return `# Spec-Kit Phase 6: Tasks

You are breaking down an implementation plan into atomic, implementable tasks.

## Context
- Client: ${ctx.clientName}
- Repository: ${ctx.repoName}
- Feature: ${ctx.featureTitle}

## Constitution (Coding Standards)
${ctx.existingConstitution || "No constitution loaded yet."}

## Specification
${ctx.existingSpec || "No spec loaded yet."}

## Implementation Plan
${ctx.existingPlan || "No plan loaded yet."}

## Your Task
Create a list of atomic tasks that:

1. **Are Self-Contained**
   - Each task can be completed in one PR
   - Each task results in working code
   - Tests are included with each task

2. **Have Clear Dependencies**
   - Tasks specify which other tasks must complete first
   - No circular dependencies

3. **Are Ordered Logically**
   - Foundation/infrastructure first
   - Then features
   - Then polish/integration

4. **Include Specific Instructions**
   - Files to create/modify
   - What to implement
   - What tests to write

## Output Format
Output a JSON object with this structure:
\`\`\`json
{
  "tasks": [
    {
      "id": 1,
      "title": "Short task title",
      "description": "Detailed description of what to implement",
      "files": ["list", "of", "files", "to", "touch"],
      "tests": ["tests to write"],
      "dependencies": [0],
      "estimatePoints": 1,
      "acceptanceCriteria": [
        "Specific criteria for this task being complete"
      ]
    }
  ],
  "totalEstimatePoints": 8,
  "criticalPath": [1, 2, 5, 7],
  "parallelizable": [[3, 4], [6]]
}
\`\`\`

- \`dependencies\` is array of task IDs that must complete first (empty for first tasks)
- \`estimatePoints\` is relative complexity (1 = trivial, 2 = simple, 3 = medium, 5 = complex, 8 = very complex)
- \`criticalPath\` is the sequence of tasks that determine minimum time to completion
- \`parallelizable\` groups tasks that can be done simultaneously

Each task should be completable by Claude/Ralph in a single iteration. Break complex tasks into smaller ones.`;
}

// Get the appropriate prompt builder for a phase
export function getPhasePromptBuilder(
	phase: SpecPhase,
): (ctx: PhasePromptContext) => string {
	const builders: Record<SpecPhase, (ctx: PhasePromptContext) => string> = {
		constitution: buildConstitutionPrompt,
		specify: buildSpecifyPrompt,
		clarify: buildClarifyPrompt,
		plan: buildPlanPrompt,
		analyze: buildAnalyzePrompt,
		tasks: buildTasksPrompt,
	};
	return builders[phase];
}
