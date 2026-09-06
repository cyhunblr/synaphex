import type { DiagnosticsModel, StatusModel } from "./api.js";

/** Pure diagnostics presentation, exported so the shipped view is testable. */
export function DiagnosticsView({
  diagnostics,
  status,
}: {
  diagnostics: DiagnosticsModel;
  status: StatusModel | null;
}) {
  return (
    <>
      <div className="notice">
        Runtime probes and installation-manifest records are observations.
        They never widen Synaphex target or model support, and no model request
        is made.
      </div>

      <section aria-labelledby="system-diagnostics-heading">
        <h2 id="system-diagnostics-heading">System</h2>
        <table>
          <tbody>
            <tr><th scope="row">Node</th><td><code>{diagnostics.nodeVersion}</code></td></tr>
            <tr><th scope="row">Platform</th><td>{diagnostics.platform}</td></tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="provider-diagnostics-heading" style={{ marginTop: 22 }}>
        <h2 id="provider-diagnostics-heading">Providers</h2>
        <table>
          <thead>
            <tr>
              <th>Provider</th><th>Runtime</th><th>Runtime installed</th><th>Version</th>
              <th>Host registration minimum</th><th>Host registration record</th>
              <th>Host surfaces</th><th>Execution target</th>
              <th>Policy support</th><th>Target runtime readiness</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.providers.map((entry) => (
              <tr key={entry.provider} data-provider={entry.provider}>
                <td>{entry.provider}</td>
                <td><code>{entry.runtime.id}</code></td>
                <td>
                  <DiagnosticBadge
                    value={entry.runtime.installed}
                    positive="Installed"
                    negative="Not installed"
                  />
                </td>
                <td>{entry.runtime.version ?? "—"}</td>
                <td>{entry.hostIntegration.registrationMinimum}</td>
                <td>
                  <DiagnosticBadge
                    value={entry.hostIntegration.registration.state === "recorded"}
                    positive="Recorded"
                    negative="Not recorded"
                    negativeTone="warn"
                  />
                </td>
                <td>
                  {entry.hostIntegration.surfaces.map((surface) => surface.label).join(", ")}
                </td>
                <td>
                  {entry.executionTargets.map((target) => (
                    <DiagnosticBadge
                      key={target.id}
                      value={target.support === "supported"}
                      positive={`${target.label}: supported`}
                      negative={`${target.label}: unavailable`}
                      {...(target.unavailableReason === undefined
                        ? {}
                        : { title: target.unavailableReason })}
                    />
                  ))}
                </td>
                <td>
                  {entry.executionTargets.map((target) => (
                    <DiagnosticBadge
                      key={target.id}
                      value={target.executionPolicySupport === "supported"}
                      positive="Supported"
                      negative="Unavailable"
                    />
                  ))}
                </td>
                <td>
                  {entry.executionTargets.map((target) => (
                    <DiagnosticBadge
                      key={target.id}
                      value={target.targetRuntimeReadiness === "ready"}
                      positive="Ready"
                      negative="Unavailable"
                    />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status !== null ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Config version <code>{status.configVersion}</code>
        </p>
      ) : null}
    </>
  );
}

function DiagnosticBadge({
  value,
  positive,
  negative,
  negativeTone = "bad",
  title,
}: {
  value: boolean;
  positive: string;
  negative: string;
  negativeTone?: "bad" | "warn";
  title?: string;
}) {
  return (
    <span
      className="badge"
      data-tone={value ? "ok" : negativeTone}
      {...(title === undefined ? {} : { title })}
    >
      {value ? positive : negative}
    </span>
  );
}
