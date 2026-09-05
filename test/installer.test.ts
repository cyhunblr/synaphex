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
import { ProviderMcpUnregistrationFailedError } from "../src/domain/errors.js";
import type { ProviderMcpRegistrar } from "../src/installer/provider-mcp-registrar.js";

const LAUNCHER: SynaphexLauncher = {
  command: "/opt/node/bin/node",
  args: ["/opt/pkg/synaphex/dist/mcp/stdio-main.js"],
};

const OPENAI_CLI: InstallationTarget = { provider: "openai", surface: "cli" };
const ANTHROPIC_CLI: InstallationTarget = { provider: "anthropic", surface: "cli" };
const GOOGLE_CLI: InstallationTarget = { provider: "google", surface: "cli" };

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

test("the supported host matrix is exactly the audited one", () => {
  assert.deepEqual(
    SUPPORTED_INSTALLATION_TARGETS.map((t) => `${t.provider}/${t.surface}`).sort(),
    [
      "anthropic/cli",
      "anthropic/vscode",
      "google/cli",
      "openai/cli",
      "openai/vscode",
    ],
  );
  // Google is Antigravity CLI only: no IDE surface.
  assert.equal(isSupportedTarget({ provider: "google", surface: "vscode" }), false);
});

test("no Gemini runtime appears anywhere in the installer", async () => {
  const { readdir } = await import("node:fs/promises");
  const directory = join(process.cwd(), "src", "installer");
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".ts"))) {
    const source = await readFile(join(directory, name), "utf8");
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const forbidden of ['"gemini"', '"gemini-cli"', "geminiCli"]) {
      assert.equal(code.includes(forbidden), false, `${name} references ${forbidden}`);
    }
  }
});

test("launcher argv carries exactly the immutable host context", () => {
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    assert.deepEqual(launcherArgsFor("/pkg/dist/mcp/stdio-main.js", target), [
      "/pkg/dist/mcp/stdio-main.js",
      "--host-provider",
      target.provider,
      "--host-surface",
      target.surface,
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
  assert.deepEqual(entry?.args, [
    LAUNCHER.args[0],
    "--host-provider",
    "openai",
    "--host-surface",
    "cli",
  ]);
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

test("a registration whose host context drifted is not treated as current", async () => {
  const runner = new FakeRunner();
  // Right entrypoint, WRONG surface: must refresh rather than silently accept.
  runner.seed(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, LAUNCHER.command, [
    LAUNCHER.args[0]!,
    "--host-provider",
    "openai",
    "--host-surface",
    "vscode",
  ]);
  assert.equal((await codexRegistrar(runner).inspect(LAUNCHER)).state, "outdated");
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

test("selecting both surfaces of a shared-config provider registers once", async () => {
  // Verified against the real runtimes: the OpenAI and Anthropic VS Code
  // extensions read the same global config their CLI writes, and a second
  // registration REPLACES the first. Two registrations cannot coexist.
  const runner = new FakeRunner();
  const vscode: InstallationTarget = { provider: "openai", surface: "vscode" };
  const planner = plannerWith([
    [OPENAI_CLI, codexRegistrar(runner)],
    [vscode, new CodexMcpRegistrar(vscode, runner)],
  ]);
  const plan = await planner.planInstall([OPENAI_CLI, vscode], LAUNCHER);

  assert.deepEqual(plan.mutations.map((m) => m.target.surface), ["cli"]);
  assert.equal(
    plan.skipped.some(
      (s) => s.target.surface === "vscode" && s.reason.includes("covered by the CLI"),
    ),
    true,
  );
  assert.equal(plan.warnings.length > 0, true);
});

test("a VS Code-only selection still registers with the vscode host context", async (t) => {
  const runner = new FakeRunner();
  const home = await temporaryHome(t);
  const vscode: InstallationTarget = { provider: "anthropic", surface: "vscode" };
  await new ClaudeMcpRegistrar(vscode, runner).register(LAUNCHER, home);
  assert.deepEqual(runner.entries().get(SYNAPHEX_MCP_SERVER_REGISTRATION_NAME)?.args, [
    LAUNCHER.args[0],
    "--host-provider",
    "anthropic",
    "--host-surface",
    "vscode",
  ]);
});

test("an unsupported provider/surface combination is refused by the plan", async () => {
  const plan = await plannerWith([]).planInstall(
    [{ provider: "google", surface: "vscode" }],
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
  const home = await temporaryHome(t);
  const okRunner = new FakeRunner();
  const badRunner = new FakeRunner();
  badRunner.failRegistration = true;
  const service = serviceWith([
    [OPENAI_CLI, codexRegistrar(okRunner)],
    [ANTHROPIC_CLI, new ClaudeMcpRegistrar(ANTHROPIC_CLI, badRunner)],
  ]);
  const plan = await service.plan([OPENAI_CLI, ANTHROPIC_CLI], LAUNCHER, home);
  const report = await service.apply(plan, LAUNCHER, home);

  const byTarget = new Map(
    report.outcomes.map((o) => [`${o.target.provider}/${o.target.surface}`, o]),
  );
  assert.equal(byTarget.get("openai/cli")?.status, "configured");
  assert.equal(byTarget.get("anthropic/cli")?.status, "failed");
  assert.equal(
    byTarget.get("anthropic/cli")?.code,
    "PROVIDER_MCP_REGISTRATION_FAILED",
  );
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
    report.outcomes.map((o) => [`${o.target.provider}/${o.target.surface}`, o.status]),
  );
  // The failure of one host neither aborts nor alters the others.
  assert.equal(byTarget.get("openai/cli"), "removed");
  assert.equal(byTarget.get("anthropic/cli"), "failed");
  assert.equal(byTarget.get("google/cli"), "not_configured");
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
    assert.equal(registrars.get(targetKey(target))?.target.surface, target.surface);
  }
});
