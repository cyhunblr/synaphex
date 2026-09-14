import type {
  DiagnosticsModel,
  ModelCapabilityCatalog,
  StatusModel,
} from "./api.js";
import type { ReactNode } from "react";

/** Pure diagnostics presentation, exported so the shipped view is testable. */
export function DiagnosticsView({
  diagnostics,
  catalog,
  status,
}: {
  diagnostics: DiagnosticsModel;
  catalog: ModelCapabilityCatalog | null;
  status: StatusModel | null;
}) {
  return (
    <>
      <div className="notice">
        Installation, host registration, and callable execution are separate.
        Observations never widen target or model support, and no model request is made.
      </div>

      <section aria-labelledby="system-diagnostics-heading">
        <h2 id="system-diagnostics-heading">System</h2>
        <table><tbody>
          <tr><th scope="row">Node</th><td><code>{diagnostics.nodeVersion}</code></td></tr>
          <tr><th scope="row">Platform</th><td>{diagnostics.platform}</td></tr>
        </tbody></table>
      </section>

      <section aria-labelledby="provider-diagnostics-heading" className="diagnostics-section">
        <h2 id="provider-diagnostics-heading">Providers</h2>
        <div className="provider-grid">
          {diagnostics.providers.map((entry) => {
            const targets = catalog?.targets.filter(
              (target) => target.provider === entry.provider,
            ) ?? [];
            return (
              <article className="provider-card" key={entry.provider} data-provider={entry.provider}>
                <h3>{providerLabel(entry.provider)}</h3>

                <DiagnosticSection heading="Installation">
                  <dl className="diagnostic-list">
                    <DiagnosticRow label="Runtime"><code>{entry.runtime.id}</code></DiagnosticRow>
                    <DiagnosticRow label="Status">
                      <DiagnosticBadge value={entry.runtime.installed} positive="Detected" negative="Missing" />
                    </DiagnosticRow>
                    <DiagnosticRow label="Version">{entry.runtime.version ?? "—"}</DiagnosticRow>
                  </dl>
                </DiagnosticSection>

                <DiagnosticSection heading="Host Integration">
                  <p className="compact">
                    MCP hosting <span className="badge" data-tone="ok">Supported</span>
                  </p>
                  <p className="compact">
                    Registration{" "}
                    <DiagnosticBadge
                      value={entry.hostIntegration.registration.state === "recorded"}
                      positive="Recorded"
                      negative="Not recorded"
                      negativeTone="warn"
                    />
                  </p>
                  <p className="muted compact">
                    Registration minimum {entry.hostIntegration.registrationMinimum}
                  </p>
                  <ul className="plain-list host-surfaces">
                    {entry.hostIntegration.surfaces.map((surface) => (
                      <li key={surface.id}>
                        {surface.label} <span className="badge">Host only</span>
                      </li>
                    ))}
                  </ul>
                  <p className="muted compact">
                    Shared registration does not identify which interactive host is active.
                  </p>
                </DiagnosticSection>

                <DiagnosticSection heading="Execution Targets">
                  {entry.executionTargets.map((target) => (
                    <div className="target-diagnostic" key={target.id}>
                      <strong>{target.label}</strong>
                      <dl className="diagnostic-list">
                        <DiagnosticRow label="Target">
                          <DiagnosticBadge
                            value={target.support === "supported"}
                            positive="Supported"
                            negative="Unavailable"
                          />
                        </DiagnosticRow>
                        <DiagnosticRow label="Execution policy">
                          <DiagnosticBadge
                            value={target.executionPolicySupport === "supported"}
                            positive="Supported"
                            negative="Unavailable"
                          />
                        </DiagnosticRow>
                        <DiagnosticRow label="Runtime readiness">
                          <DiagnosticBadge
                            value={target.targetRuntimeReadiness === "ready"}
                            positive="Ready"
                            negative="Unavailable"
                          />
                        </DiagnosticRow>
                      </dl>
                      {target.unavailableReason === undefined ? null : (
                        <p className="muted compact">{target.unavailableReason}</p>
                      )}
                    </div>
                  ))}
                </DiagnosticSection>

                <DiagnosticSection heading="Models">
                  {targets.flatMap((target) => target.models).length === 0 ? (
                    <p className="muted compact">No executable model catalog.</p>
                  ) : (
                    targets.map((target) => {
                      const recommended = target.models.filter(
                        (model) => model.supportTier === "recommended",
                      );
                      const supported = target.models.filter(
                        (model) => model.supportTier === "supported",
                      );
                      return (
                        <div key={target.id}>
                          <p className="compact"><strong>{target.label}</strong></p>
                          <ModelList label={`Recommended (${recommended.length})`} models={recommended} />
                          <ModelList label={`Other supported (${supported.length})`} models={supported} />
                        </div>
                      );
                    })
                  )}
                </DiagnosticSection>

                <DiagnosticSection heading="Capabilities">
                  {targets.length === 0 ? (
                    <p className="muted compact">No callable target capabilities.</p>
                  ) : (
                    targets.map((target) => {
                      const settingLabels = [
                        ...new Set(
                          target.models.flatMap((model) =>
                            model.settings.map((setting) => setting.label),
                          ),
                        ),
                      ];
                      const policySupported = Object.values(target.executionPolicy).every(
                        (value) => value === "invocation_scoped",
                      );
                      return (
                        <dl className="diagnostic-list" key={target.id}>
                          <DiagnosticRow label="Invocation policy">
                            {policySupported ? "Enforced" : "Unavailable"}
                          </DiagnosticRow>
                          <DiagnosticRow label="Configurable settings">
                            {settingLabels.length === 0 ? "Provider defaults only" : settingLabels.join(", ")}
                          </DiagnosticRow>
                        </dl>
                      );
                    })
                  )}
                </DiagnosticSection>
              </article>
            );
          })}
        </div>
      </section>

      {status === null ? null : (
        <p className="muted config-version">
          Config version <code>{status.configVersion}</code>
        </p>
      )}
    </>
  );
}

function DiagnosticSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="diagnostic-group">
      <h4>{heading}</h4>
      {children}
    </section>
  );
}

function DiagnosticRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function ModelList({
  label,
  models,
}: {
  label: string;
  models: { id: string; label: string }[];
}) {
  return (
    <div className="model-list">
      <strong>{label}</strong>
      {models.length === 0 ? (
        <span className="muted"> — none</span>
      ) : (
        <ul className="plain-list">
          {models.map((model) => <li key={model.id}>{model.label}</li>)}
        </ul>
      )}
    </div>
  );
}

function DiagnosticBadge({
  value,
  positive,
  negative,
  negativeTone = "bad",
}: {
  value: boolean;
  positive: string;
  negative: string;
  negativeTone?: "bad" | "warn";
}) {
  return (
    <span className="badge" data-tone={value ? "ok" : negativeTone}>
      {value ? positive : negative}
    </span>
  );
}

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
