import {
  projectExists,
  settingsPath,
  readJsonFile,
  writeJsonFile,
} from "../lib/project-store.js";
import {
  type SynaphexSettings,
  type AgentName,
  MODEL_CAPABILITIES,
  resolveModelId,
} from "../lib/settings-schema.js";

interface AgentUpdate {
  model?: string;
  think?: boolean;
  effort?: number;
  provider?: "claude";
}

export async function handleSettingsUpdate(
  project: string,
  updates: Record<string, AgentUpdate>,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use /synaphex:create ${project} to create it first.`,
    );
  }

  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const errors: string[] = [];
  const changes: string[] = [];

  for (const [agentName, update] of Object.entries(updates)) {
    const agent = settings.agents[agentName as AgentName];
    if (!agent) {
      errors.push(`[${agentName}] Not a valid agent name.`);
      continue;
    }

    const before = { ...agent };

    // 1. Resolve model
    if (update.model !== undefined) {
      const resolved = resolveModelId(update.model);
      if (!resolved) {
        errors.push(
          `[${agentName}] Unknown model '${update.model}'. ` +
            `Valid models: ${Object.keys(MODEL_CAPABILITIES).join(", ")}`,
        );
        continue;
      }
      agent.model = resolved;
    }

    // 2. Validate think
    if (update.think !== undefined) {
      const caps = MODEL_CAPABILITIES[agent.model];
      if (update.think && (!caps || !caps.thinking)) {
        errors.push(
          `[${agentName}] Model '${agent.model}' does not support extended thinking.`,
        );
        continue;
      }
      agent.think = update.think;
    }

    // 3. Validate effort
    if (update.effort !== undefined) {
      agent.effort = update.effort as 0 | 1 | 2 | 3 | 4;
    }

    // 4. Cross-field constraint: think=false => effort must be 0
    if (!agent.think && agent.effort !== 0) {
      agent.effort = 0;
      changes.push(`[${agentName}] effort forced to 0 because think=off`);
    }

    // 5. Provider
    if (update.provider !== undefined) {
      agent.provider = update.provider;
    }

    // Build diff
    const diffs: string[] = [];
    if (before.model !== agent.model)
      diffs.push(`model: ${before.model} → ${agent.model}`);
    if (before.think !== agent.think)
      diffs.push(`think: ${before.think ? "ON" : "off"} → ${agent.think ? "ON" : "off"}`);
    if (before.effort !== agent.effort)
      diffs.push(`effort: ${before.effort} → ${agent.effort}`);
    if (before.provider !== agent.provider)
      diffs.push(`provider: ${before.provider} → ${agent.provider}`);

    if (diffs.length > 0) {
      changes.push(`[${agentName}] ${diffs.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      "Validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  await writeJsonFile(settingsPath(project), settings);

  if (changes.length === 0) {
    return "No changes were made (values already match).";
  }

  return [
    "Settings updated successfully.",
    "",
    "Changes:",
    ...changes.map((c) => `  - ${c}`),
  ].join("\n");
}
