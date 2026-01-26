/**
 * Unit tests for per-client constitution feature
 * Tests constitution storage, retrieval, and spec runner reuse logic
 */

import { describe, expect, it } from "bun:test";

describe("Client Constitution Logic", () => {
	// Test the constitution reuse decision logic
	function shouldUseExistingConstitution(
		specPhase: string,
		forceRegenerate: boolean,
		existingConstitution: string | null,
	): boolean {
		if (specPhase !== "constitution") return false;
		if (forceRegenerate) return false;
		return existingConstitution !== null;
	}

	describe("constitution reuse decision", () => {
		it("should use existing constitution when available and not forcing regenerate", () => {
			const result = shouldUseExistingConstitution(
				"constitution",
				false,
				"# Coding Standards\n...",
			);
			expect(result).toBe(true);
		});

		it("should not use existing when forceRegenerate is true", () => {
			const result = shouldUseExistingConstitution(
				"constitution",
				true,
				"# Coding Standards\n...",
			);
			expect(result).toBe(false);
		});

		it("should not use existing when no constitution exists", () => {
			const result = shouldUseExistingConstitution("constitution", false, null);
			expect(result).toBe(false);
		});

		it("should not apply to non-constitution phases", () => {
			const result = shouldUseExistingConstitution(
				"specify",
				false,
				"# Coding Standards\n...",
			);
			expect(result).toBe(false);
		});
	});
});

describe("Constitution Data Shape", () => {
	interface ClientConstitution {
		constitution: string;
		generatedAt: string;
	}

	function validateConstitution(data: unknown): data is ClientConstitution {
		if (typeof data !== "object" || data === null) return false;
		const obj = data as Record<string, unknown>;
		return (
			typeof obj.constitution === "string" &&
			typeof obj.generatedAt === "string"
		);
	}

	it("should validate correct constitution shape", () => {
		const valid: ClientConstitution = {
			constitution: "# Coding Standards\n- Use TypeScript strict mode",
			generatedAt: "2026-01-23T10:00:00.000Z",
		};
		expect(validateConstitution(valid)).toBe(true);
	});

	it("should reject missing constitution", () => {
		const invalid = { generatedAt: "2026-01-23T10:00:00.000Z" };
		expect(validateConstitution(invalid)).toBe(false);
	});

	it("should reject missing generatedAt", () => {
		const invalid = { constitution: "# Standards" };
		expect(validateConstitution(invalid)).toBe(false);
	});

	it("should reject null", () => {
		expect(validateConstitution(null)).toBe(false);
	});
});

describe("Spec Job with forceRegenerate", () => {
	// Test extracting forceRegenerate from spec_output
	function getForceRegenerate(
		specOutput: Record<string, unknown> | null,
	): boolean {
		return (
			(specOutput as { forceRegenerate?: boolean } | null)?.forceRegenerate ===
			true
		);
	}

	it("should return true when forceRegenerate is true", () => {
		expect(getForceRegenerate({ forceRegenerate: true })).toBe(true);
	});

	it("should return false when forceRegenerate is false", () => {
		expect(getForceRegenerate({ forceRegenerate: false })).toBe(false);
	});

	it("should return false when forceRegenerate is not set", () => {
		expect(getForceRegenerate({})).toBe(false);
	});

	it("should return false when spec_output is null", () => {
		expect(getForceRegenerate(null)).toBe(false);
	});

	it("should return false for other truthy values", () => {
		expect(getForceRegenerate({ forceRegenerate: "yes" as unknown })).toBe(
			false,
		);
		expect(getForceRegenerate({ forceRegenerate: 1 as unknown })).toBe(false);
	});
});
