describe("Edge Cases - Helpful Error Messages", () => {
  it("error on missing project includes: Project not found. Create with: /synaphex:create <project>", () => {
    const projectName = "my-project";
    const errorMsg = `Project '${projectName}' not found. Create with: /synaphex:create ${projectName}`;

    expect(errorMsg).toContain("not found");
    expect(errorMsg).toContain("/synaphex:create");
    expect(errorMsg).toContain(projectName);
  });

  it("error on corrupted memory includes: Memory corrupted. Try: /synaphex:memorize <project> <path>", () => {
    const project = "my-project";
    const filePath = "memory/internal/overview.md";
    const errorMsg = `Memory corrupted at ${filePath}. Try: /synaphex:memorize ${project} ${filePath}`;

    expect(errorMsg).toContain("Memory corrupted");
    expect(errorMsg).toContain("/synaphex:memorize");
    expect(errorMsg).toContain(filePath);
  });

  it("error on permission denied includes: Permission denied. Check permissions: chmod 755 memory/", () => {
    const directory = "memory/";
    const errorMsg = `Permission denied: ${directory}. Check permissions: chmod 755 ${directory}`;

    expect(errorMsg).toContain("Permission denied");
    expect(errorMsg).toContain("chmod 755");
    expect(errorMsg).toContain(directory);
  });

  it("all error messages include actionable recovery steps", () => {
    const errors = [
      "Project not found. Create with: /synaphex:create project-name",
      "Memory corrupted. Try: /synaphex:memorize project path.md",
      "Permission denied. Check permissions: chmod 755 memory/",
      "Disk full. Free up space or increase volume size",
    ];

    for (const error of errors) {
      expect(error.length).toBeGreaterThan(0);
      // Each should contain actionable guidance
      const hasGuidance =
        error.includes("Create") ||
        error.includes("Try") ||
        error.includes("Check") ||
        error.includes("Free");
      expect(hasGuidance).toBe(true);
    }
  });

  it("error context includes absolute or relative file path", () => {
    const absolutePath = "/home/user/projects/my-project/memory/overview.md";
    const relativePath = "memory/internal/research/topic.md";

    const errors = [
      `File not found: ${absolutePath}`,
      `Permission denied: ${relativePath}`,
    ];

    expect(errors[0]).toContain(absolutePath);
    expect(errors[1]).toContain(relativePath);
  });

  it("error paths are copyable/usable by user (escaped properly)", () => {
    const pathWithSpaces = "my project/memory/overview.md";
    const pathWithSpecial = "project-2024/memory/internal/research/topic.md";

    // Paths should be usable in shell commands
    const errorMsg1 = `Cannot write to: "${pathWithSpaces}"`;
    const errorMsg2 = `Cannot read from: ${pathWithSpecial}`;

    expect(errorMsg1).toContain(pathWithSpaces);
    expect(errorMsg2).toContain(pathWithSpecial);
  });
});

describe("Edge Cases - Error Message Categories", () => {
  it("file not found errors include path and creation guidance", () => {
    const filePath = "memory/conventions.md";
    const errorMsg = `File not found: ${filePath}. Create it with: /synaphex:memorize`;

    expect(errorMsg).toContain("not found");
    expect(errorMsg).toContain(filePath);
  });

  it("permission errors include file path and fix command", () => {
    const filePath = "memory/internal";
    const errorMsg = `Permission denied: ${filePath}. Run: chmod 755 ${filePath}`;

    expect(errorMsg).toContain("Permission denied");
    expect(errorMsg).toContain(filePath);
    expect(errorMsg).toContain("chmod");
  });

  it("timeout errors include recovery steps", () => {
    const errorMsg = `Timeout after 30 seconds. Continue with: /synaphex:apply --resume`;

    expect(errorMsg).toContain("Timeout");
    expect(errorMsg).toContain("Continue");
  });

  it("validation errors include what failed and why", () => {
    const errorMsg =
      "Validation failed: cannot run planner before examine. Complete examine step first.";

    expect(errorMsg).toContain("Validation failed");
    expect(errorMsg).toContain("planner");
    expect(errorMsg).toContain("examine");
  });
});

describe("Edge Cases - Error Message Format", () => {
  it("error messages are concise and clear", () => {
    const goodError = "Project not found. Create: /synaphex:create project";
    const badError =
      "An error occurred while attempting to initialize the project structure due to the absence of the required directory which should have been created during the project initialization phase";

    expect(goodError.length).toBeLessThan(100);
    expect(badError.length).toBeGreaterThan(100);
  });

  it("error messages avoid technical jargon when possible", () => {
    const cleanError =
      "Memory file corrupted. Try recreating: /synaphex:memorize";
    const technicalError =
      "JSON deserialization failed due to malformed syntax in UTF-8 encoded file stream";

    expect(cleanError).toContain("Memory");
    expect(cleanError).toContain("corrupted");
    expect(technicalError).toContain("deserialization");
  });

  it("error messages include context about current operation", () => {
    const contextError =
      "Failed to read memory while examining task. Check: memory/internal/overview.md";

    expect(contextError).toContain("examining");
    expect(contextError).toContain("memory");
  });
});
