import { stat } from "node:fs/promises";
import {
  getProviderModelCapability,
  validateModelSettings,
} from "../core/provider-model-capability-registry.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../domain/agent-invocation.js";
import {
  ClaudeCliExecutionError,
  ProviderExecutionPolicyUnsupportedError,
  type ClaudeCliExecutionFailureReason,
} from "../domain/errors.js";
import {
  SpawnProcessRunner,
  type ProcessResult,
  type ProcessRunner,
} from "../infrastructure/process-runner.js";
import {
  AgentPromptSerializer,
  hostedExternalResearchPrompt,
} from "./agent-prompt-serializer.js";
import { ClaudeAgentResultEnvelopeDecoder } from "./claude-agent-result-envelope-decoder.js";
import { ClaudeAgentResultJsonSchemaBuilder } from "./claude-agent-result-json-schema-builder.js";
import {
  resolveClaudeExecutionPolicy,
  type ResolvedClaudeExecutionPolicy,
} from "./claude-execution-policy-resolver.js";

export interface ClaudeCliAgentExecutorOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly stdoutLimitBytes?: number;
  readonly includeStderrDiagnostic?: boolean;
}

export const CLAUDE_FIXED_PRINT_INSTRUCTION =
  "Follow the complete Synaphex agent instruction and context supplied on stdin. Return only through the required structured output contract.";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_LIMIT_BYTES = 64 * 1024;

export class ClaudeCliAgentExecutor implements AgentExecutor {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly stdoutLimitBytes: number;
  private readonly includeStderrDiagnostic: boolean;
  private readonly promptSerializer = new AgentPromptSerializer();
  private readonly schemaBuilder = new ClaudeAgentResultJsonSchemaBuilder();
  private readonly envelopeDecoder = new ClaudeAgentResultEnvelopeDecoder();

  constructor(options: ClaudeCliAgentExecutorOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "claude";
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    );
    this.terminationGraceMs = positiveInteger(
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      "terminationGraceMs",
    );
    this.stdoutLimitBytes = positiveInteger(
      options.stdoutLimitBytes ?? DEFAULT_STDOUT_LIMIT_BYTES,
      "stdoutLimitBytes",
    );
    this.includeStderrDiagnostic = options.includeStderrDiagnostic ?? false;
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    const modelSettingArguments = assertSupportedRoute(input);
    const executionPolicy = resolveSupportedExecutionPolicy(input);
    await assertWorkspace(input.context.project.sourcePath);

    const schema = this.schemaBuilder.build(input.context);
    const prompt = [
      this.promptSerializer.serialize(
        input.context,
        input.executionPolicy,
        hostedExternalResearchPrompt(executionPolicy.network.enabled),
      ),
      claudeExecutionInstructions(executionPolicy),
    ].join("\n");
    const result = await this.runClaude(
      input,
      executionPolicy,
      modelSettingArguments,
      JSON.stringify(schema),
      prompt,
    );
    assertSuccessfulProcess(result, this.includeStderrDiagnostic);
    return this.envelopeDecoder.decode(result.stdout);
  }

  private async runClaude(
    input: AgentExecutionInput,
    policy: ResolvedClaudeExecutionPolicy,
    modelSettingArguments: readonly string[],
    schema: string,
    prompt: string,
  ): Promise<ProcessResult> {
    const toolList = policy.tools.join(",");
    const args = [
      "-p",
      CLAUDE_FIXED_PRINT_INSTRUCTION,
      "--safe-mode",
      "--restricted",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--model",
      input.route.model,
      ...modelSettingArguments,
      "--no-session-persistence",
      "--disable-slash-commands",
      "--permission-mode",
      "dontAsk",
      "--tools",
      toolList,
      "--allowedTools",
      toolList,
      "--disallowedTools",
      policy.disallowedTools.join(","),
      ...(policy.settings === null
        ? []
        : ["--settings", JSON.stringify(policy.settings)]),
    ];
    try {
      // Deliberately omit env: the direct spawn inherits provider-owned Claude
      // subscription/authentication state without Synaphex injecting credentials.
      return await this.runner.run({
        executable: this.executable,
        args,
        stdin: prompt,
        cwd: input.context.project.sourcePath,
        timeoutMs: this.timeoutMs,
        terminationGraceMs: this.terminationGraceMs,
        stdoutCaptureMode: "full",
        stdoutLimitBytes: this.stdoutLimitBytes,
        stderrTailLimitBytes: STDERR_TAIL_LIMIT_BYTES,
      });
    } catch (error) {
      throw new ClaudeCliExecutionError("spawn_failed", {}, { cause: error });
    }
  }
}

function resolveSupportedExecutionPolicy(
  input: AgentExecutionInput,
): ResolvedClaudeExecutionPolicy {
  const expectedSourceModification = input.context.roleContract
    .mayModifySourceCode
    ? "workspace_write"
    : "read_only";
  if (input.executionPolicy.sourceModification !== expectedSourceModification) {
    throw new ClaudeCliExecutionError("invalid_execution_policy", {
      policyReason: "source_modification_role_mismatch",
    });
  }
  try {
    return resolveClaudeExecutionPolicy(input.executionPolicy);
  } catch (error) {
    if (error instanceof ProviderExecutionPolicyUnsupportedError) {
      throw new ClaudeCliExecutionError(
        "invalid_execution_policy",
        { policyReason: error.details?.reason },
        { cause: error },
      );
    }
    throw error;
  }
}

function assertSupportedRoute(input: AgentExecutionInput): string[] {
  const { route, context } = input;
  if (
    route.provider !== "anthropic" ||
    route.effectiveSurface !== "cli" ||
    route.agent !== context.agent
  ) {
    throw new ClaudeCliExecutionError("unsupported_route", {
      provider: route.provider,
      effectiveSurface: route.effectiveSurface,
      routeAgent: route.agent,
      contextAgent: context.agent,
    });
  }
  const model = getProviderModelCapability(
    "anthropic",
    "cli",
    route.model,
  );
  if (model === undefined) {
    throw new ClaudeCliExecutionError("unsupported_model", {
      model: route.model,
    });
  }
  const invalid = validateModelSettings(model, route.settings);
  if (invalid.setting !== undefined) {
    throw new ClaudeCliExecutionError("unsupported_settings", {
      setting: invalid.setting,
    });
  }
  if (route.settings === undefined) return [];
  return Object.entries(route.settings).flatMap(([key, value]) => {
    const setting = model.settings.find((entry) => entry.key === key)!;
    const binding = setting.executorBinding;
    if (binding.kind !== "claude_argument" || binding.flag !== "--effort") {
      throw new ClaudeCliExecutionError("unsupported_settings", {
        setting: key,
      });
    }
    return [binding.flag, String(value)];
  });
}

async function assertWorkspace(sourcePath: string): Promise<void> {
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isDirectory()) {
      throw new ClaudeCliExecutionError("invalid_workspace", { sourcePath });
    }
  } catch (error) {
    if (error instanceof ClaudeCliExecutionError) {
      throw error;
    }
    throw new ClaudeCliExecutionError(
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
  if (result.stdoutOverflowed === true) {
    throw processFailure(
      "stdout_overflow",
      result,
      includeStderrDiagnostic,
    );
  }
  if (result.exitCode !== 0) {
    const reason = isUnsupportedCapabilityFailure(result.stderr)
      ? "unsupported_cli_capability"
      : "non_zero_exit";
    throw processFailure(reason, result, includeStderrDiagnostic);
  }
}

function processFailure(
  reason: Extract<
    ClaudeCliExecutionFailureReason,
    | "timeout"
    | "stdout_overflow"
    | "non_zero_exit"
    | "unsupported_cli_capability"
  >,
  result: ProcessResult,
  includeStderrDiagnostic: boolean,
): ClaudeCliExecutionError {
  const stderrDiagnostic = includeStderrDiagnostic
    ? sanitizeStderrDiagnostic(result.stderr)
    : undefined;
  return new ClaudeCliExecutionError(reason, {
    exitCode: result.exitCode,
    signal: result.signal,
    ...(stderrDiagnostic === undefined ? {} : { stderrDiagnostic }),
  });
}

function isUnsupportedCapabilityFailure(stderr: string): boolean {
  return /unknown option|unknown argument|unrecognized option|unsupported option/i.test(
    stderr,
  );
}

function sanitizeStderrDiagnostic(stderr: string): string | undefined {
  const sanitized = stderr
    .replaceAll(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replaceAll(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replaceAll(
      /\b(ANTHROPIC_API_KEY|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .trim();
  if (sanitized.length === 0) {
    return undefined;
  }
  return sanitized.split(/\r?\n/).slice(-20).join("\n").slice(-4_000);
}

function claudeExecutionInstructions(
  policy: ResolvedClaudeExecutionPolicy,
): string {
  return [
    "## CLAUDE PROVIDER EXECUTION CONTROLS",
    `Available built-in tools: ${policy.tools.join(", ")}.`,
    "Provider-native agents, skills, user-question tools, hooks, plugins, and MCP tools are unavailable.",
    policy.settings === null
      ? "Bash is unavailable for this read-only invocation."
      : "Bash runs only inside the required fail-closed workspace sandbox. Local shell/process network access is not granted.",
    "Never run git push or trigger external CI directly; request Synaphex host actions instead.",
  ].join("\n");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
