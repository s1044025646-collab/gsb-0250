/** 摩尔斯电码表：A-Z、0-9，完整保存在项目内。 */
export const MORSE_TABLE: Readonly<Record<string, string>> = Object.freeze({
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
});

export const PATTERN_TO_CHAR: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(MORSE_TABLE).map(([c, p]) => [p, c]))
);

export type SegmentState = "on" | "off";

export interface Segment {
  state: SegmentState;
  duration: number;
}

export interface NormalizedSegment extends Segment {
  /** 标准单位数（1、3 或 7） */
  units: number;
  /** 来源原始段下标（合并时覆盖多个） */
  sourceIndices: number[];
  /** 相对偏差 */
  deviation: number;
}

export interface CharTrace {
  char: string;
  pattern: string;
  /** 覆盖的原始段下标（含） */
  segmentStart: number;
  segmentEnd: number;
  /** 时间区间（毫秒，基于原始时长累计） */
  timeStartMs: number;
  timeEndMs: number;
}

export interface DecodeError {
  code: string;
  message: string;
  /** 出错的原始段下标（如适用） */
  segmentIndex?: number;
  /** 出错的点划组合（如适用） */
  pattern?: string;
  expected?: number[];
  actual?: number;
}

export interface DecodeReport {
  ok: boolean;
  text: string;
  dotDash: string;
  normalized: NormalizedSegment[];
  chars: CharTrace[];
  /** 被剥离的首部静默段（原始下标） */
  leadingSilence: number[];
  /** 被剥离的尾部静默段（原始下标） */
  trailingSilence: number[];
  errors: DecodeError[];
  params: { unitMs: number; tolerance: number };
}

export const MAX_SEGMENTS = 100000;
export const MAX_TOLERANCE = 0.2;
const EPS = 1e-9;

export class MorseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MorseError";
    this.code = code;
  }
}

/** 校验单位时长与容差。 */
export function validateParams(unitMs: unknown, tolerance: unknown): { unitMs: number; tolerance: number } {
  if (typeof unitMs !== "number" || !Number.isFinite(unitMs) || unitMs <= 0) {
    throw new MorseError("INVALID_UNIT", "unitMs 必须是正的有限数");
  }
  if (unitMs > 1e9) {
    throw new MorseError("INVALID_UNIT", "unitMs 过大");
  }
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > MAX_TOLERANCE) {
    throw new MorseError("INVALID_TOLERANCE", `tolerance 必须在 [0, ${MAX_TOLERANCE}] 范围内（不超过 20%）`);
  }
  return { unitMs, tolerance };
}

/** 校验原始段列表。 */
export function validateSegments(input: unknown): Segment[] {
  if (!Array.isArray(input)) {
    throw new MorseError("INVALID_SEGMENTS", "segments 必须是数组");
  }
  if (input.length === 0) {
    throw new MorseError("INVALID_SEGMENTS", "segments 不能为空");
  }
  if (input.length > MAX_SEGMENTS) {
    throw new MorseError("SEQUENCE_TOO_LONG", `段数量超过上限 ${MAX_SEGMENTS}`);
  }
  return input.map((raw, i) => {
    const s = raw as Partial<Segment>;
    if (s && (s.state === "on" || s.state === "off") &&
        typeof s.duration === "number" && Number.isFinite(s.duration) && s.duration > 0) {
      if (s.duration > 1e12) {
        throw new MorseError("INVALID_SEGMENT", `段 ${i} 时长过大`);
      }
      return { state: s.state, duration: s.duration };
    }
    throw new MorseError("INVALID_SEGMENT", `段 ${i} 非法：state 须为 "on"/"off"，duration 须为正的有限数`);
  });
}

/** 文本编码为脉冲段列表。连续空格按公开规则折叠为单个词间隔，首尾空格忽略。 */
export function encodeText(text: unknown, unitMs: unknown): { text: string; segments: Segment[]; dotDash: string } {
  if (typeof text !== "string") {
    throw new MorseError("INVALID_TEXT", "text 必须是字符串");
  }
  const { unitMs: unit } = validateParams(unitMs, 0);
  const upper = text.toUpperCase();
  for (const ch of upper) {
    if (ch !== " " && !(ch in MORSE_TABLE)) {
      throw new MorseError("INVALID_CHARACTER", `不支持的字符: ${JSON.stringify(ch)}（仅支持 A-Z、0-9 与空格）`);
    }
  }
  // 折叠连续空格并去除首尾空格，避免产生空的前后单词
  const normalized = upper.replace(/ +/g, " ").trim();
  if (normalized.length === 0) {
    throw new MorseError("EMPTY_TEXT", "文本为空或仅包含空格");
  }
  const segments: Segment[] = [];
  const dotDashParts: string[] = [];
  const words = normalized.split(" ");
  words.forEach((word, wi) => {
    if (wi > 0) segments.push({ state: "off", duration: 7 * unit });
    [...word].forEach((ch, ci) => {
      if (ci > 0) segments.push({ state: "off", duration: 3 * unit });
      const pattern = MORSE_TABLE[ch];
      dotDashParts.push(pattern);
      [...pattern].forEach((sym, si) => {
        if (si > 0) segments.push({ state: "off", duration: 1 * unit });
        segments.push({ state: "on", duration: (sym === "." ? 1 : 3) * unit });
      });
    });
  });
  return { text: normalized, segments, dotDash: dotDashParts.join(" ") };
}

interface MergedSegment {
  state: SegmentState;
  duration: number;
  sourceIndices: number[];
  startMs: number;
  endMs: number;
}

/** 合并相邻同状态段并记录来源下标与时间区间。 */
function mergeSegments(segments: Segment[]): MergedSegment[] {
  const merged: MergedSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = merged[merged.length - 1];
    if (last && last.state === seg.state) {
      last.duration += seg.duration;
      last.sourceIndices.push(i);
      last.endMs = cursor + seg.duration;
    } else {
      merged.push({ state: seg.state, duration: seg.duration, sourceIndices: [i], startMs: cursor, endMs: cursor + seg.duration });
    }
    cursor += seg.duration;
  }
  return merged;
}

/** 将时长匹配到最近的标准单位数；超出容差返回 null。 */
function matchUnits(duration: number, unit: number, tolerance: number, allowed: number[]): { units: number; deviation: number } | null {
  let best: { units: number; deviation: number } | null = null;
  for (const k of allowed) {
    const expected = k * unit;
    const deviation = Math.abs(duration - expected) / expected;
    if (!best || deviation < best.deviation - EPS) best = { units: k, deviation };
  }
  if (best && best.deviation <= tolerance + EPS) return best;
  return null;
}

/** 解码段列表，产出完整诊断报告。任何段超容差或未知点划组合都会导致整体失败。 */
export function decodeSegments(rawSegments: unknown, unitMs: unknown, tolerance: unknown): DecodeReport {
  const params = validateParams(unitMs, tolerance);
  const segments = validateSegments(rawSegments);
  const merged = mergeSegments(segments);

  const errors: DecodeError[] = [];
  const normalized: NormalizedSegment[] = [];

  // 剥离首尾静默（仅记录，不产生空单词）
  let start = 0;
  let end = merged.length;
  const leadingSilence: number[] = [];
  const trailingSilence: number[] = [];
  while (start < end && merged[start].state === "off") { leadingSilence.push(...merged[start].sourceIndices); start++; }
  while (end > start && merged[end - 1].state === "off") { trailingSilence.push(...merged[end - 1].sourceIndices); end--; }

  const body = merged.slice(start, end);
  const chars: CharTrace[] = [];
  const dotDashParts: string[] = [];

  if (body.length === 0) {
    // 全静默：合法输入，语义为空文本
    return { ok: true, text: "", dotDash: "", normalized, chars, leadingSilence, trailingSilence, errors, params };
  }

  // 逐段匹配标准时长
  let failed = false;
  const classified: { units: number; deviation: number }[] = [];
  for (let i = 0; i < body.length; i++) {
    const seg = body[i];
    const allowed = seg.state === "on" ? [1, 3] : [1, 3, 7];
    const match = matchUnits(seg.duration, params.unitMs, params.tolerance, allowed);
    if (!match) {
      failed = true;
      errors.push({
        code: "DURATION_OUT_OF_TOLERANCE",
        message: `段 ${seg.sourceIndices[0]}（${seg.state}，${seg.duration}ms）超出容差，无法匹配标准时长`,
        segmentIndex: seg.sourceIndices[0],
        expected: allowed.map((k) => k * params.unitMs),
        actual: seg.duration,
      });
      classified.push({ units: 0, deviation: NaN });
    } else {
      classified.push(match);
    }
    normalized.push({
      state: seg.state,
      duration: seg.duration,
      units: match ? match.units : 0,
      sourceIndices: seg.sourceIndices,
      deviation: match ? match.deviation : NaN,
    });
  }

  // 若时长全部合法，组装字符
  if (!failed) {
    let pattern = "";
    let patStart = 0;
    const flushChar = (segIdxExclusive: number) => {
      if (pattern.length === 0) return;
      const ch = PATTERN_TO_CHAR[pattern];
      const firstSeg = body[patStart];
      const lastSeg = body[segIdxExclusive - 1];
      if (ch === undefined) {
        failed = true;
        errors.push({
          code: "UNKNOWN_PATTERN",
          message: `未知点划组合 "${pattern}"（原始段 ${firstSeg.sourceIndices[0]} 起）`,
          segmentIndex: firstSeg.sourceIndices[0],
          pattern,
        });
      } else {
        chars.push({
          char: ch,
          pattern,
          segmentStart: firstSeg.sourceIndices[0],
          segmentEnd: lastSeg.sourceIndices[lastSeg.sourceIndices.length - 1],
          timeStartMs: firstSeg.startMs,
          timeEndMs: lastSeg.endMs,
        });
      }
      dotDashParts.push(pattern);
      pattern = "";
    };
    for (let i = 0; i < body.length; i++) {
      const seg = body[i];
      const units = classified[i].units;
      if (seg.state === "on") {
        if (pattern.length === 0) patStart = i;
        pattern += units === 1 ? "." : "-";
      } else if (units === 1) {
        // 字符内符号间隔，继续累积
      } else {
        flushChar(i);
        if (units === 7) dotDashParts.push("/");
      }
    }
    flushChar(body.length);
  }

  const text = failed ? "" : chars.map((c) => c.char).join("");
  // 词间隔恢复为空格
  let finalText = "";
  if (!failed) {
    let charIdx = 0;
    for (const part of dotDashParts) {
      if (part === "/") finalText += " ";
      else finalText += chars[charIdx++].char;
    }
  }

  return {
    ok: !failed,
    text: finalText,
    dotDash: dotDashParts.join(" "),
    normalized,
    chars: failed ? [] : chars,
    leadingSilence,
    trailingSilence,
    errors,
    params,
  };
}
