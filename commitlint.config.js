/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"type-enum": [
			2,
			"always",
			[
				"feat",
				"fix",
				"docs",
				"style",
				"refactor",
				"perf",
				"test",
				"build",
				"ci",
				"chore",
				"revert",
			],
		],
		"subject-empty": [2, "never"],
		"subject-full-stop": [2, "never", "."],
		"subject-case": [2, "always", ["sentence-case", "lower-case", "start-case"]],
		"type-empty": [2, "never"],
		"type-case": [2, "always", "lower-case"],
		"header-max-length": [2, "always", 100],
		"body-leading-blank": [1, "always"],
		"footer-leading-blank": [1, "always"],
	},
};
