import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../domain/agent-invocation.js";
import {
  CodexCliExecutionError,
  type CodexCliExecutionFailureReason,
} from "../domain/errors.js";
import type { RoleContractSnapshot } from "../domain/agent-context.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
  type ProcessResult,
} from "../infrastructure/process-runner.js";
import { AgentPromptSerializer } from "./agent-prompt-serializer.js";
import { AgentResultJsonSchemaBuilder } from "./agent-result-json-schema-builder.js";

export interface CodexCliAgentExecutorOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export type CodexSandbox = "read-only" | "workspace-write";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;

export class CodexCliAgentExecutor implements AgentExecutor {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly promptSerializer = new AgentPromptSerializer();
  private readonly schemaBuilder = new AgentResultJsonSchemaBuilder();

  constructor(options: CodexCliAgentExecutorOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "codex";
    this.timeoutMs = positiveDuration(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    );
    this.terminationGraceMs = positiveDuration(
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      "terminationGraceMs",
    );
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    assertSupportedRoute(input);
    await assertWorkspace(input.context.project.sourcePath);

    let temporaryDirectory: string | undefined;
    try {
      temporaryDirectory = await mkdtemp(
        join(tmpdir(), "synaphex-codex-exec-"),
      );
      await chmod(temporaryDirectory, 0o700);
      const schemaPath = join(temporaryDirectory, "agent-result.schema.json");
      const resultPath = join(temporaryDirectory, "agent-result.json");
      const schema = this.schemaBuilder.build(input.context);
      await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const prompt = this.promptSerializer.serialize(input.context);
      const sandbox = resolveCodexSandbox(input.context.roleContract);
      const processResult = await this.runCodex(
        input,
        schemaPath,
        resultPath,
        sandbox,
        prompt,
      );
      assertSuccessfulProcess(processResult);
      return await readProviderResult(resultPath);
    } catch (error) {
      if (error instanceof CodexCliExecutionError) {
        throw error;
      }
      throw new CodexCliExecutionError("temporary_io", {}, { cause: error });
    } finally {
      if (temporaryDirectory !== undefined) {
        await cleanupTemporaryDirectory(temporaryDirectory);
      }
    }
  }

  private async runCodex(
    input: AgentExecutionInput,
    schemaPath: string,
    resultPath: string,
    sandbox: CodexSandbox,
    prompt: string,
  ): Promise<ProcessResult> {
    try {
      return await this.runner.run({
        executable: this.executable,
        args: [
          "exec",
          "--ephemeral",
          "--model",
          input.route.model,
          "--cd",
          input.context.project.sourcePath,
          "--sandbox",
          sandbox,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          resultPath,
          "--color",
          "never",
          "-",
        ],
        stdin: prompt,
        timeoutMs: this.timeoutMs,
        terminationGraceMs: this.terminationGraceMs,
      });
    } catch (error) {
      throw new CodexCliExecutionError("spawn_failed", {}, { cause: error });
    }
  }
}

async function cleanupTemporaryDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    throw new CodexCliExecutionError(
      "temporary_io",
      { phase: "cleanup" },
      { cause: error },
    );
  }
}

export function resolveCodexSandbox(
  contract: RoleContractSnapshot,
): CodexSandbox {
  return contract.mayModifySourceCode ? "workspace-write" : "read-only";
}

function assertSupportedRoute(input: AgentExecutionInput): void {
  const { route, context } = input;
  if (
    route.provider !== "openai" ||
    route.effectiveSurface !== "cli" ||
    route.agent !== context.agent
  ) {
    throw new CodexCliExecutionError("unsupported_route", {
      provider: route.provider,
      effectiveSurface: route.effectiveSurface,
      routeAgent: route.agent,
      contextAgent: context.agent,
    });
  }
  if (
    route.settings !== undefined &&
    Reflect.ownKeys(route.settings).length > 0
  ) {
    throw new CodexCliExecutionError("unsupported_settings");
  }
}

async function assertWorkspace(sourcePath: string): Promise<void> {
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isDirectory()) {
      throw new CodexCliExecutionError("invalid_workspace", { sourcePath });
    }
  } catch (error) {
    if (error instanceof CodexCliExecutionError) {
      throw error;
    }
    throw new CodexCliExecutionError(
      "invalid_workspace",
      { sourcePath },
      { cause: error },
    );
  }
}

function assertSuccessfulProcess(result: ProcessResult): void {
  if (result.timedOut) {
    throw processFailure("timeout", result);
  }
  if (result.exitCode !== 0) {
    throw processFailure("non_zero_exit", result);
  }
}

function processFailure(
  reason: Extract<
    CodexCliExecutionFailureReason,
    "timeout" | "non_zero_exit"
  >,
  result: ProcessResult,
): CodexCliExecutionError {
  return new CodexCliExecutionError(reason, {
    exitCode: result.exitCode,
    signal: result.signal,
  });
}

async function readProviderResult(resultPath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(resultPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new CodexCliExecutionError("missing_result");
    }
    throw new CodexCliExecutionError("temporary_io", {}, { cause: error });
  }
  if (content.trim().length === 0) {
    throw new CodexCliExecutionError("empty_result");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new CodexCliExecutionError("malformed_result", {}, { cause: error });
  }
}

function positiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
