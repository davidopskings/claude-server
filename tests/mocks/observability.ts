/**
 * Mock Observability module for testing
 * All functions are no-ops that track calls for assertions
 */

import type { TraceContext } from "../../src/observability/index.js";

let traceCount = 0;
let events: Array<{
	fn: string;
	args: Record<string, unknown>;
}> = [];

export function resetMockObservability(): void {
	traceCount = 0;
	events = [];
}

export function getObservabilityEvents(): typeof events {
	return events;
}

export function startTrace(
	name: string,
	attributes: Record<string, string | number | boolean> = {},
): TraceContext {
	traceCount++;
	events.push({ fn: "startTrace", args: { name, attributes } });
	return {
		traceId: `trace-${traceCount}`,
		spanId: `span-${traceCount}`,
	};
}

export function endSpan(
	context: TraceContext,
	status: "ok" | "error" = "ok",
	_attributes?: Record<string, string | number | boolean>,
): void {
	events.push({ fn: "endSpan", args: { context, status } });
}

export function addSpanEvent(
	context: TraceContext,
	name: string,
	_attributes?: Record<string, string | number | boolean>,
): void {
	events.push({ fn: "addSpanEvent", args: { context, name } });
}

export function setSpanAttributes(
	context: TraceContext,
	attributes: Record<string, string | number | boolean>,
): void {
	events.push({ fn: "setSpanAttributes", args: { context, attributes } });
}

export function recordException(context: TraceContext, error: Error): void {
	events.push({
		fn: "recordException",
		args: { context, errorMessage: error.message },
	});
}
