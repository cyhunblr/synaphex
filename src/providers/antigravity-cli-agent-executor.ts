import { stat } from "node:fs/promises";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../domain/agent-invocation.js";
import {
  AntigravityCliExecutionError,
  ProviderExecutionPolicyUnsupportedError,
  type AntigravityCliExecutionFailureReason,
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
import { AntigravityAgentResultEnvelopeDecoder } from "./antigravity-agent-result-envelope-decoder.js";
import {
  resolveAntigravityExecutionPolicy,
  type AntigravityExecutionMode,
  type ResolvedAntigravityExecutionPolicy,
} from "./antigravity-execution-policy-resolver.js";
import { StandardAgentResultJsonSchemaBuilder } from "./standard-agent-result-json-schema-builder.js";

export interface AntigravityCliAgentExecutorOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly stdoutLimitBytes?: number;
  readonly includeStderrDiagnostic?: boolean;
}

export const ANTIGRAVITY_FIXED_PRINT_INSTRUCTION =
  "Follow the complete Synaphex logical-agent context provided on stdin. Return exactly the structured result required by the supplied schema.";

export interface AntigravityCommandSpec {
  readonly model: string;
  readonly mode: AntigravityExecutionMode;
  readonly schema: string;
  readonly timeoutMs: number;
}

/**
 * Builds the exact `agy` argument vector for a fresh, sandboxed print-mode run.
 *
 * `--mode` and `--sandbox` are defense-in-depth behavioral guards, not the
 * source-modification enforcement boundary; see
 * AntigravityExecutionPolicyResolver and
 * docs/architecture/0001-google-cli-runtime.md. Permission-bypass and
 * conversation-continuation flags are never emitted.
 */
export function buildAntigravityArgs(
  spec: AntigravityCommandSpec,
): readonly string[] {
  return Object.freeze([
    "-p",
    ANTIGRAVITY_FIXED_PRINT_INSTRUCTION,
    "--output-format",
    "json",
    "--json-schema",
    spec.schema,
    "--model",
    spec.model,
    "--mode",
    spec.mode,
    "--sandbox",
    "--disable-slash-commands",
    "--print-timeout",
    `${spec.timeoutMs}ms`,
  ]);
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_LIMIT_BYTES = 64 * 1024;

export class AntigravityCliAgentExecutor implements AgentExecutor {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly stdoutLimitBytes: number;
  private readonly includeStderrDiagnostic: boolean;
  private readonly promptSerializer = new AgentPromptSerializer();
  private readonly schemaBuilder = new StandardAgentResultJsonSchemaBuilder();
  private readonly envelopeDecoder = new AntigravityAgentResultEnvelopeDecoder();

  constructor(options: AntigravityCliAgentExecutorOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "agy";
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
    assertSupportedRoute(input);
    // Fails closed: Antigravity 1.1.26 exposes no invocation-scoped policy
    // mechanism, so no ExecutionPolicy is currently accepted. Resolution runs
    // before any workspace, schema or prompt work so an unsupported policy can
    // never reach process construction.
    const policy = resolveSupportedExecutionPolicy(input);
    await assertWorkspace(input.context.project.sourcePath);
    const schema = JSON.stringify(this.schemaBuilder.build(input.context));
    const prompt = [
      this.promptSerializer.serialize(
        input.context,
        input.executionPolicy,
        hostedExternalResearchPrompt(false),
      ),
      antigravityExecutionInstructions(policy),
    ].join("\n");
    const result = await this.runAntigravity(input, policy, schema, prompt);
    assertSuccessfulProcess(result, this.includeStderrDiagnostic);
    return this.envelopeDecoder.decode(result.stdout);
  }

  private async runAntigravity(
    input: AgentExecutionInput,
    policy: ResolvedAntigravityExecutionPolicy,
    schema: string,
    prompt: string,
  ): Promise<ProcessResult> {
    const args = buildAntigravityArgs({
      model: input.route.model,
      mode: policy.mode,
      schema,
      timeoutMs: this.timeoutMs,
    });
    try {
      // Omit env so provider-owned cached authentication remains available;
      // Synaphex neither reads nor injects Antigravity credentials/settings.
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
      throw new AntigravityCliExecutionError(
        "spawn_failed",
        {},
        { cause: error },
      );
    }
  }
}

function resolveSupportedExecutionPolicy(
  input: AgentExecutionInput,
): ResolvedAntigravityExecutionPolicy {
  const expected = input.context.roleContract.mayModifySourceCode
    ? "workspace_write"
    : "read_only";
  if (input.executionPolicy.sourceModification !== expected) {
    throw new AntigravityCliExecutionError("unsupported_execution_policy", {
      policyReason: "source_modification_role_mismatch",
    });
  }
  try {
    return resolveAntigravityExecutionPolicy(input.executionPolicy);
  } catch (error) {
    if (error instanceof ProviderExecutionPolicyUnsupportedError) {
      throw new AntigravityCliExecutionError(
        "unsupported_execution_policy",
        { policyReason: error.details?.reason },
        { cause: error },
      );
    }
    throw error;
  }
}

function assertSupportedRoute(input: AgentExecutionInput): void {
  const { route, context } = input;
  if (
    route.provider !== "google" ||
    route.effectiveSurface !== "cli" ||
    route.agent !== context.agent
  ) {
    throw new AntigravityCliExecutionError("unsupported_route", {
      provider: route.provider,
      effectiveSurface: route.effectiveSurface,
      routeAgent: route.agent,
      contextAgent: context.agent,
    });
  }
  if (route.settings !== undefined && Reflect.ownKeys(route.settings).length > 0) {
    throw new AntigravityCliExecutionError("unsupported_settings");
  }
}

async function assertWorkspace(sourcePath: string): Promise<void> {
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isDirectory()) {
      throw new AntigravityCliExecutionError("invalid_workspace", { sourcePath });
    }
  } catch (error) {
    if (error instanceof AntigravityCliExecutionError) {
      throw error;
    }
    throw new AntigravityCliExecutionError(
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
    throw processFailure("stdout_overflow", result, includeStderrDiagnostic);
  }
  if (result.exitCode !== 0) {
    throw processFailure(
      isUnsupportedCapabilityFailure(result.stderr)
        ? "unsupported_cli_capability"
        : "non_zero_exit",
      result,
      includeStderrDiagnostic,
    );
  }
}

function processFailure(
  reason: Extract<
    AntigravityCliExecutionFailureReason,
    "timeout" | "stdout_overflow" | "non_zero_exit" | "unsupported_cli_capability"
  >,
  result: ProcessResult,
  includeStderrDiagnostic: boolean,
): AntigravityCliExecutionError {
  const stderrDiagnostic = includeStderrDiagnostic
    ? sanitizeStderrDiagnostic(result.stderr)
    : undefined;
  return new AntigravityCliExecutionError(reason, {
    exitCode: result.exitCode,
    signal: result.signal,
    ...(stderrDiagnostic === undefined ? {} : { stderrDiagnostic }),
  });
}

function isUnsupportedCapabilityFailure(stderr: string): boolean {
  return /flag provided but not defined|unknown option|unknown argument|unrecognized option|unsupported option/i.test(
    stderr,
  );
}

function sanitizeStderrDiagnostic(stderr: string): string | undefined {
  const sanitized = stderr
    .replaceAll(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replaceAll(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replaceAll(
      /\b(AGY_ADC_AUTH|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .trim();
  if (sanitized === "") {
    return undefined;
  }
  return sanitized.split(/\r?\n/).slice(-20).join("\n").slice(-4_000);
}

function antigravityExecutionInstructions(
  policy: ResolvedAntigravityExecutionPolicy,
): string {
  return [
    "## ANTIGRAVITY PROVIDER EXECUTION CONTROLS",
    // Behavioral guard only. `--mode` and `--sandbox` do not deny
    // command(...), mcp(...), read_url(...) or write_file(...) when a
    // persistent Antigravity permission grant allows them, so this wording is
    // never Synaphex's source-modification enforcement boundary.
    `Execution mode: ${policy.mode}. Provider sandbox is mandatory.`,
    "External network capability is not granted. Do not use external research, browser, remote, MCP, plugin, or subagent tools.",
    policy.mode === "plan"
      ? "Treat the source repository as read-only; do not create, edit, rename, or delete files."
      : "Workspace file edits are allowed, but do not run arbitrary shell/build/test commands unless separately authorized by a future Synaphex capability.",
    "Never run git push directly; request git_push through requestedActions.",
    "Never trigger external CI directly; request ci through requestedActions.",
  ].join("\n");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
