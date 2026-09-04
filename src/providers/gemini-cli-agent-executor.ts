import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
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
  GeminiCliExecutionError,
  ProviderExecutionPolicyUnsupportedError,
  type GeminiCliExecutionFailureReason,
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
import { GeminiAgentResultContractSerializer } from "./gemini-agent-result-contract-serializer.js";
import { GeminiAgentResultEnvelopeDecoder } from "./gemini-agent-result-envelope-decoder.js";
import {
  resolveGeminiExecutionPolicy,
  serializeGeminiPolicy,
  type ResolvedGeminiExecutionPolicy,
} from "./gemini-execution-policy-resolver.js";

export interface GeminiCliAgentExecutorOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly stdoutLimitBytes?: number;
  readonly includeStderrDiagnostic?: boolean;
}

export const GEMINI_FIXED_HEADLESS_INSTRUCTION =
  "Follow the complete Synaphex logical-agent context provided on stdin. Return exactly one raw JSON result object and no Markdown.";

export interface GeminiInvocationProjectSettings {
  readonly hooksConfig: { readonly enabled: false };
  readonly skills: { readonly enabled: false };
  readonly experimental: { readonly autoMemory: false };
  readonly general: { readonly checkpointing: { readonly enabled: false } };
  readonly context: {
    readonly fileName: string;
    readonly loadMemoryFromIncludeDirectories: false;
  };
  readonly security: {
    readonly disableYoloMode: true;
    readonly disableAlwaysAllow: true;
    readonly enablePermanentToolApproval: false;
  };
}

interface GeminiDriverWorkspace {
  readonly root: string;
  readonly settingsPath: string;
  readonly policyPath: string;
  readonly mcpSentinel: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_LIMIT_BYTES = 64 * 1024;

export class GeminiCliAgentExecutor implements AgentExecutor {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly stdoutLimitBytes: number;
  private readonly includeStderrDiagnostic: boolean;
  private readonly promptSerializer = new AgentPromptSerializer();
  private readonly contractSerializer = new GeminiAgentResultContractSerializer();
  private readonly envelopeDecoder = new GeminiAgentResultEnvelopeDecoder();

  constructor(options: GeminiCliAgentExecutorOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "gemini";
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
    const executionPolicy = resolveSupportedExecutionPolicy(input);
    await assertWorkspace(input.context.project.sourcePath);
    const prompt = [
      this.promptSerializer.serialize(
        input.context,
        input.executionPolicy,
        hostedExternalResearchPrompt(executionPolicy.network.enabled),
      ),
      geminiExecutionInstructions(executionPolicy),
      this.contractSerializer.serialize(input.context),
    ].join("\n");
    const workspace = await createDriverWorkspace(executionPolicy);
    let primaryFailure: unknown;
    try {
      const result = await this.runGemini(input, workspace, prompt);
      assertSuccessfulProcess(result, this.includeStderrDiagnostic);
      return this.envelopeDecoder.decode(result.stdout);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      try {
        await rm(workspace.root, { recursive: true, force: true });
      } catch (error) {
        if (primaryFailure === undefined) {
          throw new GeminiCliExecutionError(
            "temporary_io",
            { operation: "cleanup" },
            { cause: error },
          );
        }
      }
    }
  }

  private async runGemini(
    input: AgentExecutionInput,
    workspace: GeminiDriverWorkspace,
    prompt: string,
  ): Promise<ProcessResult> {
    const args = [
      "-p",
      GEMINI_FIXED_HEADLESS_INSTRUCTION,
      "--output-format",
      "json",
      "--model",
      input.route.model,
      "--approval-mode",
      "default",
      "--extensions",
      "none",
      "--policy",
      workspace.policyPath,
      "--allowed-mcp-server-names",
      workspace.mcpSentinel,
      "--include-directories",
      input.context.project.sourcePath,
    ];
    try {
      // Deliberately omit env and keep HOME unchanged so provider-owned cached
      // authentication remains available without Synaphex reading credentials.
      return await this.runner.run({
        executable: this.executable,
        args,
        stdin: prompt,
        cwd: workspace.root,
        timeoutMs: this.timeoutMs,
        terminationGraceMs: this.terminationGraceMs,
        stdoutCaptureMode: "full",
        stdoutLimitBytes: this.stdoutLimitBytes,
        stderrTailLimitBytes: STDERR_TAIL_LIMIT_BYTES,
      });
    } catch (error) {
      throw new GeminiCliExecutionError("spawn_failed", {}, { cause: error });
    }
  }
}

export function geminiInvocationProjectSettings(
  contextFileName: string,
): GeminiInvocationProjectSettings {
  return Object.freeze({
    hooksConfig: Object.freeze({ enabled: false as const }),
    skills: Object.freeze({ enabled: false as const }),
    experimental: Object.freeze({ autoMemory: false as const }),
    general: Object.freeze({
      checkpointing: Object.freeze({ enabled: false as const }),
    }),
    context: Object.freeze({
      fileName: contextFileName,
      loadMemoryFromIncludeDirectories: false as const,
    }),
    security: Object.freeze({
      disableYoloMode: true as const,
      disableAlwaysAllow: true as const,
      enablePermanentToolApproval: false as const,
    }),
  });
}

async function createDriverWorkspace(
  policy: ResolvedGeminiExecutionPolicy,
): Promise<GeminiDriverWorkspace> {
  let root: string | undefined;
  try {
    root = await mkdtemp(join(tmpdir(), "synaphex-gemini-"));
    await chmod(root, 0o700);
    const settingsDirectory = join(root, ".gemini");
    await mkdir(settingsDirectory, { mode: 0o700 });
    const unique = randomUUID();
    const settingsPath = join(settingsDirectory, "settings.json");
    const policyPath = join(root, `.synaphex-policy-${unique}.toml`);
    const contextFileName = `.synaphex-no-context-${unique}.md`;
    const mcpSentinel = `synaphex-no-mcp-${unique}`;
    await writeFile(
      settingsPath,
      `${JSON.stringify(geminiInvocationProjectSettings(contextFileName), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await writeFile(policyPath, serializeGeminiPolicy(policy), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return { root, settingsPath, policyPath, mcpSentinel };
  } catch (error) {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new GeminiCliExecutionError(
      "temporary_io",
      { operation: "create" },
      { cause: error },
    );
  }
}

function resolveSupportedExecutionPolicy(
  input: AgentExecutionInput,
): ResolvedGeminiExecutionPolicy {
  const expected = input.context.roleContract.mayModifySourceCode
    ? "workspace_write"
    : "read_only";
  if (input.executionPolicy.sourceModification !== expected) {
    throw new GeminiCliExecutionError("invalid_execution_policy", {
      policyReason: "source_modification_role_mismatch",
    });
  }
  try {
    return resolveGeminiExecutionPolicy(input.executionPolicy);
  } catch (error) {
    if (error instanceof ProviderExecutionPolicyUnsupportedError) {
      throw new GeminiCliExecutionError(
        "invalid_execution_policy",
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
    throw new GeminiCliExecutionError("unsupported_route", {
      provider: route.provider,
      effectiveSurface: route.effectiveSurface,
      routeAgent: route.agent,
      contextAgent: context.agent,
    });
  }
  if (route.settings !== undefined && Reflect.ownKeys(route.settings).length > 0) {
    throw new GeminiCliExecutionError("unsupported_settings");
  }
}

async function assertWorkspace(sourcePath: string): Promise<void> {
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isDirectory()) {
      throw new GeminiCliExecutionError("invalid_workspace", { sourcePath });
    }
  } catch (error) {
    if (error instanceof GeminiCliExecutionError) {
      throw error;
    }
    throw new GeminiCliExecutionError(
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
    GeminiCliExecutionFailureReason,
    "timeout" | "stdout_overflow" | "non_zero_exit" | "unsupported_cli_capability"
  >,
  result: ProcessResult,
  includeStderrDiagnostic: boolean,
): GeminiCliExecutionError {
  const stderrDiagnostic = includeStderrDiagnostic
    ? sanitizeStderrDiagnostic(result.stderr)
    : undefined;
  return new GeminiCliExecutionError(reason, {
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
      /\b(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .trim();
  if (sanitized === "") {
    return undefined;
  }
  return sanitized.split(/\r?\n/).slice(-20).join("\n").slice(-4_000);
}

function geminiExecutionInstructions(
  policy: ResolvedGeminiExecutionPolicy,
): string {
  return [
    "## GEMINI PROVIDER EXECUTION CONTROLS",
    `Allowed built-in tools: ${policy.tools.join(", ")}.`,
    "All other tools are denied. Shell, web_fetch, MCP, extensions, hooks, skills, subagents, browser agents, plans, todos, and interactive user-question tools are unavailable.",
    "The source repository is an included workspace; use only the allowed filesystem tools there.",
    "Never run git push or trigger external CI directly; request git_push or ci through requestedActions.",
  ].join("\n");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
