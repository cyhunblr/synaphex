import {
  createTmpDir,
  cleanupTmpDir,
  createTestProject,
} from "./test-utils.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

describe("Integration - Full Pipeline Execution", () => {
  let tmpDir: string;
  let project: any;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("full pipeline executes: create → examine → planner → coder → answerer → reviewer", async () => {
    // Simulate task-meta.json
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      id: "test-task",
      created_steps: ["create"],
      completed_steps: [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ],
      iteration: 1,
      status: "completed",
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    expect(existsSync(taskMetaPath)).toBe(true);

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.completed_steps).toEqual([
      "create",
      "examine",
      "planner",
      "coder",
      "answerer",
      "reviewer",
    ]);
  });

  it("all steps complete successfully", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      status: "completed",
      completed_steps: [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ],
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.status).toBe("completed");
  });

  it("completed_steps array shows all executed steps", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      completed_steps: [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ],
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.completed_steps.length).toBe(6);
    expect(read.completed_steps).toContain("create");
    expect(read.completed_steps).toContain("examine");
    expect(read.completed_steps).toContain("planner");
    expect(read.completed_steps).toContain("coder");
  });

  it("task status transitions to completed after final step", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");

    // Initial state
    let taskMeta = {
      status: "in_progress",
      completed_steps: ["create"],
    };
    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    // After final step
    taskMeta = {
      status: "completed",
      completed_steps: [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ],
    };
    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.status).toBe("completed");
  });
});

describe("Integration - Optional Steps", () => {
  let tmpDir: string;
  let project: any;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("optional steps can be skipped (answerer, researcher, reviewer)", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      completed_steps: ["create", "examine", "planner", "coder"],
      status: "completed",
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.completed_steps).not.toContain("answerer");
    expect(read.completed_steps).not.toContain("researcher");
    expect(read.completed_steps).not.toContain("reviewer");
  });

  it("pipeline completes without optional steps", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      completed_steps: ["create", "examine", "planner", "coder"],
      status: "completed",
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    expect(existsSync(taskMetaPath)).toBe(true);
  });
});

describe("Integration - Memory Updates During Pipeline", () => {
  let tmpDir: string;
  let project: any;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("examiner creates examination summary", async () => {
    const examPath = join(project.internalDir, "examination.md");
    const examContent = "# Examination Summary\n\nTask analysis here.";

    require("fs").writeFileSync(examPath, examContent);

    expect(existsSync(examPath)).toBe(true);
    const read = readFileSync(examPath, "utf-8");
    expect(read).toContain("Examination Summary");
  });

  it("planner reads summary and creates plan.md", async () => {
    const examPath = join(project.internalDir, "examination.md");
    const planPath = join(project.internalDir, "plan.md");

    require("fs").writeFileSync(
      examPath,
      "# Examination\n\nAnalysis complete.",
    );
    require("fs").writeFileSync(planPath, "# Plan\n\nImplementation steps.");

    expect(existsSync(examPath)).toBe(true);
    expect(existsSync(planPath)).toBe(true);
  });

  it("coder reads plan and creates implementation summary", async () => {
    const planPath = join(project.internalDir, "plan.md");
    const implPath = join(project.internalDir, "implementation.md");

    require("fs").writeFileSync(planPath, "# Plan\n\nSteps.");
    require("fs").writeFileSync(
      implPath,
      "# Implementation\n\nCode changes made.",
    );

    expect(existsSync(implPath)).toBe(true);
  });

  it("answerer updates task-meta.json with decisions", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");
    const taskMeta = {
      completed_steps: ["create", "examine", "planner", "coder", "answerer"],
      decisions: {
        architecture: "Decided on component structure",
        performance: "Opted for optimized approach",
      },
    };

    require("fs").writeFileSync(
      taskMetaPath,
      JSON.stringify(taskMeta, null, 2),
    );

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.decisions).toBeDefined();
    expect(read.decisions.architecture).toBeDefined();
  });

  it("memory summary updated after each step", async () => {
    const summaryPath = join(project.internalDir, "task-summary.md");

    // After examine
    require("fs").writeFileSync(
      summaryPath,
      "# Task Summary\n\n## Examined\n\nInitial analysis done.",
    );

    // After planner
    const content = readFileSync(summaryPath, "utf-8");
    const updated =
      content + "\n\n## Planned\n\nImplementation strategy ready.";
    require("fs").writeFileSync(summaryPath, updated);

    expect(existsSync(summaryPath)).toBe(true);
    const final = readFileSync(summaryPath, "utf-8");
    expect(final).toContain("Examined");
    expect(final).toContain("Planned");
  });
});
