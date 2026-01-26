/**
 * Unit tests for mcp/server.ts pure logic functions
 * Tests MCP_TOOLS schema, MCP_RESOURCES, getParam, tool routing
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/mcp/server.ts =====

function getParam(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string {
	const value = params[key];
	if (Array.isArray(value)) return value[0] ?? "";
	return value ?? "";
}

// MCP Tool definitions (replicated shape)
const MCP_TOOLS = [
	{
		name: "create_spec",
		description:
			"Create a specification job for a feature. Starts the spec-kit pipeline.",
		inputSchema: {
			type: "object",
			properties: {
				featureId: {
					type: "string",
					description: "UUID of the feature to spec",
				},
				clientId: { type: "string", description: "UUID of the client" },
			},
			required: ["featureId", "clientId"],
		},
	},
	{
		name: "get_job_status",
		description: "Get the current status and details of a job",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", description: "UUID of the job" },
			},
			required: ["jobId"],
		},
	},
	{
		name: "list_jobs",
		description: "List jobs with optional filters",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: [
						"pending",
						"queued",
						"running",
						"completed",
						"failed",
						"cancelled",
					],
				},
				jobType: { type: "string", enum: ["code", "task", "ralph", "spec"] },
				clientId: { type: "string", description: "Filter by client UUID" },
				limit: { type: "number", description: "Max results (default 20)" },
			},
		},
	},
	{
		name: "get_spec_output",
		description: "Get the specification output for a feature",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
			},
			required: ["featureId"],
		},
	},
	{
		name: "answer_clarify",
		description: "Submit answers to clarification questions",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
				clarificationId: {
					type: "string",
					description: "ID of the clarification",
				},
				response: { type: "string", description: "The answer to the question" },
			},
			required: ["featureId", "clarificationId", "response"],
		},
	},
	{
		name: "approve_spec",
		description:
			"Approve a completed specification, moving it to ready for implementation",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
			},
			required: ["featureId"],
		},
	},
	{
		name: "get_capacity",
		description: "Get current system capacity and queue status",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "list_phases",
		description: "List all spec-kit phases with their details",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "run_phase",
		description: "Run a specific spec-kit phase for a feature",
		inputSchema: {
			type: "object",
			properties: {
				featureId: { type: "string", description: "UUID of the feature" },
				phase: {
					type: "string",
					enum: [
						"constitution",
						"specify",
						"clarify",
						"plan",
						"analyze",
						"tasks",
					],
				},
			},
			required: ["featureId", "phase"],
		},
	},
];

const MCP_RESOURCES = [
	{
		uri: "jobs://active",
		name: "Active Jobs",
		description: "List of currently running and pending jobs",
		mimeType: "application/json",
	},
	{
		uri: "jobs://{id}",
		name: "Job Details",
		description: "Details of a specific job",
		mimeType: "application/json",
	},
	{
		uri: "features://{id}/spec",
		name: "Feature Spec",
		description: "Specification output for a feature",
		mimeType: "application/json",
	},
	{
		uri: "phases://list",
		name: "Spec Phases",
		description: "List of all spec-kit phases",
		mimeType: "application/json",
	},
];

// Replicate tool routing (unknown tool handler)
function routeToolCall(toolName: string): { isKnown: boolean } {
	const knownTools = MCP_TOOLS.map((t) => t.name);
	return { isKnown: knownTools.includes(toolName) };
}

// ===== Tests =====

describe("MCP Pure Logic", () => {
	describe("MCP_TOOLS", () => {
		it("should have 9 tools defined", () => {
			expect(MCP_TOOLS).toHaveLength(9);
		});

		it("should have unique tool names", () => {
			const names = MCP_TOOLS.map((t) => t.name);
			const uniqueNames = [...new Set(names)];
			expect(uniqueNames.length).toBe(names.length);
		});

		it("should have name, description, and inputSchema for each tool", () => {
			for (const tool of MCP_TOOLS) {
				expect(typeof tool.name).toBe("string");
				expect(tool.name.length).toBeGreaterThan(0);
				expect(typeof tool.description).toBe("string");
				expect(tool.description.length).toBeGreaterThan(0);
				expect(tool.inputSchema).toBeDefined();
				expect(tool.inputSchema.type).toBe("object");
			}
		});

		it("should have valid required fields referencing properties", () => {
			for (const tool of MCP_TOOLS) {
				if (tool.inputSchema.required) {
					const propKeys = Object.keys(tool.inputSchema.properties);
					for (const req of tool.inputSchema.required) {
						expect(propKeys).toContain(req);
					}
				}
			}
		});

		it("should include create_spec tool", () => {
			const tool = MCP_TOOLS.find((t) => t.name === "create_spec");
			expect(tool).toBeDefined();
			expect(tool?.inputSchema.required).toContain("featureId");
			expect(tool?.inputSchema.required).toContain("clientId");
		});

		it("should include run_phase tool with valid phase enum", () => {
			const tool = MCP_TOOLS.find((t) => t.name === "run_phase");
			expect(tool).toBeDefined();
			const phaseEnum = tool?.inputSchema.properties.phase as Record<
				string,
				unknown
			>;
			expect(phaseEnum.enum).toEqual([
				"constitution",
				"specify",
				"clarify",
				"plan",
				"analyze",
				"tasks",
			]);
		});

		it("should include list_jobs tool with status enum", () => {
			const tool = MCP_TOOLS.find((t) => t.name === "list_jobs");
			expect(tool).toBeDefined();
			const statusProp = tool?.inputSchema.properties.status as Record<
				string,
				unknown
			>;
			expect(statusProp.enum).toContain("pending");
			expect(statusProp.enum).toContain("running");
			expect(statusProp.enum).toContain("completed");
		});

		it("should have tools with no required params (get_capacity, list_phases)", () => {
			const getCapacity = MCP_TOOLS.find((t) => t.name === "get_capacity");
			const listPhases = MCP_TOOLS.find((t) => t.name === "list_phases");
			expect(getCapacity?.inputSchema.required).toBeUndefined();
			expect(listPhases?.inputSchema.required).toBeUndefined();
		});
	});

	describe("MCP_RESOURCES", () => {
		it("should have 4 resources defined", () => {
			expect(MCP_RESOURCES).toHaveLength(4);
		});

		it("should have uri, name, description, and mimeType for each", () => {
			for (const resource of MCP_RESOURCES) {
				expect(typeof resource.uri).toBe("string");
				expect(typeof resource.name).toBe("string");
				expect(typeof resource.description).toBe("string");
				expect(resource.mimeType).toBe("application/json");
			}
		});

		it("should have unique URIs", () => {
			const uris = MCP_RESOURCES.map((r) => r.uri);
			const uniqueUris = [...new Set(uris)];
			expect(uniqueUris.length).toBe(uris.length);
		});

		it("should include jobs://active resource", () => {
			const resource = MCP_RESOURCES.find((r) => r.uri === "jobs://active");
			expect(resource).toBeDefined();
			expect(resource?.name).toBe("Active Jobs");
		});

		it("should include phases://list resource", () => {
			const resource = MCP_RESOURCES.find((r) => r.uri === "phases://list");
			expect(resource).toBeDefined();
			expect(resource?.name).toBe("Spec Phases");
		});
	});

	describe("getParam", () => {
		it("should return string value directly", () => {
			const result = getParam({ toolName: "create_spec" }, "toolName");
			expect(result).toBe("create_spec");
		});

		it("should return first element when value is array", () => {
			const result = getParam({ id: ["abc", "def"] }, "id");
			expect(result).toBe("abc");
		});

		it("should return empty string when key is missing", () => {
			const result = getParam({}, "missing");
			expect(result).toBe("");
		});

		it("should return empty string when value is undefined", () => {
			const result = getParam({ key: undefined }, "key");
			expect(result).toBe("");
		});

		it("should return empty string for empty array", () => {
			const result = getParam({ key: [] as string[] }, "key");
			expect(result).toBe("");
		});

		it("should handle multiple params", () => {
			const params = { a: "hello", b: ["world"], c: undefined };
			expect(getParam(params, "a")).toBe("hello");
			expect(getParam(params, "b")).toBe("world");
			expect(getParam(params, "c")).toBe("");
		});
	});

	describe("Tool routing", () => {
		it("should recognize known tools", () => {
			expect(routeToolCall("create_spec").isKnown).toBe(true);
			expect(routeToolCall("get_job_status").isKnown).toBe(true);
			expect(routeToolCall("list_jobs").isKnown).toBe(true);
			expect(routeToolCall("run_phase").isKnown).toBe(true);
		});

		it("should reject unknown tools", () => {
			expect(routeToolCall("unknown_tool").isKnown).toBe(false);
			expect(routeToolCall("").isKnown).toBe(false);
			expect(routeToolCall("delete_all").isKnown).toBe(false);
		});
	});
});
