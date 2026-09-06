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
  getProviderModelCapability,
  validateModelSettings,
} from "../core/provider-model-capability-registry.js";
import {
  CodexCliExecutionError,
  ProviderExecutionPolicyUnsupportedError,
  type CodexCliExecutionFailureReason,
} from "../domain/errors.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
  type ProcessResult,
} from "../infrastructure/process-runner.js";
import {
  AgentPromptSerializer,
  hostedExternalResearchPrompt,
} from "./agent-prompt-serializer.js";
import { AgentResultJsonSchemaBuilder } from "./agent-result-json-schema-builder.js";
import { CodexAgentResultWireCodec } from "./codex-agent-result-wire-codec.js";
import {
  resolveCodexExecutionPolicy,
  type ResolvedCodexExecutionPolicy,
} from "./codex-execution-policy-resolver.js";

export interface CodexCliAgentExecutorOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly includeStderrDiagnostic?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;

export class CodexCliAgentExecutor implements AgentExecutor {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly includeStderrDiagnostic: boolean;
  private readonly promptSerializer = new AgentPromptSerializer();
  private readonly schemaBuilder = new AgentResultJsonSchemaBuilder();
  private readonly wireCodec = new CodexAgentResultWireCodec();

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
    this.includeStderrDiagnostic = options.includeStderrDiagnostic ?? false;
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    assertSupportedRoute(input);
    const executionPolicy = resolveSupportedExecutionPolicy(input);
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
      const prompt = `${this.promptSerializer.serialize(
        input.context,
        input.executionPolicy,
        hostedExternalResearchPrompt(executionPolicy.network.enabled),
      )}\n${this.wireCodec.instructions(input.context)}\n`;
      const processResult = await this.runCodex(
        input,
        schemaPath,
        resultPath,
        executionPolicy,
        prompt,
      );
      assertSuccessfulProcess(
        processResult,
        this.includeStderrDiagnostic,
      );
      const wireResult = await readProviderResult(resultPath);
      return this.wireCodec.decode(input.context, wireResult);
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
    executionPolicy: ResolvedCodexExecutionPolicy,
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
          executionPolicy.sandbox,
          ...executionPolicy.configOverrides.flatMap((override) => [
            "-c",
            override,
          ]),
          ...codexModelSettingOverrides(input).flatMap((override) => [
            "-c",
            override,
          ]),
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

export {
  resolveCodexExecutionPolicy,
  resolveCodexSandbox,
} from "./codex-execution-policy-resolver.js";
export type { CodexSandbox } from "./codex-execution-policy-resolver.js";

function resolveSupportedExecutionPolicy(
  input: AgentExecutionInput,
): ResolvedCodexExecutionPolicy {
  const { executionPolicy, context } = input;
  const expectedSourceModification = context.roleContract.mayModifySourceCode
    ? "workspace_write"
    : "read_only";
  if (executionPolicy.sourceModification !== expectedSourceModification) {
    throw new ProviderExecutionPolicyUnsupportedError(
      "openai",
      "source modification policy does not match the immutable role contract",
    );
  }
  return resolveCodexExecutionPolicy(executionPolicy);
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
  codexModelSettingOverrides(input);
}

function codexModelSettingOverrides(input: AgentExecutionInput): string[] {
  const capability = getProviderModelCapability(
    "openai",
    "cli",
    input.route.model,
  );
  if (capability === undefined) {
    throw new CodexCliExecutionError("unsupported_model", {
      model: input.route.model,
    });
  }
  const settings = input.route.settings;
  if (settings === undefined || Object.keys(settings).length === 0) return [];
  const invalid = validateModelSettings(capability, settings);
  if (invalid.setting !== undefined) {
    throw new CodexCliExecutionError("unsupported_settings", {
      setting: invalid.setting,
    });
  }
  return Object.entries(settings).map(([key, value]) => {
    const setting = capability.settings.find((entry) => entry.key === key)!;
    if (setting.executorBinding.kind !== "codex_config") {
      throw new CodexCliExecutionError("unsupported_settings", { setting: key });
    }
    return `${setting.executorBinding.key}=${JSON.stringify(value)}`;
  });
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

function assertSuccessfulProcess(
  result: ProcessResult,
  includeStderrDiagnostic: boolean,
): void {
  if (result.timedOut) {
    throw processFailure("timeout", result, includeStderrDiagnostic);
  }
  if (result.exitCode !== 0) {
    throw processFailure("non_zero_exit", result, includeStderrDiagnostic);
  }
}

function processFailure(
  reason: Extract<
    CodexCliExecutionFailureReason,
    "timeout" | "non_zero_exit"
  >,
  result: ProcessResult,
  includeStderrDiagnostic: boolean,
): CodexCliExecutionError {
  const stderrDiagnostic = includeStderrDiagnostic
    ? sanitizeStderrDiagnostic(result.stderr)
    : undefined;
  return new CodexCliExecutionError(reason, {
    exitCode: result.exitCode,
    signal: result.signal,
    diagnosticCategory:
      reason === "timeout"
        ? "process_timeout"
        : classifyNonZeroExit(result.stderr),
    ...(stderrDiagnostic === undefined ? {} : { stderrDiagnostic }),
  });
}

function classifyNonZeroExit(stderr: string): string {
  if (
    /invalid_json_schema|invalid schema for response_format|(?:invalid|unsupported) (?:json |output )?schema|schema (?:is )?(?:invalid|unsupported)/i.test(
      stderr,
    )
  ) {
    return "output_schema_incompatibility";
  }
  if (/\bmodel\b.*(?:not supported|unsupported|not found|unknown)/i.test(stderr)) {
    return "model_unavailable";
  }
  return "process_execution";
}

function sanitizeStderrDiagnostic(stderr: string): string | undefined {
  const sanitized = stderr
    .replaceAll(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replaceAll(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replaceAll(
      /\b(OPENAI_API_KEY|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .trim();
  if (sanitized.length === 0) {
    return undefined;
  }
  const lines = sanitized.split(/\r?\n/);
  const diagnosticLines = lines.filter((line) =>
    /^(?:ERROR:|warning:)|invalid_request_error|invalid_json_schema|invalid schema for response_format/i.test(
      line.trim(),
    ),
  );
  return (diagnosticLines.length > 0 ? diagnosticLines : lines.slice(-20))
    .join("\n")
    .slice(-4_000);
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
