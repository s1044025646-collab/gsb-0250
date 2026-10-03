import http from "node:http";
import { handleEncode, handleDecode, examples } from "./api.ts";
import { getReport, listReports } from "./db.ts";

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10 * 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/examples") {
        return send(res, 200, examples());
      }
      if (req.method === "POST" && url.pathname === "/api/encode") {
        const r = handleEncode(await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "POST" && url.pathname === "/api/decode") {
        const r = handleDecode(await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "GET" && url.pathname === "/api/reports") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return send(res, 200, { reports: listReports(limit, offset) });
      }
      const m = url.pathname.match(/^\/api\/reports\/(\d+)$/);
      if (req.method === "GET" && m) {
        const row = getReport(Number(m[1]));
        if (!row) return send(res, 404, { error: { code: "NOT_FOUND", message: `报告 ${m[1]} 不存在` } });
        return send(res, 200, row);
      }
      const ex = url.pathname.match(/^\/api\/export\/(\d+)$/);
      if (req.method === "GET" && ex) {
        const row = getReport(Number(ex[1]));
        if (!row) return send(res, 404, { error: { code: "NOT_FOUND", message: `报告 ${ex[1]} 不存在` } });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="morse-report-${row.id}.json"`,
        });
        return res.end(JSON.stringify(row, null, 2));
      }
      send(res, 404, { error: { code: "NOT_FOUND", message: "未知路由" } });
    } catch (e) {
      send(res, 500, { error: { code: "INTERNAL", message: String((e as Error).message) } });
    }
  });
}

// 直接运行（node src/server.ts）时启动服务
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 0; // 默认 0：选择空闲端口
  const server = createServer();
  server.listen(port, () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(`摩尔斯时序服务已启动: http://localhost:${actual}`);
  });
}
