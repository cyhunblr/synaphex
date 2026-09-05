import {
  SUPPORTED_INSTALLATION_TARGETS,
  type InstallationTarget,
} from "../domain/installation.js";
import { AntigravityMcpRegistrar } from "./antigravity-mcp-registrar.js";
import { ClaudeMcpRegistrar } from "./claude-mcp-registrar.js";
import { CodexMcpRegistrar } from "./codex-mcp-registrar.js";
import type { ProviderCommandRunner } from "./provider-command-runner.js";
import { targetKey } from "./installation-planner.js";
import type { ProviderMcpRegistrar } from "./provider-mcp-registrar.js";

/**
 * Builds the registrar for every supported host surface.
 *
 * OpenAI and Anthropic each use ONE adapter for both their CLI and VS Code
 * surfaces, because the provider's VS Code extension reads the same global
 * configuration its CLI writes -- verified against the installed extensions.
 * Google has a CLI surface only: there is no Antigravity IDE support and no
 * Gemini CLI runtime anywhere in this matrix.
 */
export function createRegistrars(
  runner: ProviderCommandRunner,
): ReadonlyMap<string, ProviderMcpRegistrar> {
  const registrars = new Map<string, ProviderMcpRegistrar>();
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    registrars.set(targetKey(target), createRegistrar(target, runner));
  }
  return registrars;
}

function createRegistrar(
  target: InstallationTarget,
  runner: ProviderCommandRunner,
): ProviderMcpRegistrar {
  switch (target.provider) {
    case "openai":
      return new CodexMcpRegistrar(target, runner);
    case "anthropic":
      return new ClaudeMcpRegistrar(target, runner);
    case "google":
      return new AntigravityMcpRegistrar(target, runner);
  }
}
