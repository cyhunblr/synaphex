import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConfigDocumentList,
  copyConfigPath,
  reloadConfigDocument,
  type ConfigDocumentPreview,
} from "../web/src/FilesView.js";

const documents: ConfigDocumentPreview[] = [
  {
    file: "agent_config.jsonc",
    path: "/canonical/.synaphex/agent_config.jsonc",
    content: "old agent config",
  },
  {
    file: "agent_behavior.jsonc",
    path: "/canonical/.synaphex/agent_behavior.jsonc",
    content: "behavior config",
  },
  {
    file: "rules.jsonc",
    path: "/canonical/.synaphex/rules.jsonc",
    content: "rules config",
  },
];

test("Config Files renders Reload and Copy path for every canonical document", () => {
  const html = renderToStaticMarkup(
    createElement(ConfigDocumentList, {
      documents,
      onReload: () => undefined,
      onCopy: () => undefined,
    }),
  );
  assert.equal((html.match(/>Reload<\/button>/g) ?? []).length, 3);
  assert.equal((html.match(/>Copy path<\/button>/g) ?? []).length, 3);
  for (const document of documents) {
    assert.ok(html.includes(document.file));
    assert.ok(html.includes(document.path));
  }
});

test("Reload refetches canonical preview and replaces only the requested document", async () => {
  let calls = 0;
  const reloaded = await reloadConfigDocument(
    documents,
    "agent_config.jsonc",
    async () => {
      calls += 1;
      return {
        configVersion: "next",
        documents: documents.map((document) =>
          document.file === "agent_config.jsonc"
            ? { ...document, content: "fresh canonical agent config" }
            : { ...document, content: `fresh ${document.file}` },
        ),
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(reloaded[0]?.content, "fresh canonical agent config");
  assert.equal(reloaded[1]?.content, "behavior config");
  assert.equal(reloaded[2]?.content, "rules config");
});

test("Copy path writes the exact canonical path and reports unavailable clipboard", async () => {
  const writes: string[] = [];
  await copyConfigPath(documents[0]!.path, {
    writeText: async (value) => {
      writes.push(value);
    },
  });
  assert.deepEqual(writes, ["/canonical/.synaphex/agent_config.jsonc"]);
  await assert.rejects(copyConfigPath(documents[0]!.path, undefined), /clipboard_unavailable/);
});

test("Config Files feedback is accessible for both success and failure", () => {
  const html = renderToStaticMarkup(
    createElement(ConfigDocumentList, {
      documents: documents.slice(0, 2),
      feedback: {
        "agent_config.jsonc": { tone: "ok", message: "Reloaded." },
        "agent_behavior.jsonc": { tone: "bad", message: "Clipboard unavailable." },
      },
      onReload: () => undefined,
      onCopy: () => undefined,
    }),
  );
  assert.equal((html.match(/role="status"/g) ?? []).length, 2);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Reloaded/);
  assert.match(html, /Clipboard unavailable/);
});
