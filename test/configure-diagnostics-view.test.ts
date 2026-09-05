import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DiagnosticsView } from "../web/src/DiagnosticsView.js";
import type { DiagnosticsModel } from "../web/src/api.js";

test("Diagnostics renders system, versions, registration, host and target support", () => {
  const diagnostics: DiagnosticsModel = {
    nodeVersion: "v22.21.0",
    platform: "linux",
    providers: [
      provider("openai", "codex", "0.153.0", true, true),
      provider("anthropic", "claude", "2.1.260", true, true),
      provider("google", "agy", "1.1.27", true, false),
    ],
  };

  const html = renderToStaticMarkup(
    createElement(DiagnosticsView, { diagnostics, status: null }),
  );

  for (const expected of [
    "System",
    "Node",
    "v22.21.0",
    "Platform",
    "linux",
    "0.153.0",
    "2.1.260",
    "1.1.27",
    "Runtime status",
    "MCP registration",
    "Host support",
    "Target support",
  ]) {
    assert.ok(html.includes(expected), expected);
  }

  const googleRow = /<tr data-provider="google">([\s\S]*?)<\/tr>/.exec(html)?.[1];
  assert.ok(googleRow, "Google provider row");
  assert.ok(googleRow.includes("Installed"));
  assert.ok(googleRow.includes("Registered"));
  assert.ok(googleRow.includes("Supported"));
  assert.ok(googleRow.includes("Unavailable"));
  assert.equal(html.includes(">true<"), false);
  assert.equal(html.includes(">false<"), false);
});

function provider(
  providerName: string,
  runtime: string,
  version: string,
  supportedAsHost: boolean,
  supportedAsTarget: boolean,
) {
  return {
    provider: providerName,
    runtime,
    available: true,
    version,
    registrationMinimum: version,
    registered: true,
    supportedAsHost,
    supportedAsTarget,
    ...(supportedAsTarget
      ? {}
      : { targetUnavailableReason: "Target execution fails closed." }),
  };
}
