/**
 * Test fixtures
 * Sample data for use in tests
 */

import type {
	AgentJob,
	Client,
	CodeRepository,
	Feature,
	SpecOutput,
	SpecPhase,
} from "../../src/db/types.js";

// ----- Clients -----

export const testClient: Partial<Client> & { id: string } = {
	id: "client-test-1",
	name: "Test Client",
};

export const anotherClient: Partial<Client> & { id: string } = {
	id: "client-test-2",
	name: "Another Client",
};

// ----- Repositories -----

export const testRepository: Partial<CodeRepository> & { id: string } = {
	id: "repo-test-1",
	client_id: "client-test-1",
	owner_name: "test-org",
	repo_name: "test-app",
	default_branch: "main",
	provider: "github",
	url: "https://github.com/test-org/test-app",
};

export const anotherRepository: Partial<CodeRepository> & { id: string } = {
	id: "repo-test-2",
	client_id: "client-test-2",
	owner_name: "another-org",
	repo_name: "another-app",
	default_branch: "develop",
	provider: "github",
	url: "https://github.com/another-org/another-app",
};

// ----- Features -----

export const testFeature: Partial<Feature> & { id: string } = {
	id: "feature-test-1",
	client_id: "client-test-1",
	title: "Add user authentication",
	functionality_notes: "Should support email/password auth",
};

export const simpleFeature: Partial<Feature> & { id: string } = {
	id: "feature-test-2",
	client_id: "client-test-1",
	title: "Fix typo in header",
};

export const featureWithSpec: Partial<Feature> & { id: string } = {
	id: "feature-test-3",
	client_id: "client-test-1",
	title: "Feature with existing spec",
	spec_output: {
		phase: "plan",
		constitution: "# Standards\n- TypeScript strict mode",
		spec: {
			overview: "Add dark mode toggle",
			requirements: ["REQ-001: Toggle button in settings"],
			acceptanceCriteria: ["AC-001: Theme persists on refresh"],
		},
	} as unknown as Feature["spec_output"],
};

// ----- Jobs -----

export const pendingJob: Partial<AgentJob> & { id: string } = {
	id: "job-pending-1",
	client_id: "client-test-1",
	status: "pending",
	job_type: "code",
	branch_name: "feat/pending-test",
	prompt: "Add a hello world function",
};

export const queuedJob: Partial<AgentJob> & { id: string } = {
	id: "job-queued-1",
	client_id: "client-test-1",
	status: "queued",
	job_type: "code",
	branch_name: "feat/queued-test",
	prompt: "Implement user service",
};

export const runningJob: Partial<AgentJob> & { id: string } = {
	id: "job-running-1",
	client_id: "client-test-1",
	status: "running",
	job_type: "ralph",
	branch_name: "feat/running-test",
	prompt: "Build entire authentication system",
	started_at: new Date().toISOString(),
	current_iteration: 3,
	max_iterations: 10,
};

export const specJob: Partial<AgentJob> & { id: string } = {
	id: "job-spec-1",
	client_id: "client-test-1",
	status: "queued",
	job_type: "spec",
	branch_name: "spec/auth-feature",
	feature_id: "feature-test-1",
	spec_phase: "constitution" as SpecPhase,
	prompt: "Generate spec for authentication feature",
};

export const completedJob: Partial<AgentJob> & { id: string } = {
	id: "job-completed-1",
	client_id: "client-test-1",
	status: "completed",
	job_type: "code",
	branch_name: "feat/completed-test",
	prompt: "Add logging utility",
	started_at: new Date(Date.now() - 60000).toISOString(),
	completed_at: new Date().toISOString(),
};

export const ralphPrdJob: Partial<AgentJob> & { id: string } = {
	id: "job-ralph-prd-1",
	client_id: "client-test-1",
	status: "queued",
	job_type: "ralph",
	branch_name: "feat/prd-feature",
	prompt: "Implement features from PRD",
	prd_mode: true,
	prd: {
		title: "User Dashboard",
		description: "Build user dashboard with metrics",
		stories: [
			{
				id: 1,
				title: "Display user stats",
				description: "Show basic user statistics",
				acceptanceCriteria: ["Shows total users", "Shows active users"],
				passes: false,
			},
			{
				id: 2,
				title: "Add chart visualization",
				description: "Display data as charts",
				passes: false,
			},
		],
	} as AgentJob["prd"],
};

// ----- Spec Outputs -----

export const constitutionOutput: SpecOutput = {
	phase: "constitution",
	constitution: `# Coding Standards

## Code Style
- Use TypeScript strict mode
- No any types allowed
- Use Biome for formatting

## Architecture
- Repository pattern for data access
- Service layer for business logic
- Express for HTTP routing

## Testing
- Use bun:test
- Colocate tests with source files
- Aim for 80% coverage`,
};

export const specifyOutput: SpecOutput = {
	phase: "specify",
	constitution: constitutionOutput.constitution,
	spec: {
		overview:
			"This feature adds user authentication to enable secure access to the application.",
		requirements: [
			"REQ-001: Users can register with email and password",
			"REQ-002: Users can log in with credentials",
			"REQ-003: Users can log out",
			"REQ-004: Sessions expire after 24 hours",
		],
		acceptanceCriteria: [
			"AC-001: Registration creates user in database",
			"AC-002: Login returns valid JWT token",
			"AC-003: Invalid credentials return 401",
		],
		outOfScope: ["Social login", "Two-factor auth", "Password recovery"],
	},
};

export const clarifyOutput: SpecOutput = {
	...specifyOutput,
	phase: "clarify",
	clarifications: [
		{
			id: "CLR-001",
			question: "Should password have minimum requirements?",
			context: "Affects validation logic",
			response: "Yes, minimum 8 characters with 1 number",
			respondedAt: new Date().toISOString(),
		},
		{
			id: "CLR-002",
			question: "Should we lock accounts after failed attempts?",
			context: "Security consideration",
		},
	],
};

export const planOutput: SpecOutput = {
	...clarifyOutput,
	phase: "plan",
	plan: {
		architecture:
			"Add auth module with JWT-based authentication, integrate with existing user model",
		techDecisions: [
			"Use JWT for stateless sessions",
			"Store password hash with bcrypt",
			"Add auth middleware to protected routes",
		],
		fileStructure: [
			"src/auth/index.ts - Module entry point",
			"src/auth/jwt.ts - Token utilities",
			"src/auth/middleware.ts - Auth middleware",
			"src/auth/routes.ts - Auth endpoints",
		],
		dependencies: ["jsonwebtoken@9.0.0", "bcrypt@5.1.0"],
	},
};

export const analyzeOutput: SpecOutput = {
	...planOutput,
	phase: "analyze",
	analysis: {
		passed: true,
		issues: ["Consider adding rate limiting to login endpoint"],
		suggestions: ["Reuse existing error handling middleware"],
		existingPatterns: ["Error middleware in src/middleware/error.ts"],
	},
};

export const tasksOutput: SpecOutput = {
	...analyzeOutput,
	phase: "tasks",
	tasks: [
		{
			id: 1,
			title: "Set up auth module structure",
			description: "Create auth folder with types and exports",
			files: ["src/auth/index.ts", "src/auth/types.ts"],
			dependencies: [],
		},
		{
			id: 2,
			title: "Implement JWT utilities",
			description: "Add sign/verify functions for tokens",
			files: ["src/auth/jwt.ts"],
			dependencies: [1],
		},
		{
			id: 3,
			title: "Add auth middleware",
			description: "Create middleware to verify JWT on requests",
			files: ["src/auth/middleware.ts"],
			dependencies: [2],
		},
		{
			id: 4,
			title: "Implement auth routes",
			description: "Add signup, login, logout endpoints",
			files: ["src/auth/routes.ts"],
			dependencies: [2, 3],
		},
	],
};

// ----- Helper Functions -----

export function createJobWithPhase(
	phase: SpecPhase,
): Partial<AgentJob> & { id: string } {
	return {
		id: `job-spec-${phase}`,
		client_id: "client-test-1",
		status: "queued",
		job_type: "spec",
		branch_name: `spec/${phase}-test`,
		feature_id: "feature-test-1",
		spec_phase: phase,
		prompt: `Run ${phase} phase`,
	};
}

export function getSpecOutputForPhase(phase: SpecPhase): SpecOutput {
	const outputs: Record<SpecPhase, SpecOutput> = {
		constitution: constitutionOutput,
		specify: specifyOutput,
		clarify: clarifyOutput,
		plan: planOutput,
		analyze: analyzeOutput,
		tasks: tasksOutput,
	};
	return outputs[phase];
}
