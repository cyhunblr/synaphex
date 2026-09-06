import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SynaphexError } from "../domain/errors.js";
import type { RuleScope } from "../domain/rule.js";
import type { ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import { readConfigureAsset } from "./configure-assets.js";
import {
  ConfigureReadModels,
  type ConfigureReadDependencies,
  type RuleScopeSelection,
} from "./configure-read-models.js";
import { ConfigureSession, SESSION_TOKEN_HEADER } from "./configure-security.js";
import {
  ConfigureStaleWriteError,
  ConfigureWriteService,
} from "./configure-write-service.js";

/**
 * The local configuration server.
 *
 * Deliberately narrow: it serves the built UI and a fixed set of
 * configuration endpoints. There is no filesystem read/write endpoint, no
 * shell, no provider execution and no MCP invocation, so the worst a request
 * can do is edit Synaphex configuration through the same domain services the
 * CLI uses -- and only after passing the loopback, token and origin checks.
 */

/** Bodies are tiny; this only bounds a hostile or accidental large POST. */
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export interface ConfigureServerOptions extends ConfigureReadDependencies {
  /** 0 asks the OS for a free port, which is the normal path. */
  readonly port?: number;
}

export interface RunningConfigureServer {
  readonly port: number;
  readonly token: string;
  readonly url: string;
  close(): Promise<void>;
}

export async function startConfigureServer(
  options: ConfigureServerOptions = {},
): Promise<RunningConfigureServer> {
  const reads = new ConfigureReadModels(options);
  const writes = new ConfigureWriteService(reads);

  // Bound before the session exists so the session can pin the real port.
  const server = createServer();
  const port = await listenLoopback(server, options.port ?? 0);
  const session = new ConfigureSession(port);

  server.on("request", (request, response) => {
    handle(request, response, session, reads, writes).catch(() => {
      // A handler that throws past its own error mapping must not take the
      // process down; the connection is closed with a generic failure.
      if (!response.headersSent) {
        sendJson(response, 500, { error: "internal_error" });
      } else {
        response.end();
      }
    });
  });

  return {
    port,
    token: session.token,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Idle keep-alive sockets would otherwise hold the process open.
        server.closeAllConnections?.();
      }),
  };
}

/**
 * Binds loopback explicitly.
 *
 * `127.0.0.1` rather than a default or `0.0.0.0`: the configure surface edits
 * local configuration and must never be reachable from the network.
 */
function listenLoopback(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  session: ConfigureSession,
  reads: ConfigureReadModels,
  writes: ConfigureWriteService,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1`);
  const path = url.pathname;

  if (!path.startsWith("/api/")) {
    await serveAsset(path, response, session.token);
    return;
  }

  const mutating = request.method !== "GET" && request.method !== "HEAD";
  const failure = session.authorize(request, mutating);
  if (failure !== null) {
    sendJson(response, failure.status, { error: failure.reason });
    return;
  }

  try {
    await route(path, request, response, url, reads, writes, mutating);
  } catch (error) {
    sendJson(response, statusFor(error), {
      error: codeFor(error),
      message: messageFor(error),
    });
  }
}

async function route(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  reads: ConfigureReadModels,
  writes: ConfigureWriteService,
  mutating: boolean,
): Promise<void> {
  if (!mutating) {
    switch (path) {
      case "/api/status":
        return sendJson(response, 200, await reads.status());
      case "/api/agents":
        return sendJson(response, 200, { agents: await reads.agents() });
      case "/api/model-capabilities":
        return sendJson(response, 200, reads.modelCapabilities());
      case "/api/rules": {
        const selection = scopeFromQuery(url);
        return sendJson(response, 200, {
          scope: selection,
          edges: await reads.edges(selection),
          overrides: await reads.scopeOverrides(selection),
        });
      }
      case "/api/projects":
        return sendJson(response, 200, {
          projects: await reads.projectsAndTasks(),
        });
      case "/api/diagnostics":
        return sendJson(response, 200, await reads.diagnostics());
      case "/api/config-preview":
        return sendJson(response, 200, await reads.configPreview());
      default:
        return sendJson(response, 404, { error: "not_found" });
    }
  }

  const body = await readJsonBody(request);
  const expectedVersion = stringField(body, "configVersion");

  const agentMatch = /^\/api\/agents\/([a-z_]+)$/.exec(path);
  if (agentMatch !== null) {
    const agent = agentMatch[1] ?? "";
    if (request.method === "DELETE") {
      await writes.clearAgentConfig(agent, expectedVersion);
    } else if (request.method === "PUT") {
      await writes.setAgentConfig(
        agent,
        {
          provider: stringField(body, "provider"),
          surface: stringField(body, "surface"),
          model: stringField(body, "model"),
          ...(Object.hasOwn(body, "settings")
            ? { settings: objectField(body, "settings") }
            : {}),
        },
        expectedVersion,
      );
    } else {
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    return sendJson(response, 200, {
      ok: true,
      configVersion: await reads.configVersion(),
    });
  }

  if (path === "/api/rules" && request.method === "PUT") {
    const selection = scopeFromBody(body);
    await writes.setRule(
      {
        ...selection,
        caller: stringField(body, "caller"),
        target: stringField(body, "target"),
        decision: stringField(body, "decision") as never,
      },
      expectedVersion,
    );
    return sendJson(response, 200, {
      ok: true,
      configVersion: await reads.configVersion(),
    });
  }

  return sendJson(response, 404, { error: "not_found" });
}

/** Serves the built UI. Paths are resolved by the asset module, never joined raw. */
async function serveAsset(
  path: string,
  response: ServerResponse,
  token: string,
): Promise<void> {
  const asset = await readConfigureAsset(path, token);
  if (asset === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": asset.contentType,
    // The UI is generated per launch and must never be cached across runs.
    "cache-control": "no-store",
    // Nothing here should ever be framed or sniffed.
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(asset.body);
}

function scopeFromQuery(url: URL): RuleScopeSelection {
  const scope = (url.searchParams.get("scope") ?? "global") as RuleScope;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const taskId = url.searchParams.get("taskId") ?? undefined;
  return {
    scope,
    ...(projectId === undefined ? {} : { projectId: projectId as ProjectId }),
    ...(taskId === undefined ? {} : { taskId: taskId as TaskId }),
  };
}

function scopeFromBody(body: Record<string, unknown>): RuleScopeSelection {
  const scope = (typeof body.scope === "string" ? body.scope : "global") as RuleScope;
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
  return {
    scope,
    ...(projectId === undefined ? {} : { projectId: projectId as ProjectId }),
    ...(taskId === undefined ? {} : { taskId: taskId as TaskId }),
  };
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new ConfigureRequestError("request_body_too_large", 413);
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigureRequestError("request_body_must_be_an_object", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ConfigureRequestError) {
      throw error;
    }
    throw new ConfigureRequestError("request_body_is_not_valid_json", 400);
  }
}

export class ConfigureRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ConfigureRequestError";
  }
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new ConfigureRequestError(`missing_${field}`, 400);
  }
  return value;
}

function objectField(
  body: Record<string, unknown>,
  field: string,
): Readonly<Record<string, unknown>> {
  const value = body[field];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigureRequestError(`invalid_${field}`, 400);
  }
  return value as Readonly<Record<string, unknown>>;
}

function statusFor(error: unknown): number {
  if (error instanceof ConfigureRequestError) {
    return error.status;
  }
  if (error instanceof ConfigureStaleWriteError) {
    return 409;
  }
  if (error instanceof SynaphexError) {
    return 400;
  }
  return 500;
}

function codeFor(error: unknown): string {
  if (error instanceof ConfigureRequestError) {
    return error.code;
  }
  if (error instanceof ConfigureStaleWriteError) {
    return error.code;
  }
  if (error instanceof SynaphexError) {
    return error.code;
  }
  return "internal_error";
}

/**
 * Messages are domain messages or fixed strings.
 *
 * An unexpected error is never echoed: its text could carry local paths or
 * provider detail the configure surface has no business exposing.
 */
function messageFor(error: unknown): string {
  if (
    error instanceof ConfigureStaleWriteError ||
    error instanceof SynaphexError
  ) {
    return error.message;
  }
  if (error instanceof ConfigureRequestError) {
    return error.code.replaceAll("_", " ");
  }
  return "The configure server could not complete that request.";
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export { SESSION_TOKEN_HEADER };
