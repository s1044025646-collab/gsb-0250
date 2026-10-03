import { encodeText, decodeSegments, validateParams, MorseError } from "./morse.ts";
import { saveReport } from "./db.ts";

export interface ApiResult {
  status: number;
  body: unknown;
}

function errBody(e: unknown): { status: number; body: unknown } {
  if (e instanceof MorseError) {
    return { status: 400, body: { error: { code: e.code, message: e.message } } };
  }
  throw e;
}

export function handleEncode(payload: unknown): ApiResult {
  const p = payload as Record<string, unknown>;
  try {
    const result = encodeText(p?.text, p?.unitMs);
    const id = saveReport("encode", { unitMs: p?.unitMs }, { text: p?.text }, result);
    return { status: 200, body: { id, ...result } };
  } catch (e) {
    return errBody(e);
  }
}

export function handleDecode(payload: unknown): ApiResult {
  const p = payload as Record<string, unknown>;
  try {
    validateParams(p?.unitMs, p?.tolerance);
    const report = decodeSegments(p?.segments, p?.unitMs, p?.tolerance);
    const id = saveReport(
      "decode",
      { unitMs: p?.unitMs, tolerance: p?.tolerance },
      { segments: p?.segments },
      report
    );
    return { status: 200, body: { id, ...report } };
  } catch (e) {
    return errBody(e);
  }
}

/** 内置示例：SOS 与含数字的两个单词。 */
export function examples(unitMs = 100) {
  const sos = encodeText("SOS", unitMs);
  const digits = encodeText("M2 K9", unitMs);
  return { sos, digits };
}
