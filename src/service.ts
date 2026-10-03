import { decode } from "./morse/decode.js";
import { encode } from "./morse/encode.js";
import type { Segment } from "./morse/types.js";
import {
  getReport,
  listReports,
  reportHydrated,
  saveReport,
  type StoredReport,
} from "./db.js";

export function encodeAndStore(text: unknown, unit: unknown) {
  const result = encode(text, unit);
  const stored = saveReport({
    kind: "encode",
    inputText: result.text,
    unit: result.unit,
    tolerance: null,
    rawSegments: result.segments,
    result,
    status: "ok",
  });
  return { id: stored.id, ...result };
}

export function decodeAndStore(segments: unknown, unit: unknown, tolerance?: unknown) {
  const result = decode(segments, {
    unit: unit as number,
    tolerance: tolerance as number | undefined,
  });
  const stored = saveReport({
    kind: "decode",
    inputText: result.text,
    unit: result.unit,
    tolerance: result.tolerance,
    rawSegments: segments,
    result,
    status: result.status,
  });
  return { id: stored.id, ...result };
}

export function getReportHydrated(id: number) {
  const row: StoredReport | null = getReport(id);
  return row === null ? null : reportHydrated(row);
}

export function queryReports(limit?: number, kind?: "encode" | "decode") {
  return listReports(limit, kind);
}

export function exportReportJson(id: number): string | null {
  const hydrated = getReportHydrated(id);
  return hydrated === null ? null : JSON.stringify(hydrated, null, 2);
}

export type { Segment };
