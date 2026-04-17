export default {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          isolatedModules: true,
        },
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "src/agents/**/*.ts",
    "!src/**/*.d.ts",
  ],
  coverageThreshold: {
    "src/agents/answerer.ts": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "src/agents/researcher.ts": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "src/lib/project-store.ts": {
      branches: 40,
      functions: 20,
      lines: 45,
      statements: 45,
    },
  },
};
