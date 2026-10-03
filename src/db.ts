import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface StoredReport {
  id: number;
  kind: "encode" | "decode";
  input_text: string | null;
  unit: number;
  tolerance: number | null;
  raw_segments: string;
  result_snapshot: string;
  status: string;
  created_at: string;
}

let dbInstance: DatabaseSync | null = null;

export function openDatabase(dbPath: string): DatabaseSync {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('encode','decode')),
      input_text TEXT,
      unit REAL NOT NULL,
      tolerance REAL,
      raw_segments TEXT NOT NULL,
      result_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  return db;
}

export function getDatabase(dbPath: string): DatabaseSync {
  if (dbInstance === null) {
    dbInstance = openDatabase(dbPath);
  }
  return dbInstance;
}

export function resetDatabaseForTest(): void {
  if (dbInstance !== null) {
    try {
      dbInstance.close();
    } catch {
      // 已关闭则忽略
    }
    dbInstance = null;
  }
}

export function saveReport(row: {
  kind: "encode" | "decode";
  inputText: string | null;
  unit: number;
  tolerance: number | null;
  rawSegments: unknown;
  result: unknown;
  status: string;
}): StoredReport {
  const db = getDatabase(resolveDatabasePath());
  const statement = db.prepare(`
    INSERT INTO reports (kind, input_text, unit, tolerance, raw_segments, result_snapshot, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = statement.run(
    row.kind,
    row.inputText,
    row.unit,
    row.tolerance,
    JSON.stringify(row.rawSegments),
    JSON.stringify(row.result),
    row.status,
  );
  const id = Number(info.lastInsertRowid);
  return getReport(id)!;
}

let configuredPath = resolve("data/morse.db");

export function resolveDatabasePath(): string {
  return configuredPath;
}

export function configureDatabasePath(dbPath: string): string {
  configuredPath = resolve(dbPath);
  resetDatabaseForTest();
  return configuredPath;
}

export function getReport(id: number): StoredReport | null {
  const db = getDatabase(resolveDatabasePath());
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as
    | StoredReport
    | undefined;
  return row ?? null;
}

export interface ReportSummary {
  id: number;
  kind: string;
  input_text: string | null;
  unit: number;
  tolerance: number | null;
  status: string;
  created_at: string;
}

export function listReports(limit = 50, kind?: "encode" | "decode"): ReportSummary[] {
  const db = getDatabase(resolveDatabasePath());
  if (kind !== undefined) {
    return db
      .prepare(
        "SELECT id, kind, input_text, unit, tolerance, status, created_at FROM reports WHERE kind = ? ORDER BY id DESC LIMIT ?",
      )
      .all(kind, limit) as unknown as ReportSummary[];
  }
  return db
    .prepare(
      "SELECT id, kind, input_text, unit, tolerance, status, created_at FROM reports ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as unknown as ReportSummary[];
}

export function reportHydrated(row: StoredReport): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    inputText: row.input_text,
    unit: row.unit,
    tolerance: row.tolerance,
    rawSegments: JSON.parse(row.raw_segments),
    result: JSON.parse(row.result_snapshot),
    status: row.status,
    createdAt: row.created_at,
  };
}
