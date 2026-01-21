/**
 * Mock Claude CLI for testing
 * Simulates Claude CLI responses without making real API calls
 */

import type { SpecPhase } from "../../src/db/types.js";

export interface MockClaudeResponse {
	stdout: string;
	stderr: string;
	exitCode: number;
}

// Configurable responses for different scenarios
let mockResponses: Map<string, MockClaudeResponse> = new Map();
let defaultResponse: MockClaudeResponse = {
	stdout: '{"result": "mock response"}',
	stderr: "",
	exitCode: 0,
};

// Track calls for assertions
let calls: Array<{ args: string[]; cwd?: string }> = [];

export function resetMockClaude(): void {
	mockResponses = new Map();
	calls = [];
	defaultResponse = {
		stdout: '{"result": "mock response"}',
		stderr: "",
		exitCode: 0,
	};
}

export function setDefaultResponse(response: MockClaudeResponse): void {
	defaultResponse = response;
}

export function setMockResponse(
	pattern: string,
	response: MockClaudeResponse,
): void {
	mockResponses.set(pattern, response);
}

export function getCalls(): Array<{ args: string[]; cwd?: string }> {
	return calls;
}

export function getCallCount(): number {
	return calls.length;
}

// Mock spawn function that simulates Claude CLI
export function createMockClaudeSpawn() {
	return (
		_command: string,
		args: string[],
		options?: { cwd?: string },
	): MockChildProcess => {
		calls.push({ args, cwd: options?.cwd });

		// Find matching response
		let response = defaultResponse;
		for (const [pattern, resp] of mockResponses) {
			if (args.some((arg) => arg.includes(pattern))) {
				response = resp;
				break;
			}
		}

		return new MockChildProcess(response);
	};
}

// Mock child process for simulating spawn
class MockChildProcess {
	private response: MockClaudeResponse;
	private stdoutHandlers: Array<(data: Buffer) => void> = [];
	private stderrHandlers: Array<(data: Buffer) => void> = [];
	private closeHandlers: Array<(code: number) => void> = [];
	private errorHandlers: Array<(error: Error) => void> = [];

	stdout = {
		on: (event: string, handler: (data: Buffer) => void) => {
			if (event === "data") this.stdoutHandlers.push(handler);
		},
	};

	stderr = {
		on: (event: string, handler: (data: Buffer) => void) => {
			if (event === "data") this.stderrHandlers.push(handler);
		},
	};

	stdin = {
		write: (_data: string) => {},
		end: () => {},
	};

	pid = 12345;

	constructor(response: MockClaudeResponse) {
		this.response = response;

		// Simulate async response
		setTimeout(() => {
			if (this.response.stdout) {
				for (const handler of this.stdoutHandlers) {
					handler(Buffer.from(this.response.stdout));
				}
			}
			if (this.response.stderr) {
				for (const handler of this.stderrHandlers) {
					handler(Buffer.from(this.response.stderr));
				}
			}
			for (const handler of this.closeHandlers) {
				handler(this.response.exitCode);
			}
		}, 10);
	}

	on(event: string, handler: (arg: number | Error) => void): this {
		if (event === "close") {
			this.closeHandlers.push(handler as (code: number) => void);
		} else if (event === "error") {
			this.errorHandlers.push(handler as (error: Error) => void);
		}
		return this;
	}

	kill(): boolean {
		return true;
	}
}

// Predefined responses for spec phases
export const specPhaseResponses: Record<SpecPhase, MockClaudeResponse> = {
	constitution: {
		stdout: JSON.stringify({
			constitution:
				"# Coding Standards\n\n- Use TypeScript\n- Follow Biome rules\n- No any types",
			techStack: {
				frontend: ["React", "Next.js"],
				backend: ["Node.js", "Express"],
				testing: ["Bun test"],
				build: ["TypeScript", "Bun"],
			},
			keyPatterns: [
				"Repository pattern",
				"Service layer",
				"Dependency injection",
			],
		}),
		stderr: "",
		exitCode: 0,
	},
	specify: {
		stdout: JSON.stringify({
			spec: {
				overview: "This feature adds user authentication to the application.",
				requirements: [
					{
						id: "REQ-001",
						description: "Users can sign up with email",
						priority: "must",
					},
					{
						id: "REQ-002",
						description: "Users can log in with email/password",
						priority: "must",
					},
				],
				acceptanceCriteria: [
					{
						id: "AC-001",
						requirement: "REQ-001",
						criteria:
							"Given a new user, when they submit valid email and password, then account is created",
					},
				],
				outOfScope: ["Social login", "Two-factor authentication"],
				edgeCases: ["Invalid email format", "Password too weak"],
			},
		}),
		stderr: "",
		exitCode: 0,
	},
	clarify: {
		stdout: JSON.stringify({
			clarifications: [
				{
					id: "CLR-001",
					category: "business_logic",
					question: "Should users be able to reset their password via email?",
					context: "This affects email service integration",
					suggestedDefault: "Yes, with email verification",
				},
			],
			assumptions: ["Email addresses must be unique"],
			risksIfUnclarified: [
				"May need to add password reset later if not included",
			],
		}),
		stderr: "",
		exitCode: 0,
	},
	plan: {
		stdout: JSON.stringify({
			plan: {
				architecture:
					"Add auth module with JWT tokens, integrate with existing user table",
				techDecisions: [
					{
						decision: "Use JWT for sessions",
						rationale: "Stateless, scalable",
						alternatives: ["Session cookies"],
					},
				],
				fileStructure: {
					create: [
						{ path: "src/auth/index.ts", purpose: "Auth module entry" },
						{ path: "src/auth/jwt.ts", purpose: "JWT utilities" },
					],
					modify: [{ path: "src/index.ts", changes: "Add auth middleware" }],
				},
				schemaChanges: [
					{
						type: "alter_table",
						details: "Add password_hash column to users table",
					},
				],
				apiChanges: [
					{ method: "POST", path: "/auth/signup", purpose: "Create account" },
					{ method: "POST", path: "/auth/login", purpose: "Authenticate" },
				],
				dependencies: [
					{ package: "jsonwebtoken", version: "^9.0.0", reason: "JWT signing" },
				],
			},
		}),
		stderr: "",
		exitCode: 0,
	},
	analyze: {
		stdout: JSON.stringify({
			analysis: {
				passed: true,
				issues: [
					{
						severity: "warning",
						description: "Consider rate limiting on login endpoint",
						suggestion: "Add rate limiter middleware",
					},
				],
				existingPatterns: [
					{
						pattern: "Middleware chain",
						location: "src/index.ts",
						howToApply: "Add auth middleware to chain",
					},
				],
				reusableCode: [
					{
						path: "src/utils/crypto.ts",
						what: "Hash utilities",
						howToUse: "Use for password hashing",
					},
				],
				suggestions: ["Add login attempt tracking"],
			},
		}),
		stderr: "",
		exitCode: 0,
	},
	tasks: {
		stdout: JSON.stringify({
			tasks: [
				{
					id: 1,
					title: "Create auth module structure",
					description: "Set up auth folder with index.ts and types",
					files: ["src/auth/index.ts", "src/auth/types.ts"],
					tests: ["tests/auth/index.test.ts"],
					dependencies: [],
					estimatePoints: 2,
					acceptanceCriteria: ["Auth module exports correctly"],
				},
				{
					id: 2,
					title: "Implement JWT utilities",
					description: "Add JWT sign/verify functions",
					files: ["src/auth/jwt.ts"],
					tests: ["tests/auth/jwt.test.ts"],
					dependencies: [1],
					estimatePoints: 3,
					acceptanceCriteria: ["Can sign and verify tokens"],
				},
			],
			totalEstimatePoints: 5,
			criticalPath: [1, 2],
			parallelizable: [],
		}),
		stderr: "",
		exitCode: 0,
	},
};

// Helper to set up spec phase response
export function setupSpecPhaseResponse(phase: SpecPhase): void {
	setMockResponse(phase, specPhaseResponses[phase]);
}

// Helper to set up all spec phase responses
export function setupAllSpecPhaseResponses(): void {
	for (const phase of Object.keys(specPhaseResponses) as SpecPhase[]) {
		setMockResponse(phase, specPhaseResponses[phase]);
	}
}

// Helper to simulate Claude auth check
export function createMockAuthCheck(authenticated: boolean) {
	return async (): Promise<{
		authenticated: boolean;
		version: string;
		loginType: string | null;
	}> => ({
		authenticated,
		version: "1.0.0-mock",
		loginType: authenticated ? "api_key" : null,
	});
}
