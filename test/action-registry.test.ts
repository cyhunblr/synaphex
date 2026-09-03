import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_NAMES,
  HOST_ACTION_NAMES,
  PROVIDER_CAPABILITY_NAMES,
  ActionRegistry,
} from "../src/domain/action.js";

test("immutable action registry defines every execution kind from one mapping", () => {
  const registry = new ActionRegistry();

  assert.deepEqual(registry.get("network"), {
    action: "network",
    executionKind: "provider_capability",
  });
  assert.deepEqual(registry.get("git_push"), {
    action: "git_push",
    executionKind: "host_action",
  });
  assert.deepEqual(registry.get("ci"), {
    action: "ci",
    executionKind: "host_action",
  });
  assert.deepEqual(ACTION_NAMES, ["network", "git_push", "ci"]);
  assert.deepEqual(PROVIDER_CAPABILITY_NAMES, ["network"]);
  assert.deepEqual(HOST_ACTION_NAMES, ["git_push", "ci"]);
});

test("action registry rejects unknown action identities without containing rules", () => {
  const registry = new ActionRegistry();
  assert.equal(registry.isKnownAction("deploy"), false);
  assert.equal(registry.isKnownAction({ action: "network" }), false);
  assert.equal("decision" in registry.get("network"), false);
  assert.equal(Object.isFrozen(registry.get("git_push")), true);
});
