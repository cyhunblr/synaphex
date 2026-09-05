import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  SUPPORTED_INSTALLATION_TARGETS,
  SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
  isSupportedTarget,
  launcherArgsFor,
  type InstallationTarget,
  type SynaphexLauncher,
} from "../src/domain/installation.js";
import { AntigravityMcpRegistrar } from "../src/installer/antigravity-mcp-registrar.js";
import { ClaudeMcpRegistrar } from "../src/installer/claude-mcp-registrar.js";
import { CodexMcpRegistrar } from "../src/installer/codex-mcp-registrar.js";
import { createRegistrars } from "../src/installer/create-registrars.js";
import { InstallationPlanner, targetKey } from "../src/installer/installation-planner.js";
import { InstallerService } from "../src/installer/installer-service.js";
import type {
  ProviderCommandInput,
  ProviderCommandResult,
  ProviderCommandRunner,
} from "../src/installer/provider-command-runner.js";
import { SpawnProviderCommandRunner } from "../src/installer/provider-command-runner.js";
import {
  ProviderMcpRegistrationFailedError,
  ProviderMcpUnregistrationFailedError,
} from "../src/domain/errors.js";
import type { ProviderMcpRegistrar } from "../src/installer/provider-mcp-registrar.js";

const LAUNCHER: SynaphexLauncher = {
  command: "/opt/node/bin/node",
  args: ["/opt/pkg/synaphex/dist/mcp/stdio-main.js"],
};

const OPENAI_CLI: InstallationTarget = { provider: "openai" };
const ANTHROPIC_CLI: InstallationTarget = { provider: "anthropic" };
const GOOGLE_CLI: InstallationTarget = { provider: "google" };

/**
 * A scripted provider runtime. Records every command so tests can prove that
 * no model invocation, login or install command is ever issued.
 */
class FakeRunner implements ProviderCommandRunner {
  readonly calls: ProviderCommandInput[] = [];
  /**
   * File-inspecting registrars (Claude, agy) read a config under HOME, so the
   * fake writes one into an isolated directory. This is what keeps unit tests
   * from ever reading the developer's real provider configuration.
   */
  home = "";
  /** True once this runner has itself registered something. */
  private owned = false;
  private readonly responses = new Map<string, ProviderCommandResult>();
  private readonly state = new Map<string, { command: string; args: string[] }>();
  failRegistration = false;

  constructor(private readonly version = "9.9.9") {}

  script(key: string, result: ProviderCommandResult): void {
    this.responses.set(key, result);
  }

  seed(name: string, command: string, args: string[]): void {
    this.state.set(name, { command, args });
  }

  entries(): ReadonlyMap<string, { command: string; args: string[] }> {
    return this.state;
  }

  /** Mirrors state into the config files the file-reading registrars parse. */
  private async sync(home?: string): Promise<void> {
    const root = home ?? this.home;
    if (root === "") {
      return;
    }
    const servers = Object.fromEntries(
      [...this.state.entries()].map(([name, entry]) => [
        name,
        { type: "stdio", command: entry.command, args: entry.args },
      ]),
    );
    // A runner that never registered anything must not wipe a config another
    // runner wrote; in these fakes several runners can share one HOME.
    if (Object.keys(servers).length === 0 && !this.owned) {
      return;
    }
    await writeFile(
      join(root, ".claude.json"),
      JSON.stringify({ mcpServers: servers }),
      "utf8",
    );
    await mkdir(join(root, ".gemini", "config"), { recursive: true });
    await writeFile(
      join(root, ".gemini", "config", "mcp_config.json"),
      JSON.stringify({ mcpServers: servers }),
      "utf8",
    );
  }

  async run(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    this.calls.push(input);
    const key = `${input.command} ${input.args.join(" ")}`;
    const scripted = this.responses.get(key);
    if (scripted !== undefined) {
      return scripted;
    }
    if (input.args[0] === "--version") {
      return { exitCode: 0, stdout: this.version, stderr: "" };
    }
    if (input.args[0] === "mcp") {
      const sub = input.args[1];
      if (sub === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            [...this.state.entries()].map(([name, entry]) => ({
              name,
              transport: { type: "stdio", command: entry.command, args: entry.args },
            })),
          ),
          stderr: "",
        };
      }
      if (sub === "add") {
        if (this.failRegistration) {
          return { exitCode: 1, stdout: "", stderr: "provider refused" };
        }
        const name = input.args[2]!;
        const rest = input.args.slice(3).filter((value) => value !== "--");
        // Skip provider flags such as --scope user.
        const start = rest.findIndex((value) => value.startsWith("/"));
        this.state.set(name, {
          command: rest[start]!,
          args: rest.slice(start + 1),
        });
        this.owned = true;
        await this.sync(input.home);
        return { exitCode: 0, stdout: "added", stderr: "" };
      }
      if (sub === "remove") {
        const name = input.args[2]!;
        const existed = this.state.delete(name);
        if (existed) {
          this.owned = true;
        }
        await this.sync(input.home);
        return existed
          ? { exitCode: 0, stdout: "removed", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "no such server" };
      }
    }
    return { exitCode: 1, stdout: "", stderr: "unexpected command" };
  }
}

function codexRegistrar(runner: FakeRunner): CodexMcpRegistrar {
  return new CodexMcpRegistrar(OPENAI_CLI, runner);
}

// ---------------------------------------------------------------------------
// Host matrix
// ---------------------------------------------------------------------------

test("the supported host matrix is provider-only", () => {
  assert.deepEqual(
    SUPPORTED_INSTALLATION_TARGETS.map((t) => t.provider).sort(),
    ["anthropic", "google", "openai"],
  );
  // No surface dimension exists at all: a provider's CLI and its VS Code
  // extension share ONE MCP registration, so offering them separately would
  // offer a distinction the installer cannot deliver (ADR 0009).
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    assert.equal(Object.hasOwn(target, "surface"), false);
  }
  assert.equal(isSupportedTarget({ provider: "openai" }), true);
  assert.equal(
    isSupportedTarget({ provider: "acme" as never }),
    false,
    "an unknown provider is not a supported host",
  );
});

test("no registrar asserts a host surface", async () => {
  // Structural: registrars are keyed by provider alone, so no code path can
  // write a surface-asserting registration.
  const registrars = createRegistrars(new SpawnProviderCommandRunner());
  assert.deepEqual([...registrars.keys()].sort(), ["anthropic", "google", "openai"]);
  for (const registrar of registrars.values()) {
    assert.equal(Object.hasOwn(registrar.target, "surface"), false);
  }
});

test("launcher argv carries exactly the immutable host context", () => {
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    assert.deepEqual(launcherArgsFor("/pkg/dist/mcp/stdio-main.js", target), [
      "/pkg/dist/mcp/stdio-main.js",
      "--host-provider",
      target.provider,
    ]);
  }
});

// ---------------------------------------------------------------------------
// Registration, collision, ownership
// ---------------------------------------------------------------------------

test("registration writes the absolute launcher and host context", async () => {
  const runner = new FakeRunner();
  await codexRegistrar(runner).register(LAUNCHER);
  const entry = runner.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME);
  assert.equal(entry?.command, LAUNCHER.command);
  assert.deepEqual(entry?.args, [LAUNCHER.args[0], "--host-provider", "openai"]);
  // No surface is asserted anywhere in the registration.
  assert.equal(entry?.args.includes("--host-surface"), false);
  // Never a bare `node` or a PATH-relative command.
  assert.equal(entry!.command.startsWith("/"), true);
  assert.equal(entry!.args[0]!.startsWith("/"), true);
});

test("an already-correct registration is a no-op, not a duplicate", async () => {
  const runner = new FakeRunner();
  await codexRegistrar(runner).register(LAUNCHER);
  const addsBefore = runner.calls.filter((c) => c.args[1] === "add").length;
  await codexRegistrar(runner).register(LAUNCHER);
  const addsAfter = runner.calls.filter((c) => c.args[1] === "add").length;
  assert.equal(addsAfter, addsBefore, "a current registration must not be rewritten");
  assert.equal(runner.entries().size, 1);
});

test("a stale Synaphex-owned registration is refreshed", async () => {
  const runner = new FakeRunner();
  runner.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, "/old/node", [
    "/old/pkg/dist/mcp/stdio-main.js",
    "--host-provider",
    "openai",
    "--host-surface",
    "cli",
  ]);
  const inspection = await codexRegistrar(runner).inspect(LAUNCHER);
  assert.equal(inspection.state, "outdated");

  await codexRegistrar(runner).register(LAUNCHER);
  const entry = runner.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME);
  assert.equal(entry?.command, LAUNCHER.command);
  assert.equal(runner.entries().size, 1);
});

test("a foreign server with the Synaphex name is never overwritten", async () => {
  const runner = new FakeRunner();
  runner.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, "/usr/bin/python3", [
    "/home/user/my-own-server.py",
  ]);
  const inspection = await codexRegistrar(runner).inspect(LAUNCHER);
  assert.equal(inspection.state, "foreign");

  await assert.rejects(
    () => codexRegistrar(runner).register(LAUNCHER),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, "PROVIDER_MCP_REGISTRATION_CONFLICT");
      return true;
    },
  );
  // Untouched.
  assert.deepEqual(runner.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME), {
    command: "/usr/bin/python3",
    args: ["/home/user/my-own-server.py"],
  });
});

test("our own legacy surface-asserting registration migrates, a foreign one does not", async () => {
  // The exact shape Synaphex used to write is recognised so reinstall can
  // MIGRATE it rather than mistaking it for someone else's server.
  const legacy = new FakeRunner();
  legacy.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, LAUNCHER.command, [
    LAUNCHER.args[0]!,
    "--host-provider",
    "openai",
    "--host-surface",
    "cli",
  ]);
  assert.equal((await codexRegistrar(legacy).inspect(LAUNCHER)).state, "outdated");
  await codexRegistrar(legacy).register(LAUNCHER);
  assert.deepEqual(
    legacy.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME)?.args,
    [LAUNCHER.args[0], "--host-provider", "openai"],
  );

  // A `vscode` assertion is a shape Synaphex NEVER wrote, so it is foreign and
  // must not be overwritten merely because the server name matches.
  const foreign = new FakeRunner();
  foreign.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, LAUNCHER.command, [
    LAUNCHER.args[0]!,
    "--host-provider",
    "openai",
    "--host-surface",
    "vscode",
  ]);
  assert.equal((await codexRegistrar(foreign).inspect(LAUNCHER)).state, "foreign");
  await assert.rejects(
    () => codexRegistrar(foreign).register(LAUNCHER),
    (error: unknown) => {
      assert.equal(
        (error as { code: string }).code,
        "PROVIDER_MCP_REGISTRATION_CONFLICT",
      );
      return true;
    },
  );
  assert.deepEqual(
    foreign.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME)?.args?.slice(-2),
    ["--host-surface", "vscode"],
    "the foreign entry must be left untouched",
  );
});

test("version below the installer minimum is reported, not registered", async () => {
  const runner = new FakeRunner("0.1.0");
  const availability = await codexRegistrar(runner).detect();
  assert.equal(availability.state, "unsupported_version");
});

test("a missing runtime is detected without inferring from config files", async () => {
  const runner = new FakeRunner();
  runner.script("codex --version", { exitCode: 127, stdout: "", stderr: "not found" });
  assert.deepEqual(await codexRegistrar(runner).detect(), { state: "not_found" });
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function plannerWith(
  entries: readonly [InstallationTarget, ProviderMcpRegistrar][],
): InstallationPlanner {
  return new InstallationPlanner({
    registrars: new Map(entries.map(([target, r]) => [targetKey(target), r])),
  });
}

test("planning performs no mutation", async () => {
  const runner = new FakeRunner();
  const plan = await plannerWith([[OPENAI_CLI, codexRegistrar(runner)]]).planInstall(
    [OPENAI_CLI],
    LAUNCHER,
  );
  assert.deepEqual(plan.mutations, [{ target: OPENAI_CLI, action: "register" }]);
  // Nothing was registered by planning alone.
  assert.equal(runner.entries().size, 0);
  assert.equal(runner.calls.some((c) => c.args[1] === "add"), false);
});

test("an unsupported provider is refused by the plan", async () => {
  const plan = await plannerWith([]).planInstall(
    [{ provider: "acme" as never }],
    LAUNCHER,
  );
  assert.deepEqual(plan.mutations, []);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0]!.reason, /not supported/);
});

// ---------------------------------------------------------------------------
// Install / uninstall behaviour
// ---------------------------------------------------------------------------

function serviceWith(
  entries: readonly [InstallationTarget, ProviderMcpRegistrar][],
): InstallerService {
  const registrars = new Map(entries.map(([t, r]) => [targetKey(t), r]));
  return new InstallerService({
    registrars,
    planner: new InstallationPlanner({ registrars }),
  });
}

test("one host failing does not roll back or abort another", async (t) => {
  // Registrations are independent: a failure on one host must neither abort
  // the run nor undo a host that already succeeded.
  const home = await temporaryHome(t);
  const okRunner = new FakeRunner();
  const failing: ProviderMcpRegistrar = {
    target: ANTHROPIC_CLI,
    async detect() {
      return { state: "available", version: "9.9.9" };
    },
    async inspect() {
      return { state: "absent" };
    },
    async register() {
      throw new ProviderMcpRegistrationFailedError("Anthropic", "provider refused");
    },
    async unregister() {},
  };
  const service = serviceWith([
    [OPENAI_CLI, codexRegistrar(okRunner)],
    [ANTHROPIC_CLI, failing],
  ]);
  const plan = await service.plan([OPENAI_CLI, ANTHROPIC_CLI], LAUNCHER, home);
  const report = await service.apply(plan, LAUNCHER, home);

  const byTarget = new Map(report.outcomes.map((o) => [o.target.provider, o]));
  assert.equal(byTarget.get("openai")?.status, "configured");
  assert.equal(byTarget.get("anthropic")?.status, "failed");
  assert.equal(byTarget.get("anthropic")?.code, "PROVIDER_MCP_REGISTRATION_FAILED");
  // The successful registration survives.
  assert.equal(okRunner.entries().size, 1);
});

test("uninstall removes only provably Synaphex-owned registrations", async () => {
  const runner = new FakeRunner();
  await codexRegistrar(runner).register(LAUNCHER);
  const service = serviceWith([[OPENAI_CLI, codexRegistrar(runner)]]);

  const report = await service.uninstall([OPENAI_CLI], LAUNCHER);
  assert.equal(report.outcomes[0]?.status, "removed");
  assert.equal(runner.entries().size, 0);
});

test("uninstall never deletes a drifted or foreign entry", async () => {
  const runner = new FakeRunner();
  runner.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, "/usr/bin/python3", [
    "/home/user/other.py",
  ]);
  const service = serviceWith([[OPENAI_CLI, codexRegistrar(runner)]]);

  const report = await service.uninstall([OPENAI_CLI], LAUNCHER);
  assert.equal(report.outcomes[0]?.status, "skipped");
  assert.equal(report.outcomes[0]?.code, "PROVIDER_MCP_REGISTRATION_CONFLICT");
  // Still there.
  assert.equal(runner.entries().size, 1);
});

test("uninstalling an absent registration is a harmless no-op", async () => {
  const runner = new FakeRunner();
  const service = serviceWith([[OPENAI_CLI, codexRegistrar(runner)]]);
  const report = await service.uninstall([OPENAI_CLI], LAUNCHER);
  assert.equal(report.outcomes[0]?.status, "not_configured");
});

test("uninstall continues after an individual cleanup failure", async (t) => {
  // A registrar whose removal always fails, so the invariant under test is
  // "keep going", not fake-harness bookkeeping.
  const failing: ProviderMcpRegistrar = {
    target: ANTHROPIC_CLI,
    async detect() {
      return { state: "available", version: "9.9.9" };
    },
    async inspect() {
      return { state: "current" };
    },
    async register() {},
    async unregister() {
      throw new ProviderMcpUnregistrationFailedError("Anthropic CLI", "busy");
    },
  };
  const okHome = await temporaryHome(t);
  const okRunner = new FakeRunner();
  await codexRegistrar(okRunner).register(LAUNCHER, okHome);
  const googleRunner = new FakeRunner();

  const service = serviceWith([
    [OPENAI_CLI, codexRegistrar(okRunner)],
    [ANTHROPIC_CLI, failing],
    [GOOGLE_CLI, new AntigravityMcpRegistrar(GOOGLE_CLI, googleRunner)],
  ]);
  const report = await service.uninstall(
    [OPENAI_CLI, ANTHROPIC_CLI, GOOGLE_CLI],
    LAUNCHER,
    okHome,
  );
  const byTarget = new Map(
    report.outcomes.map((o) => [o.target.provider, o.status]),
  );
  // The failure of one host neither aborts nor alters the others.
  assert.equal(byTarget.get("openai"), "removed");
  assert.equal(byTarget.get("anthropic"), "failed");
  assert.equal(byTarget.get("google"), "not_configured");
  assert.equal(
    report.outcomes.find((o) => o.target.provider === "anthropic")?.code,
    "PROVIDER_MCP_UNREGISTRATION_FAILED",
  );
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("the installer never installs software, manages auth, or invokes a model", async () => {
  const runner = new FakeRunner();
  const service = serviceWith([[OPENAI_CLI, codexRegistrar(runner)]]);
  const plan = await service.plan([OPENAI_CLI], LAUNCHER);
  await service.apply(plan, LAUNCHER);
  await service.uninstall([OPENAI_CLI], LAUNCHER);

  for (const call of runner.calls) {
    // Only version probes and MCP management commands are ever issued.
    assert.ok(
      call.args[0] === "--version" || call.args[0] === "mcp",
      `unexpected provider command: ${call.args.join(" ")}`,
    );
    for (const forbidden of [
      "login",
      "logout",
      "install",
      "exec",
      "-p",
      "--print",
      "auth",
      "token",
    ]) {
      assert.equal(
        call.args.includes(forbidden),
        false,
        `installer must not run ${forbidden}`,
      );
    }
  }
});

test("installer sources reference no package manager or credential operation", async () => {
  const { readdir } = await import("node:fs/promises");
  const directory = join(process.cwd(), "src", "installer");
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".ts"))) {
    const source = await readFile(join(directory, name), "utf8");
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const forbidden of [
      "npm install",
      "apt-get",
      "brew ",
      "curl ",
      "--install-extension",
      "shell: true",
      "bash",
      "sh -c",
      "credential",
      "apiKey",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      assert.equal(code.includes(forbidden), false, `${name} references ${forbidden}`);
    }
  }
});

test("provider commands run without a shell", async () => {
  const source = await readFile(
    join(process.cwd(), "src/installer/provider-command-runner.ts"),
    "utf8",
  );
  assert.match(source, /shell:\s*false/);
});

// ---------------------------------------------------------------------------
// Real runtime registration, isolated to a temporary HOME
// ---------------------------------------------------------------------------

async function temporaryHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "synaphex-installer-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

/**
 * Exercises the REAL provider CLIs against an isolated HOME.
 *
 * Skipped when a runtime is absent. These never touch the developer's real
 * configuration, never authenticate and never invoke a model.
 */
for (const [label, target, factory] of [
  ["codex", OPENAI_CLI, (r: ProviderCommandRunner) => new CodexMcpRegistrar(OPENAI_CLI, r)],
  ["claude", ANTHROPIC_CLI, (r: ProviderCommandRunner) => new ClaudeMcpRegistrar(ANTHROPIC_CLI, r)],
  ["agy", GOOGLE_CLI, (r: ProviderCommandRunner) => new AntigravityMcpRegistrar(GOOGLE_CLI, r)],
] as const) {
  test(`${label}: real runtime accepts the generated registration (isolated HOME)`, async (t) => {
    const runner = new SpawnProviderCommandRunner();
    const registrar = factory(runner);
    const home = await temporaryHome(t);

    const availability = await registrar.detect(home);
    if (availability.state !== "available") {
      t.diagnostic(`${label} unavailable (${availability.state}); skipping`);
      return;
    }
    t.diagnostic(`${label} ${availability.version}`);

    assert.deepEqual(await registrar.inspect(LAUNCHER, home), { state: "absent" });
    await registrar.register(LAUNCHER, home);

    // The runtime round-trips the exact launcher and host context.
    assert.deepEqual(await registrar.inspect(LAUNCHER, home), { state: "current" });
    // Re-registering is a no-op, not a duplicate.
    await registrar.register(LAUNCHER, home);
    assert.deepEqual(await registrar.inspect(LAUNCHER, home), { state: "current" });

    await registrar.unregister(home);
    assert.deepEqual(await registrar.inspect(LAUNCHER, home), { state: "absent" });
  });
}

test("real registrars are constructed for every supported target", () => {
  const registrars = createRegistrars(new SpawnProviderCommandRunner());
  assert.equal(registrars.size, SUPPORTED_INSTALLATION_TARGETS.length);
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    assert.equal(registrars.get(targetKey(target))?.target.provider, target.provider);
  }
});

// ---------------------------------------------------------------------------
// Regressions found during real-machine validation (Phase 6B2)
// ---------------------------------------------------------------------------

test("an empty provider config file means absent, not unverifiable", async (t) => {
  // Found on a real machine: agy had left a ZERO-BYTE mcp_config.json behind.
  // Treating that as "could not verify" made the registrar fail closed and
  // wedged installation on a perfectly ordinary state.
  const home = await temporaryHome(t);
  for (const [file, registrar] of [
    [
      join(home, ".claude.json"),
      new ClaudeMcpRegistrar(ANTHROPIC_CLI, new FakeRunner()),
    ],
    [
      join(home, ".gemini", "config", "mcp_config.json"),
      new AntigravityMcpRegistrar(GOOGLE_CLI, new FakeRunner()),
    ],
  ] as const) {
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "", "utf8");
    assert.deepEqual(
      await registrar.inspect(LAUNCHER, home),
      { state: "absent" },
      `${file} should read as absent`,
    );
    // Whitespace-only behaves the same way.
    await writeFile(file, "\n  \n", "utf8");
    assert.deepEqual(await registrar.inspect(LAUNCHER, home), { state: "absent" });
    // Genuinely malformed content still fails closed.
    await writeFile(file, "{ this is not json", "utf8");
    assert.equal((await registrar.inspect(LAUNCHER, home)).state, "unknown");
  }
});

test("both bins share one symlink-safe entrypoint guard", async () => {
  // Two separate defects of the same family: the installer bin matched on a
  // filename suffix, and the MCP bin compared `import.meta.url` against an
  // unresolved `argv[1]`. npm installs both as symlinks, so each exited 0 in
  // total silence -- and running the built file directly still worked, which
  // is why the source suite never saw it.
  for (const file of ["src/installer/cli-main.ts", "src/mcp/stdio-main.ts"]) {
    const code = (await readFile(join(process.cwd(), file), "utf8"))
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    assert.match(
      code,
      /isProcessEntrypoint\(import\.meta\.url\)/,
      `${file} must use the shared symlink-safe guard`,
    );
    // Neither of the two broken shapes may come back.
    assert.equal(code.includes('endsWith("cli-main.js")'), false, file);
    assert.equal(
      /import\.meta\.url === new URL\(`file:\/\/\$\{process\.argv\[1\]\}`\)/.test(code),
      false,
      `${file} must not compare an unresolved argv[1]`,
    );
  }
  // The shared helper resolves symlinks on both sides.
  const helper = await readFile(
    join(process.cwd(), "src/infrastructure/process-entrypoint.ts"),
    "utf8",
  );
  assert.match(helper, /realpathSync\(entry\)/);
  assert.match(helper, /realpathSync\(fileURLToPath\(moduleUrl\)\)/);
});

test("the CLI entrypoint guard survives npm's bin symlink", async () => {
  // Found on a real machine: npm installs `synaphex` as a symlink to
  // cli-main.js, so process.argv[1] is the SYMLINK path. A guard matching
  // `endsWith("cli-main.js")` never fired and the command exited 0 printing
  // nothing at all.
  const source = await readFile(
    join(process.cwd(), "src/installer/cli-main.ts"),
    "utf8",
  );
  const code = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  assert.equal(
    code.includes('endsWith("cli-main.js")'),
    false,
    "entrypoint detection must not match on a filename suffix",
  );
  // It must delegate to the shared symlink-safe helper instead.
  assert.match(code, /isProcessEntrypoint/);
});

test("the installer asks every provider through one prompt channel", async () => {
  // Found on a real machine: opening a second readline interface on stdin --
  // and even a third sequential `question()` on ONE interface -- stalls on
  // Node 22, so the Google prompt never appeared. The line-iterator pattern is
  // what actually works, on both a pipe and a PTY.
  const source = await readFile(
    join(process.cwd(), "src/installer/cli-main.ts"),
    "utf8",
  );
  const code = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  // Exactly one interface is constructed for the whole interaction.
  assert.equal(
    (code.match(/createInterface\(/g) ?? []).length,
    1,
    "a second readline interface on stdin stalls the prompt sequence",
  );
  assert.equal(
    code.includes("rl.question("),
    false,
    "sequential rl.question() calls stall after the second prompt",
  );
  assert.match(code, /Symbol\.asyncIterator/);
});
