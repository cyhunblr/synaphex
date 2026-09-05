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
        Diagnostics are read-only probes: presence, version and registration
        shape. No model request is made, so nothing here costs a provider call.
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
              <th>Provider</th><th>Runtime</th><th>Runtime status</th><th>Version</th>
              <th>Registration minimum</th><th>MCP registration</th>
              <th>Host support</th><th>Target support</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.providers.map((entry) => (
              <tr key={entry.provider} data-provider={entry.provider}>
                <td>{entry.provider}</td>
                <td><code>{entry.runtime}</code></td>
                <td>
                  <DiagnosticBadge
                    value={entry.available}
                    positive="Installed"
                    negative="Not installed"
                  />
                </td>
                <td>{entry.version ?? "—"}</td>
                <td>{entry.registrationMinimum}</td>
                <td>
                  <DiagnosticBadge
                    value={entry.registered}
                    positive="Registered"
                    negative="Not registered"
                    negativeTone="warn"
                  />
                </td>
                <td>
                  <DiagnosticBadge
                    value={entry.supportedAsHost}
                    positive="Supported"
                    negative="Unavailable"
                  />
                </td>
                <td>
                  <DiagnosticBadge
                    value={entry.supportedAsTarget}
                    positive="Supported"
                    negative="Unavailable"
                    {...(entry.targetUnavailableReason === undefined
                      ? {}
                      : { title: entry.targetUnavailableReason })}
                  />
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
