import { useEffect, useMemo, useState } from "react";
import type {
  AgentModel,
  AgentName,
  EdgeModel,
  ModelCapabilityCatalog,
  ProviderDiagnostic,
  RuleDecision,
  TargetCapability,
} from "./api.js";

export interface AgentDraft {
  provider: string;
  surface: string;
  model: string;
  settings: Record<string, unknown>;
}

export function draftFor(agent: AgentModel): AgentDraft {
  return {
    provider: agent.provider ?? "anthropic",
    surface: agent.surface ?? "cli",
    model: agent.model ?? "",
    settings: { ...(agent.settings ?? {}) },
  };
}

export function selectProvider(
  draft: AgentDraft,
  provider: string,
  catalog: ModelCapabilityCatalog,
): AgentDraft {
  const target = findTarget(catalog, provider, "cli");
  return {
    provider,
    surface: "cli",
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
  const allowed = new Set(supported?.settings.map((entry) => entry.key) ?? []);
  return {
    ...draft,
    model,
    settings: Object.fromEntries(
      Object.entries(draft.settings).filter(([key]) => allowed.has(key)),
    ),
  };
}

export function findTarget(
  catalog: ModelCapabilityCatalog,
  provider: string,
  surface: string,
): TargetCapability | undefined {
  return catalog.targets.find(
    (entry) =>
      entry.provider === provider && entry.persistedSurface === surface,
  );
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
    ...(Object.keys(draft.settings).length === 0
      ? {}
      : { settings: draft.settings }),
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
  const [draft, setDraft] = useState(() => draftFor(agent));
  const [confirmClear, setConfirmClear] = useState(false);
  const [settingsReset, setSettingsReset] = useState(false);

  useEffect(() => {
    setDraft(draftFor(agent));
    setConfirmClear(false);
    setSettingsReset(false);
  }, [agent]);

  const target = findTarget(catalog, draft.provider, draft.surface);
  const selectedModel = target?.models.find(
    (entry) => entry.id === draft.model,
  );
  const unknownModel = draft.model.length > 0 && selectedModel === undefined;
  const chosen = providers.find((entry) => entry.provider === draft.provider);
  const targetUnavailable = target?.support !== "supported";
  const targetUnavailableReason =
    draft.surface === "vscode"
      ? "VS Code is not an invocation target. This historical value is preserved until you explicitly choose a CLI target."
      : target?.unavailableReason ??
        "This provider target is unavailable in this Synaphex version.";
  const initial = useMemo(() => draftFor(agent), [agent]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function updateSetting(key: string, value: string): void {
    const settings = { ...draft.settings };
    if (value === "") delete settings[key];
    else settings[key] = value;
    setDraft({ ...draft, settings });
    setSettingsReset(false);
  }

  return (
    <aside className="drawer" aria-label={`${agent.agent} configuration`}>
      <h2>{agent.agent.toUpperCase()}</h2>
      <p className="muted">
        <span className="badge" data-tone={agent.status === "configured" ? "ok" : undefined}>
          {agent.status}
        </span>{" "}
        {agent.executable ? (
          <span className="badge" data-tone="ok">executable</span>
        ) : (
          <span className="badge">not executable</span>
        )}
      </p>

      {chosen !== undefined && !chosen.runtime.installed ? (
        <div className="notice" data-tone="warn">
          The {chosen.runtime.id} runtime is not currently available on this machine.
          The supported catalog remains visible for offline configuration.
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select
          id="provider"
          value={draft.provider}
          onChange={(event) =>
            {
              setSettingsReset(Object.keys(draft.settings).length > 0);
              setDraft(selectProvider(draft, event.target.value, catalog));
            }
          }
        >
          {providers.map((entry) => (
            <option key={entry.provider} value={entry.provider}>
              {entry.provider}
              {entry.executionTargets.some((candidate) => candidate.support === "supported")
                ? ""
                : " — target unavailable"}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="surface">Surface</label>
        <select
          id="surface"
          value={draft.surface}
          onChange={(event) =>
            setDraft(selectProvider(draft, draft.provider, catalog))
          }
        >
          {draft.surface === "vscode" ? (
            <option value="vscode" disabled>vscode — legacy, not executable</option>
          ) : null}
          <option value="cli">cli</option>
        </select>
      </div>

      {targetUnavailable ? (
        <div className="notice" data-tone="bad">
          {targetUnavailableReason}
        </div>
      ) : (
        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={draft.model}
            onChange={(event) =>
              {
                const next = selectModel(draft, event.target.value, target);
                setSettingsReset(
                  Object.keys(next.settings).length < Object.keys(draft.settings).length,
                );
                setDraft(next);
              }
            }
          >
            {draft.model === "" ? <option value="">Select a supported model</option> : null}
            {unknownModel ? (
              <option value={draft.model}>{draft.model} — unrecognized legacy value</option>
            ) : null}
            {target?.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} · {model.supportTier} · {draft.provider} · {draft.surface}
                {model.settings.length > 0 ? " · configurable" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {unknownModel ? (
        <div className="notice" data-tone="warn">
          Configured model is not recognized by this Synaphex version. It is preserved until you explicitly select a supported model.
        </div>
      ) : null}

      {settingsReset ? (
        <div className="notice" data-tone="warn">
          Settings incompatible with the selected provider or model were removed from this draft.
        </div>
      ) : null}

      {!targetUnavailable && selectedModel !== undefined ? (
        selectedModel.settings.length === 0 ? (
          <div className="field">
            <label>Model settings</label>
            <p className="muted" style={{ margin: 0 }}>No optional settings are supported. Provider defaults are used.</p>
          </div>
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
              <p className="muted" style={{ margin: "6px 0 0" }}>{setting.description}</p>
            </div>
          ))
        )
      ) : null}

      <div className="row">
        <button
          className="btn primary"
          disabled={!dirty || targetUnavailable || unknownModel || selectedModel === undefined}
          onClick={() => onSave(saveBodyForDraft(draft))}
        >Save</button>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(initial)}>Discard</button>
        {agent.status === "configured" ? (
          confirmClear ? (
            <button className="btn danger" onClick={onClear}>Confirm remove</button>
          ) : (
            <button className="btn danger" onClick={() => setConfirmClear(true)}>Remove configuration</button>
          )
        ) : null}
      </div>

      <h2 style={{ marginTop: 22 }}>Contract</h2>
      <p className="muted">Fixed in code. Rules can restrict these, never widen them.</p>
      <table><tbody>
        <Contract label="Modifies source" value={agent.contract.mayModifySourceCode} />
        <Contract label="Writes canonical memory" value={agent.contract.mayWriteCanonicalMemory} />
        <tr><td>Task binding</td><td>{agent.contract.taskBinding}</td></tr>
        <tr><td>Runs on task states</td><td>{agent.contract.allowedTaskStatuses.join(", ")}</td></tr>
      </tbody></table>

      <h2 style={{ marginTop: 22 }}>Outgoing calls</h2>
      <p className="muted">Direction matters: {agent.agent} &rarr; X is not X &rarr; {agent.agent}.</p>
      <table>
        <thead><tr><th>Target</th><th>Effective</th><th>Set</th></tr></thead>
        <tbody>{edges.map((edge) => (
          <tr key={edge.target}>
            <td>{edge.target}</td>
            <td>{edge.immutable ? <span className="badge" data-tone="bad">forbidden</span> : <>{edge.decision}<br /><span className="muted" style={{ fontSize: 11 }}>via {edge.source}</span></>}</td>
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
      <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={onClose}>Close</button></div>
    </aside>
  );
}

function Contract({ label, value }: { label: string; value: boolean }) {
  return <tr><td>{label}</td><td><span className="badge" data-tone={value ? "ok" : undefined}>{value ? "yes" : "no"}</span></td></tr>;
}
