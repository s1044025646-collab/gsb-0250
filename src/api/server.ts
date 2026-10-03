import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { MorseError } from "../errors.js";
import {
  decodeAndStore,
  encodeAndStore,
  getReportHydrated,
  queryReports,
} from "../service.js";
import { configureDatabasePath } from "../db.js";

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MorseError("INVALID_SEGMENTS", "请求体不是合法 JSON");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

export function createApp(): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = `${request.method} ${url.pathname}`;

    try {
      if (route === "GET /health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (route === "POST /api/encode") {
        const body = (await readJson(request)) as Record<string, unknown>;
        const result = encodeAndStore(body.text, body.unit ?? 1);
        sendJson(response, 200, result);
        return;
      }

      if (route === "POST /api/decode") {
        const body = (await readJson(request)) as Record<string, unknown>;
        const result = decodeAndStore(body.segments, body.unit ?? 1, body.tolerance);
        sendJson(response, 200, result);
        return;
      }

      if (route === "GET /api/reports") {
        const kind = url.searchParams.get("kind");
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam === null ? undefined : Number(limitParam);
        const reports = queryReports(
          Number.isFinite(limit) ? limit : undefined,
          kind === "encode" || kind === "decode" ? kind : undefined,
        );
        sendJson(response, 200, { reports });
        return;
      }

      const reportMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
      if (request.method === "GET" && reportMatch !== null) {
        const id = Number(reportMatch[1]);
        const report = getReportHydrated(id);
        if (report === null) {
          sendJson(response, 404, { code: "NOT_FOUND", message: `报告 ${id} 不存在` });
          return;
        }
        sendJson(response, 200, report);
        return;
      }

      const exportMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/export$/);
      if (request.method === "GET" && exportMatch !== null) {
        const id = Number(exportMatch[1]);
        const report = getReportHydrated(id);
        if (report === null) {
          sendJson(response, 404, { code: "NOT_FOUND", message: `报告 ${id} 不存在` });
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-${id}.json"`,
        });
        response.end(JSON.stringify(report, null, 2));
        return;
      }

      sendJson(response, 404, { code: "NOT_FOUND", message: "未知路由" });
    } catch (error) {
      if (error instanceof MorseError) {
        sendJson(response, 400, {
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return;
      }
      sendJson(response, 500, {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "未知内部错误",
      });
    }
  });
}

export function chooseIdlePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("无法获取空闲端口"));
        return;
      }
      const port = address.port;
      probe.close(() => resolvePort(port));
    });
    probe.on("error", reject);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const portArgIndex = args.indexOf("--port");
  const requestedPort =
    portArgIndex !== -1 && args[portArgIndex + 1] !== undefined
      ? Number(args[portArgIndex + 1])
      : process.env.PORT !== undefined
        ? Number(process.env.PORT)
        : null;

  const dbPath = process.env.MORSE_DB_PATH ?? "data/morse.db";
  configureDatabasePath(dbPath);

  const port =
    requestedPort !== null && Number.isInteger(requestedPort) && requestedPort > 0
      ? requestedPort
      : await chooseIdlePort();

  const server = createApp();
  server.listen(port, "127.0.0.1", () => {
    console.log(`摩尔斯时序服务已启动: http://127.0.0.1:${port}`);
    console.log(`数据目录: ${dbPath}`);
    console.log("接口: POST /api/encode, POST /api/decode, GET /api/reports/:id");
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
