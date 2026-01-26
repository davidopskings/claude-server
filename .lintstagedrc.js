/** @type {import('lint-staged').Config} */
export default {
	// TypeScript files - run Biome check and typecheck
	"*.ts": ["biome check --write --no-errors-on-unmatched"],

	// JSON files - run Biome format only
	"*.json": ["biome format --write --no-errors-on-unmatched"],
};
