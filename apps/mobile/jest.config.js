module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
};
