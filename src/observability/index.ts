/**
 * Observability with OpenTelemetry
 *
 * Full tracing across the entire spec-ralph pipeline.
 * Tracks job execution, phase timing, token usage, and errors.
 */

// Note: This is a lightweight implementation that works without OpenTelemetry dependencies.
// For full OpenTelemetry integration, install @opentelemetry/api and configure exporters.

export interface Span {
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

export interface SpanEvent {
	name: string;
	timestamp: number;
	attributes?: Record<string, string | number | boolean>;
}

export interface TraceContext {
	traceId: string;
	spanId: string;
}

// In-memory span storage (for development/debugging)
const activeSpans = new Map<string, Span>();
const completedSpans: Span[] = [];

/**
 * Generate a random trace ID
 */
function generateTraceId(): string {
	return Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

/**
 * Generate a random span ID
 */
function generateSpanId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

/**
 * Start a new trace
 */
export function startTrace(
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

/**
 * Start a child span
 */
export function startSpan(
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

/**
 * End a span
 */
export function endSpan(
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

	// Keep only last 1000 spans in memory
	if (completedSpans.length > 1000) {
		completedSpans.splice(0, completedSpans.length - 1000);
	}

	// Log span for debugging
	const duration = span.endTime - span.startTime;
	console.log(`[TRACE] ${span.name} - ${duration}ms - ${status}`);
}

/**
 * Add an event to a span
 */
export function addSpanEvent(
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

/**
 * Set span attributes
 */
export function setSpanAttributes(
	context: TraceContext,
	attributes: Record<string, string | number | boolean>,
): void {
	const span = activeSpans.get(context.spanId);
	if (!span) return;

	span.attributes = { ...span.attributes, ...attributes };
}

/**
 * Record an exception on a span
 */
export function recordException(context: TraceContext, error: Error): void {
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

/**
 * Get all completed spans for a trace
 */
export function getTraceSpans(traceId: string): Span[] {
	return completedSpans.filter((s) => s.traceId === traceId);
}

/**
 * Get recent traces (last N completed root spans)
 */
export function getRecentTraces(limit = 20): Span[] {
	return completedSpans
		.filter((s) => !s.parentSpanId)
		.slice(-limit)
		.reverse();
}

// ===== High-level tracing functions for spec-ralph =====

/**
 * Trace a spec-kit job execution
 */
export async function traceSpecJob<T>(
	jobId: string,
	phase: string,
	fn: (context: TraceContext) => Promise<T>,
): Promise<T> {
	const context = startTrace("spec_kit_phase", {
		"spec.phase": phase,
		"job.id": jobId,
	});

	try {
		const result = await fn(context);
		endSpan(context, "ok");
		return result;
	} catch (error) {
		recordException(context, error as Error);
		endSpan(context, "error");
		throw error;
	}
}

/**
 * Trace a Ralph iteration
 */
export async function traceRalphIteration<T>(
	jobId: string,
	iteration: number,
	fn: (context: TraceContext) => Promise<T>,
): Promise<T> {
	const context = startTrace("ralph_iteration", {
		"ralph.iteration": iteration,
		"job.id": jobId,
	});

	try {
		const result = await fn(context);
		endSpan(context, "ok");
		return result;
	} catch (error) {
		recordException(context, error as Error);
		endSpan(context, "error");
		throw error;
	}
}

/**
 * Trace a Claude API call
 */
export async function traceClaudeCall<T>(
	parentContext: TraceContext,
	model: string,
	fn: () => Promise<
		T & { usage?: { input_tokens: number; output_tokens: number } }
	>,
): Promise<T> {
	const context = startSpan("claude_call", parentContext, {
		"llm.model": model,
	});

	try {
		const result = await fn();

		// Record token usage if available
		if (result.usage) {
			setSpanAttributes(context, {
				"llm.tokens_in": result.usage.input_tokens,
				"llm.tokens_out": result.usage.output_tokens,
				"llm.tokens_total":
					result.usage.input_tokens + result.usage.output_tokens,
			});
		}

		endSpan(context, "ok");
		return result;
	} catch (error) {
		recordException(context, error as Error);
		endSpan(context, "error");
		throw error;
	}
}

/**
 * Trace a database query
 */
export async function traceDbQuery<T>(
	parentContext: TraceContext,
	operation: string,
	table: string,
	fn: () => Promise<T>,
): Promise<T> {
	const context = startSpan("db_query", parentContext, {
		"db.operation": operation,
		"db.table": table,
	});

	try {
		const result = await fn();
		endSpan(context, "ok");
		return result;
	} catch (error) {
		recordException(context, error as Error);
		endSpan(context, "error");
		throw error;
	}
}

/**
 * Trace a git operation
 */
export async function traceGitOp<T>(
	parentContext: TraceContext,
	operation: string,
	fn: () => Promise<T>,
): Promise<T> {
	const context = startSpan("git_operation", parentContext, {
		"git.operation": operation,
	});

	try {
		const result = await fn();
		endSpan(context, "ok");
		return result;
	} catch (error) {
		recordException(context, error as Error);
		endSpan(context, "error");
		throw error;
	}
}

// ===== Metrics =====

interface Metrics {
	jobsTotal: number;
	jobsCompleted: number;
	jobsFailed: number;
	avgDurationMs: number;
	tokensUsedToday: number;
	phaseTimings: Record<
		string,
		{ count: number; totalMs: number; avgMs: number }
	>;
}

let metricsCache: Metrics | null = null;
let metricsCacheTime = 0;
const METRICS_CACHE_TTL = 60000; // 1 minute

/**
 * Get current metrics
 */
export async function getMetrics(): Promise<Metrics> {
	const now = Date.now();

	// Return cached metrics if fresh
	if (metricsCache && now - metricsCacheTime < METRICS_CACHE_TTL) {
		return metricsCache;
	}

	// Calculate metrics from completed spans
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

	// Calculate overall metrics
	const rootSpans = completedSpans.filter((s) => !s.parentSpanId);
	const totalDuration = rootSpans.reduce(
		(sum, s) => sum + ((s.endTime || Date.now()) - s.startTime),
		0,
	);

	metricsCache = {
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

	metricsCacheTime = now;
	return metricsCache;
}

/**
 * Export traces in a simple JSON format
 */
export function exportTraces(): { traces: Span[]; metrics: Metrics } {
	return {
		traces: completedSpans,
		metrics: metricsCache || {
			jobsTotal: 0,
			jobsCompleted: 0,
			jobsFailed: 0,
			avgDurationMs: 0,
			tokensUsedToday: 0,
			phaseTimings: {},
		},
	};
}
