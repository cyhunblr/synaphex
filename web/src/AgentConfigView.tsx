import { useEffect, useMemo, useState } from "react";
import type {
  AgentModel,
  AgentName,
  EdgeModel,
  ModelCapability,
  ModelCapabilityCatalog,
  ProviderDiagnostic,
  RuleDecision,
  TargetCapability,
} from "./api.js";

export interface AgentDraft {
  provider: string;
  targetId: string;
  surface: string;
  model: string;
  settings: Record<string, unknown>;
}

export function draftFor(agent: AgentModel, catalog: ModelCapabilityCatalog): AgentDraft {
  const provider = agent.provider ?? catalog.targets[0]?.provider ?? "";
  const target = findTarget(catalog, provider, agent.surface ?? "cli");
  return {
    provider,
    targetId: target?.id ?? "",
    surface: agent.surface ?? target?.persistedSurface ?? "cli",
    model: agent.model ?? "",
    settings: { ...(agent.settings ?? {}) },
  };
}

export function selectProvider(
  _draft: AgentDraft,
  provider: string,
  catalog: ModelCapabilityCatalog,
): AgentDraft {
  const target = catalog.targets.find((entry) => entry.provider === provider);
  return target === undefined
    ? { provider, targetId: "", surface: "cli", model: "", settings: {} }
    : selectTarget(
        { provider, targetId: "", surface: "cli", model: "", settings: {} },
        target.id,
        catalog,
      );
}

export function selectTarget(
  draft: AgentDraft,
  targetId: string,
  catalog: ModelCapabilityCatalog,
): AgentDraft {
  const target = catalog.targets.find(
    (entry) => entry.id === targetId && entry.provider === draft.provider,
  );
  return {
    ...draft,
    targetId: target?.id ?? "",
    surface: target?.persistedSurface ?? "cli",
    model: target?.models[0]?.id ?? "",
    settings: {},
  };
}

export function selectModel(
  draft: AgentDraft,
  model: string,
  target: TargetCapability | undefined,
): AgentDraft {
  const supported = target?.models.find((entry) => entry.id === model);
  return {
    ...draft,
    model,
    settings: Object.fromEntries(
      Object.entries(draft.settings).filter(([key, value]) => {
        const setting = supported?.settings.find((entry) => entry.key === key);
        return (
          setting !== undefined &&
          typeof value === "string" &&
          setting.values.some((candidate) => candidate.value === value)
        );
      }),
    ),
  };
}

export function findTarget(
  catalog: ModelCapabilityCatalog,
  provider: string,
  surface: string,
): TargetCapability | undefined {
  return catalog.targets.find(
    (entry) => entry.provider === provider && entry.persistedSurface === surface,
  );
}

export function groupModels(target: TargetCapability | undefined): {
  recommended: ModelCapability[];
  supported: ModelCapability[];
} {
  return {
    recommended: target?.models.filter((model) => model.supportTier === "recommended") ?? [],
    supported: target?.models.filter((model) => model.supportTier === "supported") ?? [],
  };
}

export function saveBodyForDraft(draft: AgentDraft): {
  provider: string;
  surface: string;
  model: string;
  settings?: Record<string, unknown>;
} {
  return {
    provider: draft.provider,
    surface: draft.surface,
    model: draft.model,
    ...(Object.keys(draft.settings).length === 0 ? {} : { settings: draft.settings }),
  };
}

export function AgentConfigView({
  agent,
  providers,
  catalog,
  edges,
  onClose,
  onSave,
  onClear,
  onRule,
}: {
  agent: AgentModel;
  providers: ProviderDiagnostic[];
  catalog: ModelCapabilityCatalog;
  edges: EdgeModel[];
  onClose(): void;
  onSave(body: {
    provider: string;
    surface: string;
    model: string;
    settings?: Record<string, unknown>;
  }): void;
  onClear(): void;
  onRule(target: AgentName, decision: RuleDecision | "inherit"): void;
}) {
  const [draft, setDraft] = useState(() => draftFor(agent, catalog));
  const [confirmClear, setConfirmClear] = useState(false);
  const [settingsReset, setSettingsReset] = useState(false);

  useEffect(() => {
    setDraft(draftFor(agent, catalog));
    setConfirmClear(false);
    setSettingsReset(false);
  }, [agent, catalog]);

  const initial = useMemo(() => draftFor(agent, catalog), [agent, catalog]);
  const providerTargets = catalog.targets.filter((entry) => entry.provider === draft.provider);
  const target = providerTargets.find((entry) => entry.id === draft.targetId);
  const selectedModel = target?.models.find((entry) => entry.id === draft.model);
  const groupedModels = groupModels(target);
  const legacySurface =
    agent.status === "configured" && draft.targetId === "" && agent.surface !== undefined;
  const unknownModel =
    target !== undefined && draft.model.length > 0 && selectedModel === undefined;
  const chosen = providers.find((entry) => entry.provider === draft.provider);
  const targetObservation = chosen?.executionTargets.find((entry) => entry.id === target?.id);
  const targetUnavailable = target === undefined || target.support !== "supported";
  const runtimeReady = targetObservation?.targetRuntimeReadiness === "ready";
  const policySupported =
    target !== undefined &&
    Object.values(target.executionPolicy).every((support) => support === "invocation_scoped");
  const modelValidated = selectedModel !== undefined;
  const draftExecutable =
    runtimeReady && !targetUnavailable && policySupported && modelValidated;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function updateSetting(key: string, value: string): void {
    const settings = { ...draft.settings };
    if (value === "") delete settings[key];
    else settings[key] = value;
    setDraft({ ...draft, settings });
    setSettingsReset(false);
  }

  function chooseModel(model: string): void {
    const next = selectModel(draft, model, target);
    setSettingsReset(Object.keys(next.settings).length < Object.keys(draft.settings).length);
    setDraft(next);
  }

  return (
    <aside className="drawer" aria-label={`${agent.agent} configuration`}>
      <section aria-labelledby="agent-heading">
        <h2 id="agent-heading">Agent</h2>
        <div className="agent-title">{agent.agent.toUpperCase()}</div>
        <p className="badge-row">
          <span className="badge" data-tone={agent.status === "configured" ? "ok" : undefined}>
            {agent.status}
          </span>
          {agent.provider === undefined ? null : (
            <span className="badge">{providerLabel(agent.provider)}</span>
          )}
          <span className="badge" data-tone={agent.executable ? "ok" : "warn"}>
            {agent.executable ? "validated configuration" : "not executable"}
          </span>
        </p>
        <p className="muted compact">
          {agent.contract.mayModifySourceCode ? "May modify staged source." : "Source is read-only."}{" "}
          Task binding: {agent.contract.taskBinding}.
        </p>
      </section>

      <section className="panel-section" aria-labelledby="provider-heading">
        <h2 id="provider-heading">Provider</h2>
        <div className="field">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={draft.provider}
            onChange={(event) => {
              setSettingsReset(Object.keys(draft.settings).length > 0);
              setDraft(selectProvider(draft, event.target.value, catalog));
            }}
          >
            {providers.map((entry) => (
              <option key={entry.provider} value={entry.provider}>
                {providerLabel(entry.provider)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel-section" aria-labelledby="target-heading">
        <h2 id="target-heading">Execution Target</h2>
        <div className="field">
          <label htmlFor="execution-target">Callable target</label>
          <select
            id="execution-target"
            value={draft.targetId}
            onChange={(event) => {
              setSettingsReset(Object.keys(draft.settings).length > 0);
              setDraft(selectTarget(draft, event.target.value, catalog));
            }}
          >
            {draft.targetId === "" ? <option value="">Select an execution target</option> : null}
            {providerTargets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}{candidate.support === "supported" ? "" : " — unavailable"}
              </option>
            ))}
          </select>
        </div>

        {legacySurface ? (
          <div className="notice" data-tone="warn">
            <strong>Legacy configuration</strong><br />
            {agent.surface === "vscode"
              ? "VS Code is an interactive host integration, not a callable Synaphex execution target."
              : `The persisted ${agent.surface} surface is not a callable Synaphex execution target.`}
            <br />
            This configuration is preserved but cannot execute. Select a supported target to migrate deliberately.
          </div>
        ) : targetUnavailable ? (
          <div className="notice" data-tone="bad">
            <strong>Unavailable</strong><br />
            {target?.unavailableReason ??
              "This provider has no callable execution target in this Synaphex version."}
          </div>
        ) : null}
      </section>

      {!targetUnavailable ? (
        <section className="panel-section" aria-labelledby="model-heading">
          <h2 id="model-heading">Model</h2>
          <div className="field">
            <label htmlFor="model">Validated model</label>
            <select id="model" value={draft.model} onChange={(event) => chooseModel(event.target.value)}>
              {draft.model === "" ? <option value="">Select a supported model</option> : null}
              {unknownModel ? (
                <option value={draft.model}>{draft.model} — unvalidated legacy value</option>
              ) : null}
              {groupedModels.recommended.length > 0 ? (
                <optgroup label="Recommended">
                  {groupedModels.recommended.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </optgroup>
              ) : null}
              {groupedModels.supported.length > 0 ? (
                <optgroup label="Other supported">
                  {groupedModels.supported.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>

          {selectedModel === undefined ? null : (
            <div className="capability-hint" aria-label="Selected model capabilities">
              <span className="badge" data-tone={selectedModel.supportTier === "recommended" ? "ok" : undefined}>
                {selectedModel.supportTier === "recommended" ? "Recommended" : "Supported"}
              </span>
              <span>{target.label}</span>
              <span>
                {selectedModel.settings.length > 0
                  ? `${selectedModel.settings.map((setting) => setting.label).join(", ")} configurable`
                  : "Provider defaults available"}
              </span>
            </div>
          )}

          {unknownModel ? (
            <div className="notice" data-tone="warn">
              <strong>Unvalidated / non-executable</strong><br />
              The persisted model <code>{draft.model}</code> is preserved. Select a supported model to migrate;
              Synaphex will not replace it automatically.
            </div>
          ) : null}
        </section>
      ) : null}

      {settingsReset ? (
        <div className="notice" data-tone="warn" role="status">
          Settings incompatible with the selected provider, target, or model were removed from this draft.
        </div>
      ) : null}

      {!targetUnavailable && selectedModel !== undefined ? (
        <section className="panel-section" aria-labelledby="settings-heading">
          <h2 id="settings-heading">Model Settings</h2>
          {selectedModel.settings.length === 0 ? (
            <p className="muted compact">No optional settings are supported. Provider defaults are used.</p>
          ) : (
            selectedModel.settings.map((setting) => (
              <div className="field" key={setting.key}>
                <label htmlFor={`setting-${setting.key}`}>{setting.label}</label>
                <select
                  id={`setting-${setting.key}`}
                  value={typeof draft.settings[setting.key] === "string" ? String(draft.settings[setting.key]) : ""}
                  onChange={(event) => updateSetting(setting.key, event.target.value)}
                >
                  <option value="">Provider default (unset)</option>
                  {setting.values.map((value) => (
                    <option key={value.value} value={value.value}>{value.label}</option>
                  ))}
                </select>
                <p className="muted compact">{setting.description}</p>
              </div>
            ))
          )}
        </section>
      ) : null}

      <section className="panel-section" aria-labelledby="readiness-heading">
        <h2 id="readiness-heading">Readiness</h2>
        <dl className="readiness-list">
          <Readiness
            label={`Runtime${chosen === undefined ? "" : ` (${chosen.runtime.id})`}`}
            ready={runtimeReady}
            positive="Ready"
            negative="Missing"
          />
          <Readiness label="Execution policy" ready={policySupported} positive="Supported" negative="Unavailable" />
          <Readiness label="Model" ready={modelValidated} positive="Validated" negative="Unvalidated" />
          <Readiness label="Configuration" ready={draftExecutable} positive="Executable" negative="Not executable" />
        </dl>
        <p className="muted compact">MCP host registration is reported separately and does not gate CLI readiness.</p>
      </section>

      <div className="row panel-actions">
        <button
          className="btn primary"
          disabled={!dirty || targetUnavailable || unknownModel || selectedModel === undefined}
          onClick={() => onSave(saveBodyForDraft(draft))}
        >Save</button>
        <button
          className="btn"
          disabled={!dirty}
          onClick={() => {
            setDraft(initial);
            setSettingsReset(false);
          }}
        >Discard</button>
        {agent.status === "configured" ? (
          confirmClear ? (
            <button className="btn danger" onClick={onClear}>Confirm remove</button>
          ) : (
            <button className="btn danger" onClick={() => setConfirmClear(true)}>Remove configuration</button>
          )
        ) : null}
      </div>

      <section className="panel-section" aria-labelledby="contract-heading">
        <h2 id="contract-heading">Immutable Contract</h2>
        <p className="muted compact">Rules can restrict these capabilities, never widen them.</p>
        <table><tbody>
          <Contract label="Modifies source" value={agent.contract.mayModifySourceCode} />
          <Contract label="Writes canonical memory" value={agent.contract.mayWriteCanonicalMemory} />
          <tr><td>Task binding</td><td>{agent.contract.taskBinding}</td></tr>
          <tr><td>Runs on task states</td><td>{agent.contract.allowedTaskStatuses.join(", ")}</td></tr>
        </tbody></table>
      </section>

      <section className="panel-section" aria-labelledby="outgoing-heading">
        <h2 id="outgoing-heading">Outgoing Calls</h2>
        <p className="muted compact">Direction matters: {agent.agent} &rarr; X is not X &rarr; {agent.agent}.</p>
        <table>
          <thead><tr><th>Target</th><th>Effective</th><th>Set</th></tr></thead>
          <tbody>{edges.map((edge) => (
            <tr key={edge.target}>
              <td>{edge.target}</td>
              <td>
                {edge.immutable ? (
                  <span className="badge" data-tone="bad">forbidden</span>
                ) : (
                  <>{edge.decision}<br /><span className="muted small">via {edge.source}</span></>
                )}
              </td>
              <td><select
                aria-label={`${agent.agent} to ${edge.target} decision`}
                disabled={edge.immutable}
                value={edge.immutable ? "deny" : edge.decision}
                onChange={(event) => onRule(edge.target, event.target.value as RuleDecision | "inherit")}
              >
                {edge.immutable ? <option value="deny">forbidden by role contract</option> : <>
                  <option value="allow">allow</option><option value="ask">ask</option>
                  <option value="deny">deny</option><option value="inherit">inherit (remove override)</option>
                </>}
              </select></td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <div className="row panel-actions"><button className="btn" onClick={onClose}>Close</button></div>
    </aside>
  );
}

function Readiness({
  label,
  ready,
  positive,
  negative,
}: {
  label: string;
  ready: boolean;
  positive: string;
  negative: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><span className="badge" data-tone={ready ? "ok" : "warn"}>{ready ? positive : negative}</span></dd>
    </div>
  );
}

function Contract({ label, value }: { label: string; value: boolean }) {
  return (
    <tr><td>{label}</td><td><span className="badge" data-tone={value ? "ok" : undefined}>{value ? "yes" : "no"}</span></td></tr>
  );
}

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
