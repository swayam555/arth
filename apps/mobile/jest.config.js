const critical = [
  "src/features/auth/session.ts",
  "src/features/market/decoder.ts",
  "src/features/market/streamClient.ts",
  "src/features/market/tickStore.ts",
  "src/features/copilot/store.ts",
  "src/features/copilot/historyStore.ts",
  "src/features/copilot/reducer.ts",
  "src/features/copilot/sse.ts",
  "src/features/copilot/markdown.ts",
  "src/features/copilot/Markdown.tsx",
  "src/features/copilot/MessageView.tsx",
  "src/features/copilot/Blocks.tsx",
];

module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  collectCoverageFrom: ["src/features/**/*.{ts,tsx}", "src/data/**/*.ts", "!**/__tests__/**"],
  coverageThreshold: Object.fromEntries(
    critical.map((file) => [`./${file}`, { statements: 75, branches: 60, functions: 50, lines: 80 }]),
  ),
};
