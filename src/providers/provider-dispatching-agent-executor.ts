import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../domain/agent-invocation.js";
import {
  InvalidProviderRouteError,
  NativeHostExecutionUnavailableError,
} from "../domain/errors.js";

/**
 * Provider-independent dispatch for an already-resolved `ExecutionRoute`.
 *
 * ```text
 * ProviderRouter decides the route.
 * ProviderDispatchingAgentExecutor executes callable routes.
 * ```
 *
 * The route is authoritative. This executor selects a delegate and nothing
 * else: it does not resolve routing, rules or ExecutionPolicy, does not choose
 * or inspect models, does not read agent configuration again, does not touch
 * HostContext, and performs no fallback routing. Every such decision has
 * already happened upstream.
 *
 * It is deliberately transparent -- the delegate receives the exact
 * `AgentExecutionInput` it was given, so each adapter's sandbox, network,
 * structured-output, authentication and process semantics remain untouched.
 */
export interface ProviderDispatchingAgentExecutorDelegates {
  /** `openai + cli` -> Codex CLI. */
  readonly openaiCli: AgentExecutor;
  /** `anthropic + cli` -> Claude Code CLI. */
  readonly anthropicCli: AgentExecutor;
  /** `google + cli` -> Antigravity CLI (`agy`). */
  readonly googleCli: AgentExecutor;
}

export class ProviderDispatchingAgentExecutor implements AgentExecutor {
  constructor(
    private readonly delegates: ProviderDispatchingAgentExecutorDelegates,
  ) {}

  async execute(input: AgentExecutionInput): Promise<unknown> {
    const { provider, effectiveSurface, agent } = input.route;

    // VS Code extensions are interactive HOST surfaces, never externally
    // callable provider runtimes. A `same_provider_native` route is a valid
    // routing outcome, but Synaphex has no bridge from this subprocess into an
    // active VS Code extension, so it fails closed. It is NOT downgraded to
    // the provider CLI: reporting a CLI run as native VS Code execution would
    // misrepresent what actually executed.
    if (effectiveSurface !== "cli") {
      throw new NativeHostExecutionUnavailableError(
        provider,
        effectiveSurface,
        agent,
      );
    }

    switch (provider) {
      case "openai":
        return this.delegates.openaiCli.execute(input);
      case "anthropic":
        return this.delegates.anthropicCli.execute(input);
      case "google":
        // Dispatch succeeds; the Antigravity adapter then applies its own
        // accepted security resolver, which currently fails closed for every
        // ExecutionPolicy combination. That is not special-cased here.
        return this.delegates.googleCli.execute(input);
      default:
        // No fallback: an unrecognised provider is a failure, never a
        // substitution of another provider's execution identity.
        throw new InvalidProviderRouteError(
          input.route.host,
          provider,
          input.route.configuredSurface,
          effectiveSurface,
        );
    }
  }
}
