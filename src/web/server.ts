import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentRegistry } from "../agents/registry";
import { loadConfig } from "../config/load-config";
import { AppConfig } from "../config/schema";
import { Orchestrator } from "../core/orchestrator";
import { PromptBuilder } from "../core/prompt-builder";
import { Router } from "../core/router";
import { AGENT_NAMES, AgentName, TASK_TYPES, Task } from "../core/task";
import { ProcessRunner } from "../process/process-runner";
import { Logger } from "../utils/logger";
import { previewWorkflowGraph } from "./workflow";

interface WebContext {
  cwd: string;
  config: AppConfig;
  registry: AgentRegistry;
  orchestrator: Orchestrator;
}

interface ServerOptions {
  host: string;
  port: number;
  cwd: string;
  configPath?: string;
}

function parseArgs(argv: string[]): ServerOptions {
  const options: ServerOptions = {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4317),
    cwd: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
    } else if (arg === "--port") {
      options.port = Number(argv[index + 1] ?? options.port);
      index += 1;
    } else if (arg === "--cwd") {
      options.cwd = path.resolve(argv[index + 1] ?? options.cwd);
      index += 1;
    } else if (arg === "--config") {
      options.configPath = argv[index + 1];
      index += 1;
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer.");
  }

  return options;
}

function createWebContext(options: ServerOptions): WebContext {
  const { config } = loadConfig(options.configPath, options.cwd);
  const logger = new Logger({
    level: config.logging.level,
    consoleEnabled: true
  });
  const registry = new AgentRegistry(config, {
    processRunner: new ProcessRunner(),
    logger
  });
  const orchestrator = new Orchestrator(
    config,
    registry,
    new Router(config),
    new PromptBuilder(),
    logger
  );

  return {
    cwd: options.cwd,
    config,
    registry,
    orchestrator
  };
}

function sendJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendText(response: http.ServerResponse, statusCode: number, value: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(value);
}

function parseAgentName(value: string | null): AgentName | undefined {
  return value && (AGENT_NAMES as readonly string[]).includes(value)
    ? (value as AgentName)
    : undefined;
}

function getStaticRoot(): string {
  const distStatic = path.resolve(__dirname, "static");
  if (fs.existsSync(distStatic)) {
    return distStatic;
  }
  return path.resolve(process.cwd(), "src", "web", "static");
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function serveStatic(requestPath: string, response: http.ServerResponse): void {
  const staticRoot = getStaticRoot();
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.resolve(staticRoot, `.${decodeURIComponent(safePath)}`);

  if (!resolvedPath.startsWith(staticRoot)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    sendText(response, 404, "Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(resolvedPath),
    "cache-control": "no-store"
  });
  fs.createReadStream(resolvedPath).pipe(response);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function asTaskPayload(value: unknown, cwd: string): Task {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = typeof payload.type === "string" && (TASK_TYPES as readonly string[]).includes(payload.type)
    ? payload.type as Task["type"]
    : "summarize";
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const preferredAgent = typeof payload.preferredAgent === "string" && ((AGENT_NAMES as readonly string[]).includes(payload.preferredAgent) || payload.preferredAgent === "auto")
    ? payload.preferredAgent as Task["preferredAgent"]
    : "auto";
  const fallbackAgents = Array.isArray(payload.fallbackAgents)
    ? payload.fallbackAgents.filter((agent): agent is AgentName => typeof agent === "string" && (AGENT_NAMES as readonly string[]).includes(agent))
    : [];

  return {
    id: typeof payload.id === "string" && payload.id ? payload.id : `web-${Date.now()}`,
    type,
    title: typeof payload.title === "string" ? payload.title : undefined,
    prompt,
    cwd: path.resolve(cwd, typeof payload.cwd === "string" && payload.cwd ? payload.cwd : "."),
    preferredAgent,
    fallbackAgents,
    timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
    metadata: {
      source: "web"
    }
  };
}

async function handleApi(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  context: WebContext
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      cwd: context.cwd,
      agents: AGENT_NAMES,
      taskTypes: TASK_TYPES
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/agents") {
    sendJson(response, 200, context.registry.list());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/routes") {
    sendJson(response, 200, context.config.routing.routes);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/detect") {
    const agentName = parseAgentName(url.searchParams.get("agent"));
    if (url.searchParams.get("agent") && !agentName) {
      sendJson(response, 400, { error: "Unsupported agent." });
      return;
    }
    sendJson(response, 200, await context.registry.detect(agentName ? [agentName] : undefined));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/workflows/preview") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewWorkflowGraph(body, context.cwd));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    const body = await readJsonBody(request);
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const task = asTaskPayload(payload.task ?? payload, context.cwd);
    const dryRun = payload.dryRun !== false;
    sendJson(response, 200, await context.orchestrator.run(task, { dryRun }));
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

export function createServer(options: ServerOptions): http.Server {
  const context = createWebContext(options);

  return http.createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (url.pathname.startsWith("/api/")) {
          await handleApi(request, response, url, context);
          return;
        }
        serveStatic(url.pathname, response);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })();
  });
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const server = createServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`SnowAgent web UI listening at http://${options.host}:${options.port}`);
  });
}
