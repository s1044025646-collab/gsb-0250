import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "morse.db");

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,               -- 'encode' | 'decode'
    params_json TEXT NOT NULL,        -- 编解码参数（unitMs、tolerance）
    input_json TEXT NOT NULL,         -- 原始输入（文本或原始段）
    result_json TEXT NOT NULL,        -- 结果快照
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

export interface ReportRow {
  id: number;
  kind: string;
  params: unknown;
  input: unknown;
  result: unknown;
  createdAt: string;
}

export function saveReport(kind: "encode" | "decode", params: unknown, input: unknown, result: unknown): number {
  const stmt = db.prepare(
    "INSERT INTO reports (kind, params_json, input_json, result_json) VALUES (?, ?, ?, ?)"
  );
  const info = stmt.run(kind, JSON.stringify(params), JSON.stringify(input), JSON.stringify(result));
  return Number(info.lastInsertRowid);
}

function toRow(r: Record<string, unknown>): ReportRow {
  return {
    id: r.id as number,
    kind: r.kind as string,
    params: JSON.parse(r.params_json as string),
    input: JSON.parse(r.input_json as string),
    result: JSON.parse(r.result_json as string),
    createdAt: r.created_at as string,
  };
}

export function getReport(id: number): ReportRow | null {
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  return row ? toRow(row as Record<string, unknown>) : null;
}

export function listReports(limit = 50, offset = 0): ReportRow[] {
  const rows = db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset);
  return rows.map((r) => toRow(r as Record<string, unknown>));
}
