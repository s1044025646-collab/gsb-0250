#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MorseError } from "../errors.js";
import { configureDatabasePath } from "../db.js";
import {
  decodeAndStore,
  encodeAndStore,
  getReportHydrated,
  queryReports,
} from "../service.js";

interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options.set(key, next);
        i++;
      } else {
        options.set(key, "true");
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, options };
}

function readJsonInput(options: Map<string, string>): unknown {
  const file = options.get("file") ?? options.get("in");
  if (file !== undefined) {
    return JSON.parse(readFileSync(resolve(file), "utf8"));
  }
  const inline = options.get("json");
  if (inline !== undefined) {
    return JSON.parse(inline);
  }
  throw new MorseError("INVALID_SEGMENTS", "需要通过 --file 或 --json 提供 JSON 输入");
}

const HELP = `摩尔斯脉冲时序编解码 CLI

用法:
  morse encode --text "SOS" [--unit 100]
  morse decode --file segments.json [--unit 100] [--tolerance 0.2]
  morse import --file segments.json --unit 100 [--tolerance 0.2]   (decode 的别名)
  morse reports [--kind decode] [--limit 20]
  morse report --id 3
  morse export --id 3 [--out report.json]

全局参数:
  --db data/morse.db     SQLite 数据文件路径
`;

export async function runCli(argv: string[]): Promise<number> {
  const { positional, options } = parseArgs(argv);
  const command = positional[0] ?? "help";

  configureDatabasePath(options.get("db") ?? process.env.MORSE_DB_PATH ?? "data/morse.db");

  switch (command) {
    case "encode": {
      const text = options.get("text") ?? "";
      const unit = options.has("unit") ? Number(options.get("unit")) : 1;
      console.log(JSON.stringify(encodeAndStore(text, unit), null, 2));
      return 0;
    }
    case "decode":
    case "import": {
      const payload = readJsonInput(options) as Record<string, unknown>;
      const segments = Array.isArray(payload) ? payload : payload.segments;
      const unit =
        options.get("unit") !== undefined
          ? Number(options.get("unit"))
          : (payload.unit ?? 1);
      const tolerance =
        options.get("tolerance") !== undefined
          ? Number(options.get("tolerance"))
          : (payload.tolerance as number | undefined);
      console.log(JSON.stringify(decodeAndStore(segments, unit, tolerance), null, 2));
      return 0;
    }
    case "reports": {
      const kind = options.get("kind");
      const limit = options.has("limit") ? Number(options.get("limit")) : undefined;
      console.log(
        JSON.stringify(
          queryReports(
            limit,
            kind === "encode" || kind === "decode" ? kind : undefined,
          ),
          null,
          2,
        ),
      );
      return 0;
    }
    case "report": {
      const id = Number(options.get("id"));
      if (!Number.isInteger(id)) {
        throw new MorseError("INVALID_SEGMENTS", "report 需要整数 --id");
      }
      const report = getReportHydrated(id);
      if (report === null) {
        console.error(`报告 ${id} 不存在`);
        return 2;
      }
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }
    case "export": {
      const id = Number(options.get("id"));
      if (!Number.isInteger(id)) {
        throw new MorseError("INVALID_SEGMENTS", "export 需要整数 --id");
      }
      const report = getReportHydrated(id);
      if (report === null) {
        console.error(`报告 ${id} 不存在`);
        return 2;
      }
      const json = JSON.stringify(report, null, 2);
      const out = options.get("out");
      if (out !== undefined) {
        writeFileSync(resolve(out), json, "utf8");
        console.error(`已导出到 ${out}`);
      } else {
        console.log(json);
      }
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`未知命令: ${command}\n\n${HELP}`);
      return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof MorseError) {
        console.error(JSON.stringify({ code: error.code, message: error.message }, null, 2));
      } else {
        console.error(error);
      }
      process.exitCode = 1;
    });
}
