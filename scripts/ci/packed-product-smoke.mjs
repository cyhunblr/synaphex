#!/usr/bin/env node
/**
 * Packed-product integration gate.
 *
 * Source tests prove development correctness. This proves that the exact
 * artifact a user installs actually works, which is a different question:
 * three real defects (an npm bin-symlink entrypoint guard, a readline stall,
 * and a zero-byte provider config) were invisible to the source suite and
 * appeared only under a real `npm pack` -> `npm install -g` -> shim execution.
 *
 * Everything runs under isolated HOME, npm prefix and provider config. No real
 * provider runtime, no authentication, no model invocation and no network
 * beyond the dependency install the caller already performed.
 *
 * Runnable locally: `npm run test:packed-product`.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Optional `--tarball <path>`: validate an already-built artifact instead of
 * packing a fresh one. The release pipeline packs exactly once and then
 * validates and publishes that same file, so nothing can drift between what
 * was checked and what the registry receives.
 */
const suppliedTarball = (() => {
  const index = process.argv.indexOf("--tarball");
  return index >= 0 ? process.argv[index + 1] : undefined;
})();
const STEP_TIMEOUT_MS = 120_000;

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
    return true;
  }
  failures += 1;
  process.stdout.write(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}\n`);
  return false;
}

function section(name) {
  process.stdout.write(`\n${name}\n`);
}

/** Runs a command with a hard timeout, so a hang fails CI instead of hanging it. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? STEP_TIMEOUT_MS,
    cwd: options.cwd ?? REPO,
    env: options.env ?? process.env,
    input: options.input,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM",
  };
}

/**
 * Drives an interactive command through a pseudo-terminal.
 *
 * The readline defect only reproduced through the real prompt path, so the TUI
 * gate must exercise a PTY rather than a pipe. `script` is the portable POSIX
 * way to allocate one without adding a native dependency; when it is missing
 * the caller falls back to a pipe and says so.
 */
function runOnPty(command, args, answers, env) {
  const hasScript = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;
  if (!hasScript) {
    return { available: false, stdout: "", status: null, timedOut: false };
  }
  const result = spawnSync(
    "script",
    ["-qefc", [command, ...args].join(" "), "/dev/null"],
    {
      encoding: "utf8",
      timeout: STEP_TIMEOUT_MS,
      env,
      input: `${answers.join("\n")}\n`,
      shell: false,
    },
  );
  return {
    available: true,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function readServers(home, flavor) {
  const path =
    flavor === "codex"
      ? join(home, ".codex", "mcp-servers.json")
      : flavor === "claude"
        ? join(home, ".claude.json")
        : join(home, ".gemini", "config", "mcp_config.json");
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw).mcpServers ?? {};
  } catch {
    return { __malformed: true };
  }
}

/** Creates the three fake provider executables on an isolated PATH. */
function createFakeProviders(root) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const fake = join(REPO, "scripts", "ci", "fake-provider-cli.mjs");
  for (const [name, flavor] of [
    ["codex", "codex"],
    ["claude", "claude"],
    ["agy", "agy"],
  ]) {
    const shim = join(binDir, name);
    writeFileSync(
      shim,
      `#!/bin/sh\nFAKE_PROVIDER_FLAVOR=${flavor} exec "${process.execPath}" "${fake}" "$@"\n`,
    );
    chmodSync(shim, 0o755);
  }
  return binDir;
}

const workspace = mkdtempSync(join(tmpdir(), "synaphex-packed-"));
let exitCode = 0;

try {
  // --- 1. Obtain the tarball ----------------------------------------------
  //
  // A release must validate the EXACT artifact it will publish, so the caller
  // can supply one. Packing again here would produce a different file and
  // validate something the registry never receives.
  section("packing the product");
  let tarball;
  if (suppliedTarball !== undefined) {
    tarball = resolve(suppliedTarball);
    check("supplied tarball exists", existsSync(tarball), tarball);
    if (!existsSync(tarball)) {
      throw new Error(`no tarball at ${tarball}`);
    }
    process.stdout.write(`  note validating supplied tarball ${tarball}\n`);
  } else {
    const packDir = join(workspace, "pack");
    mkdirSync(packDir, { recursive: true });
    const packed = run("npm", ["pack", "--silent", "--pack-destination", packDir]);
    tarball = join(packDir, packed.stdout.trim().split("\n").pop() ?? "");
    check("npm pack produced a tarball", packed.status === 0 && existsSync(tarball), tarball);
    if (!existsSync(tarball)) {
      throw new Error("cannot continue without a tarball");
    }
  }

  // --- 2. Package contents -------------------------------------------------
  section("package contents");
  const listing = run("tar", ["-tzf", tarball]).stdout.split("\n");
  for (const required of [
    "package/dist/installer/cli-main.js",
    "package/dist/mcp/stdio-main.js",
    "package/dist/index.js",
    // The configure GUI must ship pre-built: `synaphex configure` has to work
    // from a plain global install, with no checkout and no dev server.
    "package/dist/configure/configure-command.js",
    "package/dist/configure/web/index.html",
    "package/package.json",
    // npm includes a root LICENSE regardless of the `files` allowlist, but the
    // declared SPDX identifier is only substantiated if it actually ships.
    "package/LICENSE",
  ]) {
    check(`contains ${required}`, listing.includes(required));
  }
  for (const unwanted of [
    "package/src/",
    "package/test/",
    "package/.test-dist/",
    // Frontend source stays out; only the built bundle ships.
    "package/web/",
  ]) {
    check(
      `excludes ${unwanted}`,
      !listing.some((entry) => entry.startsWith(unwanted)),
    );
  }
  // Type declarations are part of the published contract; sourcemaps are not.
  // They reference `../src/*.ts`, which is never shipped, and carry no inlined
  // content -- so they can only ever be dead weight for a consumer.
  check(
    "ships type declarations",
    listing.some((entry) => entry.endsWith(".d.ts")),
  );
  check(
    "excludes unresolvable sourcemaps",
    !listing.some((entry) => entry.endsWith(".map")),
  );

  // --- 3. Isolated global install -----------------------------------------
  section("isolated global installation");
  const prefix = join(workspace, "npm-prefix");
  const npmHome = join(workspace, "npm-home");
  mkdirSync(prefix, { recursive: true });
  mkdirSync(npmHome, { recursive: true });
  const installEnv = {
    ...process.env,
    HOME: npmHome,
    npm_config_prefix: prefix,
    npm_config_fund: "false",
    npm_config_audit: "false",
    NODE_PATH: "",
  };
  const installed = run("npm", ["install", "-g", tarball], {
    env: installEnv,
    timeout: 300_000,
  });
  check("npm install -g succeeded", installed.status === 0, installed.stderr.slice(0, 300));

  const binDir = join(prefix, "bin");
  const synaphexBin = join(binDir, "synaphex");
  const mcpBin = join(binDir, "synaphex-mcp-stdio");
  check("synaphex bin exists in the isolated prefix", existsSync(synaphexBin));
  check("synaphex-mcp-stdio bin exists in the isolated prefix", existsSync(mcpBin));
  const packageRoot = join(prefix, "lib", "node_modules", "synaphex");
  check("installed package root exists", existsSync(packageRoot));
  check(
    "bins resolve to the installed package, not the checkout",
    !run("readlink", ["-f", synaphexBin]).stdout.trim().startsWith(REPO),
    run("readlink", ["-f", synaphexBin]).stdout.trim(),
  );

  // --- 4. The npm shim must actually execute ------------------------------
  //
  // Regression for the bin-symlink defect: npm installs the bin as a symlink,
  // so a filename-based entrypoint guard never fires and the command exits 0
  // printing nothing. Direct-file execution would still have "worked".
  section("global bin shim execution");
  const unrelated = join(workspace, "unrelated");
  mkdirSync(unrelated, { recursive: true });
  const shimEnv = { ...installEnv, HOME: join(workspace, "shim-home") };
  mkdirSync(shimEnv.HOME, { recursive: true });
  const shimRun = run(synaphexBin, ["install"], {
    cwd: unrelated,
    env: shimEnv,
    input: "n\nn\nn\n",
  });
  check("shim produced output (not a silent no-op)", shimRun.stdout.trim().length > 0);
  check("shim reached every provider prompt", /Google/.test(shimRun.stdout));
  const directRun = run(
    process.execPath,
    [join(packageRoot, "dist", "installer", "cli-main.js"), "install"],
    { cwd: unrelated, env: shimEnv, input: "n\nn\nn\n" },
  );
  check(
    "shim and direct execution behave the same",
    shimRun.stdout.trim().length > 0 && directRun.stdout.trim().length > 0,
    "direct-file execution must not be the only working path",
  );

  // --- 5. Installed MCP launcher ------------------------------------------
  section("installed MCP launcher");
  const entrypoint = join(packageRoot, "dist", "mcp", "stdio-main.js");
  for (const provider of ["openai", "anthropic", "google"]) {
    const probe = await probeMcp(
      process.execPath,
      [entrypoint, "--host-provider", provider],
      unrelated,
    );
    check(`${provider} host serves tools over MCP`, probe.tools > 0, probe.detail);
  }
  // The MCP bin is what a provider host actually launches, so its shim must
  // work too -- the same symlink defect made it exit 0 in total silence.
  const mcpShimValid = run(mcpBin, ["--host-provider", "anthropic"], {
    cwd: unrelated,
    env: { ...shimEnv, NODE_PATH: "" },
    input: "",
    timeout: 15_000,
  });
  check(
    "the MCP bin shim starts (not a silent no-op)",
    /host provider: anthropic/.test(`${mcpShimValid.stdout}${mcpShimValid.stderr}`),
    "the installed synaphex-mcp-stdio shim produced no output",
  );
  // An obsolete surface assertion is refused rather than ignored, so a stale
  // registration cannot smuggle UI identity back into host authority.
  const refused = run(mcpBin, ["--host-provider", "anthropic", "--host-surface", "cli"], {
    cwd: unrelated,
    env: { ...shimEnv, NODE_PATH: "" },
    input: "",
    timeout: 15_000,
  });
  check(
    "an obsolete host-surface assertion fails closed through the shim",
    /no longer supported/.test(`${refused.stdout}${refused.stderr}`),
    `${refused.stdout}${refused.stderr}`.slice(0, 200),
  );

  // --- 6. Installer against fake providers ---------------------------------
  section("packed installer against fake provider CLIs");
  const fakeBin = createFakeProviders(workspace);
  const providerHome = join(workspace, "provider-home");
  mkdirSync(providerHome, { recursive: true });
  // Seed the zero-byte Antigravity config that broke a real installation.
  mkdirSync(join(providerHome, ".gemini", "config"), { recursive: true });
  writeFileSync(join(providerHome, ".gemini", "config", "mcp_config.json"), "");

  const productEnv = {
    ...process.env,
    HOME: providerHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    npm_config_prefix: prefix,
    NODE_PATH: "",
  };
  // The prompt sequence must survive BOTH transports. The Node 22 readline
  // stall reproduced on a pipe while a PTY happened to tolerate it, so testing
  // only one would have let the defect back in.
  const pipedInstall = run(synaphexBin, ["install"], {
    env: productEnv,
    input: "y\ny\ny\ny\n",
    timeout: 60_000,
  });
  check("installer terminated on a pipe", !pipedInstall.timedOut, "the TUI hung");
  check(
    "piped run reached the third provider prompt",
    /Google/.test(pipedInstall.stdout),
    pipedInstall.stdout.slice(-200),
  );
  check(
    "piped run configured hosts",
    /configured/.test(pipedInstall.stdout),
    pipedInstall.stdout.slice(-300),
  );

  const install = runOnPty(synaphexBin, ["install"], ["y", "y", "y", "y"], productEnv);
  if (install.available) {
    check("installer terminated on a PTY", !install.timedOut, "the TUI hung");
    check("PTY run reached the third provider prompt", /Google/.test(install.stdout));
    check(
      "PTY run reported host outcomes",
      /configured|already configured|refreshed/.test(install.stdout),
      install.stdout.slice(-300),
    );
  } else {
    process.stdout.write("  note script(1) unavailable; PTY path skipped\n");
  }

  for (const [flavor, provider] of [
    ["codex", "openai"],
    ["claude", "anthropic"],
    ["agy", "google"],
  ]) {
    const servers = readServers(providerHome, flavor);
    const entry = servers.synaphex;
    check(`${flavor}: synaphex registered`, entry !== undefined);
    if (entry !== undefined) {
      check(
        `${flavor}: registration carries the ${provider} host provider only`,
        entry.args?.includes("--host-provider") &&
          entry.args?.includes(provider) &&
          !entry.args?.includes("--host-surface"),
        JSON.stringify(entry.args),
      );
      check(
        `${flavor}: launcher points at the installed package`,
        typeof entry.command === "string" &&
          entry.command.startsWith("/") &&
          !String(entry.args?.[0] ?? "").startsWith(REPO),
        `${entry.command} ${entry.args?.[0]}`,
      );
    }
  }
  check(
    "zero-byte provider config was treated as absent, not corrupt",
    readServers(providerHome, "agy").synaphex !== undefined,
  );

  // --- 7. Reinstall is a no-op ---------------------------------------------
  section("reinstall");
  const before = JSON.stringify(readServers(providerHome, "claude"));
  const reinstall = runOnPty(synaphexBin, ["install"], ["y", "y", "y", "y"], productEnv);
  const reinstallOut = reinstall.available
    ? reinstall.stdout
    : run(synaphexBin, ["install"], { env: productEnv, input: "y\ny\ny\ny\n" }).stdout;
  check("reinstall reported already configured", /already configured/.test(reinstallOut));
  check(
    "reinstall created no duplicate registration",
    JSON.stringify(readServers(providerHome, "claude")) === before,
  );

  // --- 8. Foreign registration safety --------------------------------------
  section("foreign registration safety");
  const foreignHome = join(workspace, "foreign-home");
  mkdirSync(foreignHome, { recursive: true });
  writeFileSync(
    join(foreignHome, ".claude.json"),
    `${JSON.stringify({
      mcpServers: {
        synaphex: { type: "stdio", command: "/usr/bin/python3", args: ["/home/u/mine.py"] },
        unrelated: { type: "stdio", command: "/usr/bin/true", args: [] },
      },
    })}\n`,
  );
  const foreignEnv = { ...productEnv, HOME: foreignHome };
  const foreignInstall = runOnPty(synaphexBin, ["install"], ["n", "y", "n", "y"], foreignEnv);
  const foreignOut = foreignInstall.available
    ? foreignInstall.stdout
    : run(synaphexBin, ["install"], { env: foreignEnv, input: "n\ny\nn\ny\n" }).stdout;
  const foreignAfter = readServers(foreignHome, "claude");
  check(
    "a foreign synaphex entry is left untouched",
    foreignAfter.synaphex?.command === "/usr/bin/python3",
    JSON.stringify(foreignAfter.synaphex),
  );
  check("an unrelated server is preserved", foreignAfter.unrelated !== undefined);
  check(
    "the conflict is reported rather than silently ignored",
    /skipped|conflict|unrelated/i.test(foreignOut),
    foreignOut.slice(-200),
  );
  run(synaphexBin, ["uninstall"], { env: foreignEnv });
  const foreignAfterUninstall = readServers(foreignHome, "claude");
  check(
    "uninstall does not delete a foreign entry",
    foreignAfterUninstall.synaphex?.command === "/usr/bin/python3",
  );
  check(
    "uninstall preserves unrelated servers",
    foreignAfterUninstall.unrelated !== undefined,
  );

  // --- 9. Synaphex state preservation --------------------------------------
  section("Synaphex state preservation");
  const stateHome = providerHome;
  const stateRoot = join(stateHome, ".synaphex");
  mkdirSync(join(stateRoot, "projects", "prj_fixture", "artifacts"), { recursive: true });
  writeFileSync(
    join(stateRoot, "projects", "prj_fixture", "artifacts", "keep.json"),
    `${JSON.stringify({ preserved: true })}\n`,
  );
  const configPath = join(stateRoot, "agent_config.jsonc");
  const userConfig = readFileSync(configPath, "utf8");
  check("install created agent_config.jsonc", userConfig.length > 0);

  // All three managed configs exist and carry maintainer comments.
  for (const file of ["agent_config.jsonc", "agent_behavior.jsonc", "rules.jsonc"]) {
    const path = join(stateRoot, file);
    const present = existsSync(path);
    check(`install created ${file}`, present);
    if (present) {
      const contents = readFileSync(path, "utf8");
      check(
        `${file} carries maintainer comments`,
        contents.includes("Synaphex-managed comments"),
      );
    }
  }

  // Mutate a representative USER VALUE, then reinstall.
  const parsedConfig = JSON.parse(
    userConfig
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n"),
  );
  parsedConfig.agents.researcher = {
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  };
  writeFileSync(
    configPath,
    `// OLD-MARKER stale text\n${JSON.stringify(parsedConfig, null, 2)}\n`,
  );

  const reinstall2 = run(synaphexBin, ["install"], {
    env: productEnv,
    input: "y\ny\ny\ny\n",
  });
  void reinstall2;
  const afterConfig = readFileSync(configPath, "utf8");
  const afterValues = JSON.parse(
    afterConfig
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n"),
  );
  // Values survive; comments are regenerated. Compared by value, never bytes.
  check(
    "reinstall preserved the user's configured agent",
    afterValues.agents?.researcher?.model === "gpt-5.6-sol",
    JSON.stringify(afterValues.agents?.researcher),
  );
  check("reinstall dropped the stale comment", !afterConfig.includes("OLD-MARKER"));
  check(
    "reinstall restored canonical comments",
    afterConfig.includes("Synaphex-managed comments"),
  );
  run(synaphexBin, ["uninstall"], { env: productEnv });
  check(
    "uninstall preserved ~/.synaphex artifacts",
    existsSync(join(stateRoot, "projects", "prj_fixture", "artifacts", "keep.json")),
  );
  check("uninstall preserved agent_config.jsonc", existsSync(configPath));
  check(
    "uninstall removed the Synaphex registration",
    readServers(providerHome, "claude").synaphex === undefined,
  );

  // --- 10. Configure GUI from the installed package -------------------------
  //
  // Proves `synaphex configure` serves its pre-built UI and read-only API from
  // a plain global install. No browser is launched (--no-open) and no agent is
  // invoked; this is a packaging and boundary check.
  section("configure GUI");
  const configureHome = providerHome;
  const configure = spawn(synaphexBin, ["configure", "--no-open"], {
    env: { ...productEnv, HOME: configureHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = await new Promise((resolvePromise, rejectPromise) => {
      let buffered = "";
      const timer = setTimeout(
        () => rejectPromise(new Error("configure did not print a URL")),
        20_000,
      );
      configure.stdout.on("data", (chunk) => {
        buffered += chunk.toString("utf8");
        const found = /http:\/\/127\.0\.0\.1:\d+/.exec(buffered);
        if (found !== null) {
          clearTimeout(timer);
          resolvePromise(found[0]);
        }
      });
      configure.once("error", rejectPromise);
    });
    check("configure printed a loopback URL", url.startsWith("http://127.0.0.1:"));

    const page = await fetch(url);
    const html = await page.text();
    check("configure serves the built UI", page.status === 200);
    check(
      "configure UI ships its bundle",
      /\/assets\/[A-Za-z0-9._-]+\.js/.test(html),
    );
    check(
      "configure injected a session token",
      !html.includes("__SYNAPHEX_CONFIGURE_TOKEN__"),
    );

    const token = /content="([a-f0-9]{64})"/.exec(html)?.[1] ?? "";
    const status = await fetch(`${url}/api/status`, {
      headers: { "x-synaphex-configure-token": token, origin: url },
    });
    const payload = await status.json();
    check("configure API reports six agents", payload.agents === 6);

    const catalogResponse = await fetch(`${url}/api/model-capabilities`, {
      headers: { "x-synaphex-configure-token": token, origin: url },
    });
    const catalog = await catalogResponse.json();
    check("configure API ships the model capability catalog", catalogResponse.status === 200);
    const catalogTargets = new Map(
      (catalog.targets ?? []).map((entry) => [`${entry.provider}/${entry.surface}`, entry]),
    );
    check(
      "packed catalog contains the supported CLI models",
      catalogTargets.get("openai/cli")?.models?.[0]?.id === "gpt-5.6-sol" &&
        catalogTargets.get("anthropic/cli")?.models?.[0]?.id === "claude-sonnet-4-5" &&
        catalogTargets.get("google/cli")?.models?.length === 0,
    );
    check(
      "packed catalog preserves model setting metadata",
      catalogTargets.get("openai/cli")?.models?.[0]?.settings?.[0]?.key ===
        "reasoning_effort" &&
        catalogTargets.get("openai/cli")?.models?.[0]?.settings?.[0]?.defaultBehavior ===
          "provider_native",
    );

    const diagnosticsResponse = await fetch(`${url}/api/diagnostics`, {
      headers: { "x-synaphex-configure-token": token, origin: url },
    });
    const diagnostics = await diagnosticsResponse.json();
    check("configure API serves diagnostics", diagnosticsResponse.status === 200);
    check(
      "configure diagnostics include Node and platform",
      /^v\d+\.\d+\.\d+/.test(diagnostics.nodeVersion) &&
        typeof diagnostics.platform === "string" &&
        diagnostics.platform.length > 0,
    );
    const diagnosticProviders = new Map(
      (diagnostics.providers ?? []).map((entry) => [entry.provider, entry]),
    );
    check(
      "configure diagnostics include provider versions",
      diagnosticProviders.get("openai")?.version === "0.153.0" &&
        diagnosticProviders.get("anthropic")?.version === "2.1.260" &&
        diagnosticProviders.get("google")?.version === "1.1.26",
    );
    check(
      "configure diagnostics distinguish host and target support",
      diagnosticProviders.get("google")?.supportedAsHost === true &&
        diagnosticProviders.get("google")?.supportedAsTarget === false,
    );
    check(
      "configure diagnostics report registration state",
      [...diagnosticProviders.values()].every(
        (entry) => entry.registered === false,
      ),
    );

    const unauthorized = await fetch(`${url}/api/status`);
    check("configure API refuses an untokened request", unauthorized.status === 401);
  } finally {
    configure.kill("SIGTERM");
  }

  section(`\n${checks - failures}/${checks} checks passed`);
  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  process.stdout.write(`\nfatal: ${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

/** Speaks just enough MCP to prove the installed server initializes. */
async function probeMcp(command, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { PATH: "/usr/bin:/bin", HOME: cwd, NODE_PATH: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let settled = false;
    const finish = (tools, detail) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolvePromise({ tools, detail });
    };
    const timer = setTimeout(() => finish(0, "timed out"), 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (const line of buffer.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
        }
        if (message.id === 2) {
          clearTimeout(timer);
          finish(message.result?.tools?.length ?? 0, "");
        }
      }
    });
    child.on("error", (error) => finish(0, error.message));
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "packed-smoke", version: "0.0.0" },
        },
      })}\n`,
    );
  });
}

process.exit(exitCode);
