export const COSMETIC_FEATURE_TYPE_ID =
	"acd9cd67-b58f-4cdf-b588-b386d812f69c" as const;

/**
 * Check if a feature is a cosmetic change request based on its feature_type_id.
 */
export function isCosmeticFeature(
	featureTypeId: string | null | undefined,
): boolean {
	return featureTypeId === COSMETIC_FEATURE_TYPE_ID;
}
