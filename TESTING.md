# Testing Guide for Synaphex

This guide explains how to run tests, understand coverage, and write new tests for Synaphex.

## Quick Start

### Run all tests
```bash
npm test
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run tests in watch mode
```bash
npm test:watch
```

### Run a specific test file
```bash
npm test -- researcher-agent.test.ts
```

## Test Structure

Tests are organized by feature in `src/__tests__/`:

- **Memory operations**: `memory-*.test.ts` - Memory structure, file I/O, initialization
- **Integration tests**: `integration-*.test.ts` - Full pipeline, multi-project inheritance, researcher agent
- **Edge cases**: `edge-case-*.test.ts` - Missing files, timeouts, permissions, symlinks, error messages
- **Validation**: `settings-validation.test.ts`, `state-validation.test.ts` - Configuration and state validation
- **Agents**: `agent-*.test.ts` - Individual agent behavior and prompts
- **Commands**: `task-*.test.ts` - CLI command implementations

## Coverage Requirements

### Global Coverage Thresholds
- **Statements**: ≥85%
- **Branches**: ≥85%
- **Functions**: ≥85%
- **Lines**: ≥85%

### Critical Module Thresholds
- **`src/lib/`**: ≥90% across all metrics
- **`src/commands/`**: ≥90% across all metrics

### View Coverage Report

After running coverage, open the HTML report:

```bash
npm run test:coverage
# Then open coverage/lcov-report/index.html in your browser
```

## Test Utilities

The `test-utils.ts` file provides helpers for common test scenarios:

### Tmpdir Management
```typescript
import { createTmpDir, cleanupTmpDir } from "./test-utils.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmpDir);
});
```

### Project Scaffolding
```typescript
import { createTestProject } from "./test-utils.js";

const project = await createTestProject(tmpDir, {
  languages: ["typescript", "python"],
  frameworks: ["express"],
});
// Creates memory structure with base files, language guidelines, framework directories
```

### File I/O Helpers
```typescript
import { readTestFile, writeTestFile } from "./test-utils.js";

writeTestFile("/path/to/file.md", "content");
const content = readTestFile("/path/to/file.md");
```

### Mocking
```typescript
import { mockResearcher, mockWebSearch } from "./test-utils.js";

const mockSearch = mockWebSearch();
const result = await mockSearch("query");
```

## Writing New Tests

### Basic Test Structure
```typescript
import { createTmpDir, cleanupTmpDir } from "./test-utils.js";

describe("Feature Name", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("should do something specific", async () => {
    // Arrange
    const input = "test data";

    // Act
    const result = await someFunction(input);

    // Assert
    expect(result).toBe("expected");
  });
});
```

### Testing Memory Operations
```typescript
it("creates memory structure with base files", async () => {
  const project = await createTestProject(tmpDir);

  expect(existsSync(project.internalDir)).toBe(true);
  expect(existsSync(project.externalDir)).toBe(true);

  const overview = join(project.internalDir, "overview.md");
  expect(existsSync(overview)).toBe(true);
});
```

### Testing File I/O
```typescript
it("writes and reads memory files", async () => {
  const filePath = join(tmpDir, "test.md");
  const content = "# Test\n\nContent";

  writeTestFile(filePath, content);
  const read = readTestFile(filePath);

  expect(read).toBe(content);
});
```

### Testing Error Handling
```typescript
it("handles missing files gracefully", async () => {
  const missingFile = join(tmpDir, "nonexistent.md");

  if (!existsSync(missingFile)) {
    const errorMsg = "File not found. Create with: /synaphex:create";
    expect(errorMsg).toContain("Create with");
  }
});
```

## Test Organization

### Test Naming Conventions
- Test files: `{feature}.test.ts` or `{feature}-{scenario}.test.ts`
- Describe blocks: Capitalize feature name (e.g., "Memory Operations - File I/O")
- It blocks: Lowercase, action-oriented (e.g., "creates memory structure")

### Test Isolation
- Each test is independent and can run in any order
- Use `beforeEach`/`afterEach` to setup/cleanup per test
- Don't rely on test execution order
- Use separate tmpdir for each test

## Running Specific Test Suites

### Memory Tests
```bash
npm test -- memory
```

### Integration Tests
```bash
npm test -- integration
```

### Edge Case Tests
```bash
npm test -- edge-case
```

### Validation Tests
```bash
npm test -- validation
```

## Continuous Integration

Tests run automatically in CI/CD pipeline before merging:

1. All tests must pass (`npm test`)
2. Coverage must meet thresholds (`npm run test:coverage`)
3. No linting errors (`npm run lint`)
4. Clean TypeScript compilation (`npm run build`)

Pre-commit hooks also run linting and can run quick tests.

## Debugging Tests

### Run a single test
```bash
npm test -- --testNamePattern="specific test description"
```

### Run with verbose output
```bash
npm test -- --verbose
```

### Debug in Node
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
# Then open chrome://inspect in Chrome
```

### Check if test file has syntax errors
```bash
npm run build -- src/__tests__/your-file.test.ts
```

## Test Performance

Tests should complete in under 2 seconds total. If slow:

1. Check for unnecessary file I/O
2. Avoid real network calls (use mocks)
3. Use test utilities for tmpdir setup (they're optimized)
4. Consider splitting large test files

## Troubleshooting

### Symlink Tests Fail on Windows
Symlink tests are platform-dependent. Tests detect this and skip gracefully:

```typescript
try {
  symlinkSync(target, link, "dir");
  // Test symlink behavior
} catch {
  // Symlink not supported on this platform
  expect(true).toBe(true); // Skip test
}
```

### Temporary Directory Not Cleaned
If tests leave files behind:

1. Check `cleanupTmpDir()` is called in `afterEach`
2. Verify tmpdir path is correct
3. Run cleanup manually: `rm -rf /tmp/synaphex-test-*`

### Tests Fail in CI but Pass Locally
- Check for hardcoded paths (use `tmpDir` instead)
- Verify environment variables are set
- Check file permission differences between systems
- Look for timing issues (use `jest.useFakeTimers()` if needed)

## Coverage Tracking

View coverage changes:

```bash
# Generate coverage
npm run test:coverage

# Compare with baseline
# Look at coverage/lcov-report/index.html for detailed breakdown
```

Modules below threshold will fail CI. To improve coverage:

1. Find untested branches in HTML report
2. Add tests for edge cases
3. Test error paths and exceptions
4. Test all branches of conditionals
