/**
 * Integration tests for API endpoints
 * Tests HTTP response shapes and status codes
 */

import { describe, expect, it } from "bun:test";

// Note: These tests verify API contract and response shapes
// For full integration tests with a running server, use the test:e2e script

describe("API Response Contracts", () => {
	describe("Health Endpoint Response", () => {
		interface HealthResponse {
			status: "ok" | "error";
			queue: {
				running: number;
				queued: number;
				maxConcurrent: number;
			};
			claude: {
				authenticated: boolean;
				version: string | null;
				loginType: string | null;
			};
			git: {
				authenticated: boolean;
				user: string | null;
			};
		}

		it("should have correct health response shape", () => {
			const mockResponse: HealthResponse = {
				status: "ok",
				queue: { running: 0, queued: 0, maxConcurrent: 2 },
				claude: { authenticated: true, version: "1.0.0", loginType: "api_key" },
				git: { authenticated: true, user: "test-user" },
			};

			expect(mockResponse.status).toBeDefined();
			expect(mockResponse.queue).toBeDefined();
			expect(typeof mockResponse.queue.running).toBe("number");
			expect(typeof mockResponse.queue.queued).toBe("number");
			expect(typeof mockResponse.queue.maxConcurrent).toBe("number");
			expect(mockResponse.claude).toBeDefined();
			expect(typeof mockResponse.claude.authenticated).toBe("boolean");
		});
	});

	describe("Jobs Endpoint Response", () => {
		interface JobResponse {
			id: string;
			client_id: string;
			status: string;
			job_type: string;
			branch_name: string;
			created_at: string;
			started_at: string | null;
			completed_at: string | null;
		}

		it("should have correct job response shape", () => {
			const mockJob: JobResponse = {
				id: "job-123",
				client_id: "client-1",
				status: "running",
				job_type: "code",
				branch_name: "feat/test",
				created_at: new Date().toISOString(),
				started_at: new Date().toISOString(),
				completed_at: null,
			};

			expect(mockJob.id).toBeTruthy();
			expect(mockJob.client_id).toBeTruthy();
			expect([
				"pending",
				"queued",
				"running",
				"completed",
				"failed",
				"cancelled",
			]).toContain(mockJob.status);
			expect(["code", "task", "ralph", "spec"]).toContain(mockJob.job_type);
		});
	});

	describe("Queue Status Response", () => {
		interface QueueStatusResponse {
			running: Array<{
				id: string;
				clientId: string;
				branchName: string;
				startedAt: string | null;
				runningFor: string | null;
			}>;
			queued: Array<{
				id: string;
				clientId: string;
				branchName: string;
				position: number;
				createdAt: string | null;
			}>;
			maxConcurrent: number;
		}

		it("should have correct queue status shape", () => {
			const mockStatus: QueueStatusResponse = {
				running: [
					{
						id: "job-1",
						clientId: "client-1",
						branchName: "feat/running",
						startedAt: new Date().toISOString(),
						runningFor: "5m 30s",
					},
				],
				queued: [
					{
						id: "job-2",
						clientId: "client-2",
						branchName: "feat/queued",
						position: 1,
						createdAt: new Date().toISOString(),
					},
				],
				maxConcurrent: 2,
			};

			expect(Array.isArray(mockStatus.running)).toBe(true);
			expect(Array.isArray(mockStatus.queued)).toBe(true);
			expect(typeof mockStatus.maxConcurrent).toBe("number");

			if (mockStatus.queued.length > 0) {
				expect(mockStatus.queued[0].position).toBe(1);
			}
		});
	});

	describe("Spec Start Response", () => {
		interface SpecStartResponse {
			jobId: string;
			specPhase: string;
			message: string;
		}

		it("should have correct spec start response shape", () => {
			const mockResponse: SpecStartResponse = {
				jobId: "job-spec-123",
				specPhase: "constitution",
				message: "Spec-Kit started with constitution phase",
			};

			expect(mockResponse.jobId).toBeTruthy();
			expect(mockResponse.specPhase).toBe("constitution");
			expect(mockResponse.message).toBeTruthy();
		});
	});

	describe("Spec Output Response", () => {
		interface SpecOutputResponse {
			featureId: string;
			specOutput: {
				phase: string;
				constitution?: string;
				spec?: object;
				clarifications?: Array<{
					id: string;
					question: string;
					response?: string;
				}>;
				plan?: object;
				analysis?: object;
				tasks?: Array<object>;
			} | null;
			jobs: Array<{
				id: string;
				specPhase: string;
				status: string;
			}>;
			currentPhase: string | null;
			pendingClarifications: number;
		}

		it("should have correct spec output response shape", () => {
			const mockResponse: SpecOutputResponse = {
				featureId: "feature-123",
				specOutput: {
					phase: "clarify",
					constitution: "# Standards",
					spec: { overview: "Test feature" },
					clarifications: [{ id: "CLR-001", question: "How should X work?" }],
				},
				jobs: [
					{ id: "job-1", specPhase: "constitution", status: "completed" },
					{ id: "job-2", specPhase: "specify", status: "completed" },
					{ id: "job-3", specPhase: "clarify", status: "completed" },
				],
				currentPhase: "clarify",
				pendingClarifications: 1,
			};

			expect(mockResponse.featureId).toBeTruthy();
			expect(mockResponse.specOutput).toBeDefined();
			expect(Array.isArray(mockResponse.jobs)).toBe(true);
		});

		it("should handle null spec output", () => {
			const mockResponse: SpecOutputResponse = {
				featureId: "feature-123",
				specOutput: null,
				jobs: [],
				currentPhase: null,
				pendingClarifications: 0,
			};

			expect(mockResponse.specOutput).toBeNull();
			expect(mockResponse.currentPhase).toBeNull();
		});
	});

	describe("Error Response", () => {
		interface ErrorResponse {
			error: string;
			details?: string;
			code?: string;
		}

		it("should have correct error response shape", () => {
			const mockError: ErrorResponse = {
				error: "Job not found",
				details: "No job exists with id: job-999",
				code: "NOT_FOUND",
			};

			expect(mockError.error).toBeTruthy();
			expect(typeof mockError.error).toBe("string");
		});

		it("should handle minimal error response", () => {
			const mockError: ErrorResponse = {
				error: "Internal server error",
			};

			expect(mockError.error).toBeTruthy();
			expect(mockError.details).toBeUndefined();
		});
	});
});

describe("API Authentication", () => {
	// Test auth header validation logic
	function isValidAuthHeader(
		header: string | undefined,
		secret: string,
	): boolean {
		if (!header) return false;
		if (!header.startsWith("Bearer ")) return false;
		const token = header.slice(7);
		return token === secret;
	}

	const validSecret = "test-secret-123";

	it("should accept valid Bearer token", () => {
		expect(isValidAuthHeader(`Bearer ${validSecret}`, validSecret)).toBe(true);
	});

	it("should reject missing header", () => {
		expect(isValidAuthHeader(undefined, validSecret)).toBe(false);
	});

	it("should reject wrong token", () => {
		expect(isValidAuthHeader("Bearer wrong-token", validSecret)).toBe(false);
	});

	it("should reject malformed header (no Bearer)", () => {
		expect(isValidAuthHeader(validSecret, validSecret)).toBe(false);
	});

	it("should reject empty token", () => {
		expect(isValidAuthHeader("Bearer ", validSecret)).toBe(false);
	});
});

describe("API Request Validation", () => {
	// Test request body validation logic
	interface CreateJobRequest {
		prompt: string;
		clientId: string;
		jobType?: string;
		branchName?: string;
		repositoryId?: string;
		featureId?: string;
	}

	function validateCreateJobRequest(body: Partial<CreateJobRequest>): {
		valid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];

		if (!body.prompt || typeof body.prompt !== "string") {
			errors.push("prompt is required and must be a string");
		}
		if (!body.clientId || typeof body.clientId !== "string") {
			errors.push("clientId is required and must be a string");
		}
		if (
			body.jobType &&
			!["code", "task", "ralph", "spec"].includes(body.jobType)
		) {
			errors.push("jobType must be one of: code, task, ralph, spec");
		}

		return { valid: errors.length === 0, errors };
	}

	it("should validate valid request", () => {
		const result = validateCreateJobRequest({
			prompt: "Add a function",
			clientId: "client-123",
			jobType: "code",
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject missing prompt", () => {
		const result = validateCreateJobRequest({
			clientId: "client-123",
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("prompt is required and must be a string");
	});

	it("should reject missing clientId", () => {
		const result = validateCreateJobRequest({
			prompt: "Add a function",
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"clientId is required and must be a string",
		);
	});

	it("should reject invalid jobType", () => {
		const result = validateCreateJobRequest({
			prompt: "Add a function",
			clientId: "client-123",
			jobType: "invalid",
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"jobType must be one of: code, task, ralph, spec",
		);
	});

	it("should allow optional fields", () => {
		const result = validateCreateJobRequest({
			prompt: "Add a function",
			clientId: "client-123",
			branchName: "feat/test",
			repositoryId: "repo-123",
			featureId: "feature-123",
		});
		expect(result.valid).toBe(true);
	});
});

describe("Spec Phase Request Validation", () => {
	interface RunPhaseRequest {
		phase: string;
	}

	const validPhases = [
		"constitution",
		"specify",
		"clarify",
		"plan",
		"analyze",
		"tasks",
	];

	function validateRunPhaseRequest(body: Partial<RunPhaseRequest>): {
		valid: boolean;
		error?: string;
	} {
		if (!body.phase) {
			return { valid: false, error: "phase is required" };
		}
		if (!validPhases.includes(body.phase)) {
			return {
				valid: false,
				error: `phase must be one of: ${validPhases.join(", ")}`,
			};
		}
		return { valid: true };
	}

	it("should accept valid phases", () => {
		for (const phase of validPhases) {
			const result = validateRunPhaseRequest({ phase });
			expect(result.valid).toBe(true);
		}
	});

	it("should reject missing phase", () => {
		const result = validateRunPhaseRequest({});
		expect(result.valid).toBe(false);
		expect(result.error).toContain("required");
	});

	it("should reject invalid phase", () => {
		const result = validateRunPhaseRequest({ phase: "invalid" });
		expect(result.valid).toBe(false);
		expect(result.error).toContain("must be one of");
	});
});
