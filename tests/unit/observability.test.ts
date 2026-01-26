/**
 * Unit tests for observability/index.ts pure logic functions
 * Tests trace/span ID generation, span lifecycle, events, attributes, metrics
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/observability/index.ts =====

interface SpanEvent {
	name: string;
	timestamp: number;
	attributes?: Record<string, string | number | boolean>;
}

interface Span {
	id: string;
	traceId: string;
	parentSpanId?: string;
	name: string;
	kind: "internal" | "client" | "server" | "producer" | "consumer";
	status: "ok" | "error" | "unset";
	startTime: number;
	endTime?: number;
	attributes: Record<string, string | number | boolean>;
	events: SpanEvent[];
}

interface TraceContext {
	traceId: string;
	spanId: string;
}

function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

// In-memory span storage for tests
function createSpanStorage() {
	const activeSpans = new Map<string, Span>();
	const completedSpans: Span[] = [];

	function startTrace(
		name: string,
		attributes: Record<string, string | number | boolean> = {},
	): TraceContext {
		const traceId = generateTraceId();
		const spanId = generateSpanId();

		const span: Span = {
			id: spanId,
			traceId,
			name,
			kind: "server",
			status: "unset",
			startTime: Date.now(),
			attributes: {
				...attributes,
				"service.name": "spec-ralph",
			},
			events: [],
		};

		activeSpans.set(spanId, span);
		return { traceId, spanId };
	}

	function startSpan(
		name: string,
		parentContext: TraceContext,
		attributes: Record<string, string | number | boolean> = {},
	): TraceContext {
		const spanId = generateSpanId();

		const span: Span = {
			id: spanId,
			traceId: parentContext.traceId,
			parentSpanId: parentContext.spanId,
			name,
			kind: "internal",
			status: "unset",
			startTime: Date.now(),
			attributes,
			events: [],
		};

		activeSpans.set(spanId, span);
		return { traceId: parentContext.traceId, spanId };
	}

	function endSpan(
		context: TraceContext,
		status: "ok" | "error" = "ok",
		attributes?: Record<string, string | number | boolean>,
	): void {
		const span = activeSpans.get(context.spanId);
		if (!span) return;

		span.endTime = Date.now();
		span.status = status;

		if (attributes) {
			span.attributes = { ...span.attributes, ...attributes };
		}

		activeSpans.delete(context.spanId);
		completedSpans.push(span);
	}

	function addSpanEvent(
		context: TraceContext,
		name: string,
		attributes?: Record<string, string | number | boolean>,
	): void {
		const span = activeSpans.get(context.spanId);
		if (!span) return;

		span.events.push({
			name,
			timestamp: Date.now(),
			attributes,
		});
	}

	function setSpanAttributes(
		context: TraceContext,
		attributes: Record<string, string | number | boolean>,
	): void {
		const span = activeSpans.get(context.spanId);
		if (!span) return;

		span.attributes = { ...span.attributes, ...attributes };
	}

	function recordException(context: TraceContext, error: Error): void {
		const span = activeSpans.get(context.spanId);
		if (!span) return;

		span.events.push({
			name: "exception",
			timestamp: Date.now(),
			attributes: {
				"exception.type": error.name,
				"exception.message": error.message,
				"exception.stacktrace": error.stack || "",
			},
		});

		span.status = "error";
	}

	function getTraceSpans(traceId: string): Span[] {
		return completedSpans.filter((s) => s.traceId === traceId);
	}

	function getRecentTraces(limit = 20): Span[] {
		return completedSpans
			.filter((s) => !s.parentSpanId)
			.slice(-limit)
			.reverse();
	}

	return {
		activeSpans,
		completedSpans,
		startTrace,
		startSpan,
		endSpan,
		addSpanEvent,
		setSpanAttributes,
		recordException,
		getTraceSpans,
		getRecentTraces,
	};
}

// Metrics calculation (replicated)
function calculateMetrics(completedSpans: Span[]): {
	jobsTotal: number;
	jobsCompleted: number;
	jobsFailed: number;
	avgDurationMs: number;
	tokensUsedToday: number;
	phaseTimings: Record<
		string,
		{ count: number; totalMs: number; avgMs: number }
	>;
} {
	const phases = completedSpans.filter((s) => s.name === "spec_kit_phase");
	const phaseTimings: Record<
		string,
		{ count: number; totalMs: number; avgMs: number }
	> = {};

	for (const span of phases) {
		const phase = span.attributes["spec.phase"] as string;
		if (!phase) continue;

		const duration = (span.endTime || Date.now()) - span.startTime;

		if (!phaseTimings[phase]) {
			phaseTimings[phase] = { count: 0, totalMs: 0, avgMs: 0 };
		}

		phaseTimings[phase].count++;
		phaseTimings[phase].totalMs += duration;
		phaseTimings[phase].avgMs =
			phaseTimings[phase].totalMs / phaseTimings[phase].count;
	}

	const rootSpans = completedSpans.filter((s) => !s.parentSpanId);
	const totalDuration = rootSpans.reduce(
		(sum, s) => sum + ((s.endTime || Date.now()) - s.startTime),
		0,
	);

	return {
		jobsTotal: rootSpans.length,
		jobsCompleted: rootSpans.filter((s) => s.status === "ok").length,
		jobsFailed: rootSpans.filter((s) => s.status === "error").length,
		avgDurationMs: rootSpans.length > 0 ? totalDuration / rootSpans.length : 0,
		tokensUsedToday: completedSpans
			.filter((s) => s.name === "claude_call")
			.reduce(
				(sum, s) => sum + ((s.attributes["llm.tokens_total"] as number) || 0),
				0,
			),
		phaseTimings,
	};
}

// ===== Tests =====

describe("Observability Pure Logic", () => {
	describe("generateTraceId", () => {
		it("should generate 32-character hex string", () => {
			const id = generateTraceId();
			expect(id).toHaveLength(32);
			expect(/^[0-9a-f]+$/.test(id)).toBe(true);
		});

		it("should generate unique IDs", () => {
			const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
			expect(ids.size).toBe(100);
		});
	});

	describe("generateSpanId", () => {
		it("should generate 16-character hex string", () => {
			const id = generateSpanId();
			expect(id).toHaveLength(16);
			expect(/^[0-9a-f]+$/.test(id)).toBe(true);
		});

		it("should generate unique IDs", () => {
			const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
			expect(ids.size).toBe(100);
		});
	});

	describe("Span lifecycle", () => {
		it("should create a root trace", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test_job", { "job.id": "j1" });

			expect(ctx.traceId).toHaveLength(32);
			expect(ctx.spanId).toHaveLength(16);
			expect(storage.activeSpans.size).toBe(1);

			const span = storage.activeSpans.get(ctx.spanId);
			expect(span?.name).toBe("test_job");
			expect(span?.kind).toBe("server");
			expect(span?.status).toBe("unset");
			expect(span?.attributes["job.id"]).toBe("j1");
			expect(span?.attributes["service.name"]).toBe("spec-ralph");
		});

		it("should create a child span", () => {
			const storage = createSpanStorage();
			const parent = storage.startTrace("parent");
			const child = storage.startSpan("child", parent, {
				"step.name": "process",
			});

			expect(child.traceId).toBe(parent.traceId);
			expect(child.spanId).not.toBe(parent.spanId);

			const childSpan = storage.activeSpans.get(child.spanId);
			expect(childSpan?.parentSpanId).toBe(parent.spanId);
			expect(childSpan?.kind).toBe("internal");
			expect(childSpan?.attributes["step.name"]).toBe("process");
		});

		it("should end a span with ok status", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			storage.endSpan(ctx, "ok");

			expect(storage.activeSpans.size).toBe(0);
			expect(storage.completedSpans).toHaveLength(1);

			const span = storage.completedSpans[0];
			expect(span.status).toBe("ok");
			expect(span.endTime).toBeDefined();
			expect(span.endTime ?? 0).toBeGreaterThanOrEqual(span.startTime);
		});

		it("should end a span with error status", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("failing_job");
			storage.endSpan(ctx, "error");

			const span = storage.completedSpans[0];
			expect(span.status).toBe("error");
		});

		it("should merge attributes on end", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			storage.endSpan(ctx, "ok", { "result.code": 0 });

			const span = storage.completedSpans[0];
			expect(span.attributes["result.code"]).toBe(0);
		});

		it("should handle ending non-existent span gracefully", () => {
			const storage = createSpanStorage();
			// Should not throw
			storage.endSpan({ traceId: "fake", spanId: "fake" }, "ok");
			expect(storage.completedSpans).toHaveLength(0);
		});
	});

	describe("Events and attributes", () => {
		it("should add event to active span", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			storage.addSpanEvent(ctx, "phase_started", { phase: "constitution" });

			const span = storage.activeSpans.get(ctx.spanId);
			expect(span?.events).toHaveLength(1);
			expect(span?.events[0].name).toBe("phase_started");
			expect(span?.events[0].attributes?.phase).toBe("constitution");
			expect(span?.events[0].timestamp).toBeGreaterThan(0);
		});

		it("should not add event to completed/missing span", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			storage.endSpan(ctx);
			storage.addSpanEvent(ctx, "late_event");
			// Event should not have been added (span was moved to completed)
			expect(storage.completedSpans[0].events).toHaveLength(0);
		});

		it("should set attributes on active span", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			storage.setSpanAttributes(ctx, { "custom.key": "value", count: 42 });

			const span = storage.activeSpans.get(ctx.spanId);
			expect(span?.attributes["custom.key"]).toBe("value");
			expect(span?.attributes.count).toBe(42);
		});

		it("should merge new attributes with existing ones", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test", { existing: "yes" });
			storage.setSpanAttributes(ctx, { new_attr: true });

			const span = storage.activeSpans.get(ctx.spanId);
			expect(span?.attributes.existing).toBe("yes");
			expect(span?.attributes.new_attr).toBe(true);
		});

		it("should record exception on span", () => {
			const storage = createSpanStorage();
			const ctx = storage.startTrace("test");
			const error = new Error("Something failed");
			storage.recordException(ctx, error);

			const span = storage.activeSpans.get(ctx.spanId);
			expect(span?.status).toBe("error");
			expect(span?.events).toHaveLength(1);
			expect(span?.events[0].name).toBe("exception");
			expect(span?.events[0].attributes?.["exception.message"]).toBe(
				"Something failed",
			);
			expect(span?.events[0].attributes?.["exception.type"]).toBe("Error");
		});
	});

	describe("Trace queries", () => {
		it("should get all spans for a trace", () => {
			const storage = createSpanStorage();
			const parent = storage.startTrace("root");
			const child1 = storage.startSpan("child1", parent);
			const child2 = storage.startSpan("child2", parent);

			storage.endSpan(child1);
			storage.endSpan(child2);
			storage.endSpan(parent);

			const spans = storage.getTraceSpans(parent.traceId);
			expect(spans).toHaveLength(3);
		});

		it("should return empty for unknown trace", () => {
			const storage = createSpanStorage();
			const spans = storage.getTraceSpans("nonexistent");
			expect(spans).toHaveLength(0);
		});

		it("should get recent root traces", () => {
			const storage = createSpanStorage();

			// Create 3 root traces
			const t1 = storage.startTrace("job1");
			storage.endSpan(t1);
			const t2 = storage.startTrace("job2");
			storage.endSpan(t2);
			const t3 = storage.startTrace("job3");
			storage.endSpan(t3);

			const recent = storage.getRecentTraces(2);
			expect(recent).toHaveLength(2);
			// Should be most recent first
			expect(recent[0].name).toBe("job3");
			expect(recent[1].name).toBe("job2");
		});

		it("should exclude child spans from recent traces", () => {
			const storage = createSpanStorage();
			const parent = storage.startTrace("parent");
			const child = storage.startSpan("child", parent);
			storage.endSpan(child);
			storage.endSpan(parent);

			const recent = storage.getRecentTraces();
			expect(recent).toHaveLength(1);
			expect(recent[0].name).toBe("parent");
		});
	});

	describe("Metrics aggregation", () => {
		it("should return zeros for empty spans", () => {
			const metrics = calculateMetrics([]);
			expect(metrics.jobsTotal).toBe(0);
			expect(metrics.jobsCompleted).toBe(0);
			expect(metrics.jobsFailed).toBe(0);
			expect(metrics.avgDurationMs).toBe(0);
			expect(metrics.tokensUsedToday).toBe(0);
		});

		it("should count jobs by status", () => {
			const spans: Span[] = [
				{
					id: "s1",
					traceId: "t1",
					name: "job1",
					kind: "server",
					status: "ok",
					startTime: 1000,
					endTime: 2000,
					attributes: {},
					events: [],
				},
				{
					id: "s2",
					traceId: "t2",
					name: "job2",
					kind: "server",
					status: "error",
					startTime: 1000,
					endTime: 3000,
					attributes: {},
					events: [],
				},
				{
					id: "s3",
					traceId: "t3",
					name: "job3",
					kind: "server",
					status: "ok",
					startTime: 1000,
					endTime: 1500,
					attributes: {},
					events: [],
				},
			];

			const metrics = calculateMetrics(spans);
			expect(metrics.jobsTotal).toBe(3);
			expect(metrics.jobsCompleted).toBe(2);
			expect(metrics.jobsFailed).toBe(1);
		});

		it("should calculate average duration", () => {
			const spans: Span[] = [
				{
					id: "s1",
					traceId: "t1",
					name: "j1",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 1000,
					attributes: {},
					events: [],
				},
				{
					id: "s2",
					traceId: "t2",
					name: "j2",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 3000,
					attributes: {},
					events: [],
				},
			];

			const metrics = calculateMetrics(spans);
			expect(metrics.avgDurationMs).toBe(2000);
		});

		it("should aggregate phase timings", () => {
			const spans: Span[] = [
				{
					id: "s1",
					traceId: "t1",
					name: "spec_kit_phase",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 1000,
					attributes: { "spec.phase": "constitution" },
					events: [],
				},
				{
					id: "s2",
					traceId: "t2",
					name: "spec_kit_phase",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 2000,
					attributes: { "spec.phase": "constitution" },
					events: [],
				},
				{
					id: "s3",
					traceId: "t3",
					name: "spec_kit_phase",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 5000,
					attributes: { "spec.phase": "plan" },
					events: [],
				},
			];

			const metrics = calculateMetrics(spans);
			expect(metrics.phaseTimings.constitution.count).toBe(2);
			expect(metrics.phaseTimings.constitution.totalMs).toBe(3000);
			expect(metrics.phaseTimings.constitution.avgMs).toBe(1500);
			expect(metrics.phaseTimings.plan.count).toBe(1);
			expect(metrics.phaseTimings.plan.avgMs).toBe(5000);
		});

		it("should sum token usage from claude_call spans", () => {
			const spans: Span[] = [
				{
					id: "s1",
					traceId: "t1",
					parentSpanId: "parent1",
					name: "claude_call",
					kind: "internal",
					status: "ok",
					startTime: 0,
					endTime: 1000,
					attributes: { "llm.tokens_total": 5000 },
					events: [],
				},
				{
					id: "s2",
					traceId: "t1",
					parentSpanId: "parent1",
					name: "claude_call",
					kind: "internal",
					status: "ok",
					startTime: 0,
					endTime: 1000,
					attributes: { "llm.tokens_total": 3000 },
					events: [],
				},
				{
					id: "s3",
					traceId: "t1",
					name: "root",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 2000,
					attributes: {},
					events: [],
				},
			];

			const metrics = calculateMetrics(spans);
			expect(metrics.tokensUsedToday).toBe(8000);
		});

		it("should exclude child spans from job counts", () => {
			const spans: Span[] = [
				{
					id: "root",
					traceId: "t1",
					name: "job",
					kind: "server",
					status: "ok",
					startTime: 0,
					endTime: 1000,
					attributes: {},
					events: [],
				},
				{
					id: "child",
					traceId: "t1",
					parentSpanId: "root",
					name: "step",
					kind: "internal",
					status: "ok",
					startTime: 0,
					endTime: 500,
					attributes: {},
					events: [],
				},
			];

			const metrics = calculateMetrics(spans);
			expect(metrics.jobsTotal).toBe(1); // Only root span counted
		});
	});
});
