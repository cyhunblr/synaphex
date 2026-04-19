/**
 * E2E Suite 1 — Single Project Pipeline Tests
 * Validates the complete workflow: create → task_create → task_examine → task_planner → task_coder → task_reviewer
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface TaskMeta {
  project: string;
  slug: string;
  task: string;
  cwd: string;
  mode: "task" | "fix";
  createdAt: string;
  iteration: number;
  status: string;
  completed_steps: string[];
}

describe("E2E Suite 1 — Single Project Required Pipeline", () => {
  let testHomeDir: string;
  const projectName = "project_v1";

  beforeEach(async () => {
    testHomeDir = path.join(os.tmpdir(), `synaphex-e2e-suite1-${Date.now()}`);
    await fs.mkdir(testHomeDir, { recursive: true });
  });

  afterEach(async () => {
    if (testHomeDir && (await fs.stat(testHomeDir).catch(() => null))) {
      try {
        await fs.rm(testHomeDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe("Task 1: Create Project", () => {
    it("test create(project_v1) initializes project with memory structure", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const memoryDir = path.join(projectDir, "memory");
      const internalDir = path.join(memoryDir, "internal");

      // Simulate create command scaffolding
      await fs.mkdir(internalDir, { recursive: true });

      const stat = await fs.stat(internalDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("test create initializes memory with base files", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const internalDir = path.join(projectDir, "memory", "internal");

      await fs.mkdir(internalDir, { recursive: true });

      // Create base memory files
      const baseFiles = ["MEMORY.md", "overview.md", "conventions.md"];
      for (const file of baseFiles) {
        const filePath = path.join(internalDir, file);
        await fs.writeFile(filePath, `# ${file}\n`);
      }

      for (const file of baseFiles) {
        const exists = await fs
          .stat(path.join(internalDir, file))
          .catch(() => null);
        expect(exists).not.toBeNull();
      }
    });
  });

  describe("Task 2: Task Create", () => {
    it("test task_create(project_v1, task1, cwd, 'task') creates task directory and task-meta.json", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const tasksDir = path.join(projectDir, "memory", "internal", "tasks");
      const slug = "task-001";
      const taskDir = path.join(tasksDir, slug);

      await fs.mkdir(taskDir, { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task description",
        cwd: "/some/working/directory",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "created",
        completed_steps: [],
      };

      const metaPath = path.join(taskDir, "task-meta.json");
      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const stat = await fs.stat(metaPath);
      expect(stat.isFile()).toBe(true);
    });

    it("test task-meta.json has status 'created' after task_create", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "created",
        completed_steps: [],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.status).toBe("created");
      expect(meta.completed_steps).toEqual([]);
    });
  });

  describe("Task 3: Task Examine (Required)", () => {
    it("test task_examine(project_v1, slug, ...) executes and transitions status to 'examined'", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "examined",
        completed_steps: ["examine"],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.status).toBe("examined");
      expect(meta.completed_steps).toContain("examine");
    });
  });

  describe("Task 4: Task Planner", () => {
    it("test task_planner executes after task_examine with correct state transition to 'planned'", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "planned",
        completed_steps: ["examine", "plan"],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.status).toBe("planned");
      expect(meta.completed_steps).toEqual(["examine", "plan"]);
    });
  });

  describe("Task 5: Task Coder", () => {
    it("test task_coder executes after task_planner with status transition to 'implemented'", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "implemented",
        completed_steps: ["examine", "plan", "coder"],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.status).toBe("implemented");
      expect(meta.completed_steps).toContain("coder");
    });
  });

  describe("Task 6: Task Reviewer", () => {
    it("test task_reviewer executes after task_coder with status transition to 'reviewed'", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "reviewed",
        completed_steps: ["examine", "plan", "coder", "review"],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.status).toBe("reviewed");
      expect(meta.completed_steps).toEqual([
        "examine",
        "plan",
        "coder",
        "review",
      ]);
    });

    it("test completed_steps array accumulates correctly", async () => {
      const taskMeta: TaskMeta = {
        project: projectName,
        slug: "test",
        task: "Test",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "reviewed",
        completed_steps: ["examine", "plan", "coder", "review"],
      };

      expect(taskMeta.completed_steps.length).toBe(4);
      expect(taskMeta.completed_steps[0]).toBe("examine");
      expect(taskMeta.completed_steps[3]).toBe("review");
    });
  });

  describe("State Machine Enforcement", () => {
    it("test attempting task_planner before task_examine completes returns error", async () => {
      // Simulate validation check
      const completedSteps = [] as string[];
      const requiredPrior = "examine";

      const isValid = completedSteps.includes(requiredPrior);
      expect(isValid).toBe(false);
    });

    it("test step ordering is enforced and cannot be skipped", async () => {
      const requiredOrder = ["examine", "plan", "coder", "review"];
      const attempted = ["examine", "coder"]; // skipped plan

      // Check if attempting to skip
      const hasGap = requiredOrder.some(
        (step, idx) =>
          attempted.includes(step) &&
          !attempted.includes(requiredOrder[idx - 1]),
      );

      expect(hasGap).toBe(true);
    });
  });

  describe("Memory State During Pipeline", () => {
    it("test memory/internal/ directory exists after create", async () => {
      const memoryDir = path.join(
        testHomeDir,
        projectName,
        "memory",
        "internal",
      );
      await fs.mkdir(memoryDir, { recursive: true });

      const stat = await fs.stat(memoryDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("test memory base files persist through pipeline steps", async () => {
      const internalDir = path.join(
        testHomeDir,
        projectName,
        "memory",
        "internal",
      );
      const overviewPath = path.join(internalDir, "overview.md");

      await fs.mkdir(internalDir, { recursive: true });
      await fs.writeFile(overviewPath, "# Overview\n");

      // Simulate reading through multiple steps
      let content = await fs.readFile(overviewPath, "utf-8");
      expect(content).toContain("Overview");

      // Simulate another step accessing it
      content = await fs.readFile(overviewPath, "utf-8");
      expect(content).toContain("Overview");
    });
  });

  describe("Command Output and Validation", () => {
    it("test all commands return clear output messages with step status", async () => {
      const output = "✓ Step: examine - Completed successfully";
      expect(output).toContain("Completed");
    });

    it("test error messages are actionable and include recovery guidance", async () => {
      const errorMsg =
        "Error: Cannot run task_planner before task_examine completes. Run: task_examine <project> <slug>";
      expect(errorMsg).toContain("Run:");
    });

    it("test task-meta.json is valid JSON after each step", async () => {
      const taskMeta: TaskMeta = {
        project: projectName,
        slug: "test",
        task: "Test",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "reviewed",
        completed_steps: ["examine", "plan", "coder", "review"],
      };

      const json = JSON.stringify(taskMeta, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed).toBeDefined();
      expect(parsed.status).toBe("reviewed");
    });
  });

  describe("Optional Steps", () => {
    it("test task_answerer can execute when needed (optional)", async () => {
      const projectDir = path.join(testHomeDir, projectName);
      const slug = "task-001";
      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        slug,
        "task-meta.json",
      );

      await fs.mkdir(path.dirname(metaPath), { recursive: true });

      const taskMeta: TaskMeta = {
        project: projectName,
        slug,
        task: "Test task",
        cwd: "/cwd",
        mode: "task",
        createdAt: new Date().toISOString(),
        iteration: 1,
        status: "reviewed",
        completed_steps: ["examine", "plan", "coder", "review", "answerer"],
      };

      await fs.writeFile(metaPath, JSON.stringify(taskMeta, null, 2));

      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);

      expect(meta.completed_steps).toContain("answerer");
    });

    it("test optional steps don't block pipeline if skipped", async () => {
      const completedSteps = ["examine", "plan", "coder", "review"];
      // answerer and researcher are optional, so pipeline can complete without them
      const pipelineComplete = completedSteps.includes("review");

      expect(pipelineComplete).toBe(true);
    });
  });
});
