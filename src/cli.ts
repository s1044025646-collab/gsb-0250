import { readFileSync, writeFileSync } from "node:fs";
import { handleEncode, handleDecode, examples } from "./api.ts";
import { getReport, listReports } from "./db.ts";
import { createServer } from "./server.ts";

function out(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

function fail(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(1);
}

const [, , cmd, ...args] = process.argv;

function argValue(name: string): string | undefined {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : undefined;
}

function readJsonInput(): unknown {
  const file = argValue("file");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const json = argValue("json");
  if (json) return JSON.parse(json);
  fail("需要 --file=<path> 或 --json=<json>");
}

switch (cmd) {
  case "encode": {
    const text = argValue("text") ?? fail("需要 --text=<文本>");
    const unitMs = Number(argValue("unit") ?? 100);
    const r = handleEncode({ text, unitMs });
    out(r.body);
    process.exit(r.status === 200 ? 0 : 1);
    break;
  }
  case "decode": {
    const payload = readJsonInput() as Record<string, unknown>;
    const r = handleDecode({
      segments: payload.segments,
      unitMs: payload.unitMs ?? Number(argValue("unit") ?? 100),
      tolerance: payload.tolerance ?? Number(argValue("tolerance") ?? 0.1),
    });
    out(r.body);
    process.exit(r.status === 200 && (r.body as { ok: boolean }).ok ? 0 : 1);
    break;
  }
  case "reports": {
    out(listReports(Number(argValue("limit") ?? 50)));
    break;
  }
  case "report": {
    const id = Number(args[0]);
    const row = getReport(id);
    if (!row) fail(`报告 ${id} 不存在`);
    out(row);
    break;
  }
  case "export": {
    const id = Number(args[0]);
    const row = getReport(id);
    if (!row) fail(`报告 ${id} 不存在`);
    const file = argValue("out") ?? `morse-report-${id}.json`;
    writeFileSync(file, JSON.stringify(row, null, 2), "utf8");
    console.log(`已导出到 ${file}`);
    break;
  }
  case "examples": {
    out(examples());
    break;
  }
  case "serve": {
    const port = Number(argValue("port") ?? 0);
    const server = createServer();
    server.listen(port, () => {
      const addr = server.address();
      console.log(`摩尔斯时序服务已启动: http://localhost:${typeof addr === "object" && addr ? addr.port : port}`);
    });
    break;
  }
  default:
    console.log(`用法: node src/cli.ts <命令> [选项]
  encode --text="SOS" [--unit=100]            文本编码为脉冲段
  decode --file=input.json [--unit=100] [--tolerance=0.1]   解码段列表
  reports [--limit=50]                        列出历史报告
  report <id>                                 查看报告详情
  export <id> [--out=file.json]               导出报告 JSON
  examples                                    内置示例（SOS、含数字两词）
  serve [--port=0]                            启动 HTTP API（默认空闲端口）`);
    if (cmd) process.exit(1);
}
