import type { Issue } from "../errors.js";
import { CODE_TO_CHAR, UNIT } from "./table.js";
import { normalize } from "./normalize.js";
import type {
  DecodeParams,
  DecodeResult,
  DecodedChar,
  NormalizedSegment,
  Segment,
} from "./types.js";
import { validateSegments, validateTolerance, validateUnit } from "./validate.js";

type Units = 1 | 3 | 7;

const ON_TARGETS: Units[] = [UNIT.DOT, UNIT.DASH];
const GAP_TARGETS: Units[] = [UNIT.INTRA_CHAR_GAP, UNIT.INTER_CHAR_GAP, UNIT.WORD_GAP];

function matchUnits(duration: number, unit: number, tolerance: number, targets: Units[]): Units | null {
  let best: Units | null = null;
  let bestError = Infinity;
  for (const target of targets) {
    const expected = target * unit;
    const relativeError = Math.abs(duration - expected) / expected;
    if (relativeError <= tolerance + Number.EPSILON && relativeError < bestError) {
      best = target;
      bestError = relativeError;
    }
  }
  return best;
}

export function decode(input: unknown, params: DecodeParams): DecodeResult {
  const rawSegments: Segment[] = validateSegments(input);
  const unit = validateUnit(params.unit);
  const tolerance = validateTolerance(params.tolerance);

  const { normalized, leadingSilence, trailingSilence, allSilence } = normalize(rawSegments);
  const issues: Issue[] = [];

  const silenceInfo = (segment: NormalizedSegment | null) =>
    segment === null
      ? null
      : {
          duration: segment.duration,
          sourceIndex: segment.sourceIndex,
          interval: [segment.start, segment.end] as [number, number],
        };

  if (allSilence) {
    return {
      status: "ok",
      text: "",
      normalizedSegments: normalized,
      charCodes: [],
      chars: [],
      leadingSilence: silenceInfo(leadingSilence),
      trailingSilence: silenceInfo(trailingSilence),
      unit,
      tolerance,
      allSilence: true,
      issues: [],
    };
  }

  const chars: DecodedChar[] = [];
  const charCodes: string[] = [];
  let currentSymbols = "";
  let currentSegmentIndex: number[] = [];
  let currentSourceIndex: number[] = [];
  let pendingGap: { units: Units | null; segment: NormalizedSegment } | null = null;

  const pushChar = () => {
    const firstSegment = normalized[currentSegmentIndex[0]!]!;
    const lastSegment = normalized[currentSegmentIndex[currentSegmentIndex.length - 1]!]!;
    const decoded = CODE_TO_CHAR.get(currentSymbols);

    if (decoded === undefined) {
      issues.push({
        code: "UNKNOWN_CODE",
        message: `点划组合 "${currentSymbols}" 不是合法的摩尔斯字符`,
        segmentIndex: [...currentSegmentIndex],
        sourceIndex: [...currentSourceIndex],
        interval: [firstSegment.start, lastSegment.end],
        context: { code: currentSymbols },
      });
    }

    if (pendingGap !== null && pendingGap.units === null) {
      issues.push({
        code: "UNKNOWN_DURATION",
        message: `暗段时长 ${pendingGap.segment.duration} 超出容差，无法判定为 3/7 单位字符或单词间隔`,
        segmentIndex: [normalized.indexOf(pendingGap.segment)],
        sourceIndex: [...pendingGap.segment.sourceIndex],
        interval: [pendingGap.segment.start, pendingGap.segment.end],
        context: { duration: pendingGap.segment.duration, unit, tolerance },
      });
    }

    const gapUnits = pendingGap?.units ?? null;
    chars.push({
      char: decoded ?? null,
      code: currentSymbols,
      segmentIndex: [...currentSegmentIndex],
      sourceIndex: [...currentSourceIndex],
      start: firstSegment.start,
      end: lastSegment.end,
      gapBefore: gapUnits === UNIT.INTER_CHAR_GAP ? 3 : gapUnits === UNIT.WORD_GAP ? 7 : null,
      gapBeforeSourceIndex:
        pendingGap === null ? undefined : [...pendingGap.segment.sourceIndex],
      gapBeforeInterval:
        pendingGap === null
          ? undefined
          : [pendingGap.segment.start, pendingGap.segment.end],
    });
    charCodes.push(currentSymbols);
    pendingGap = null;
  };

  for (let i = 0; i < normalized.length; i++) {
    const segment = normalized[i]!;

    if (segment.state === "on") {
      const units = matchUnits(segment.duration, unit, tolerance, ON_TARGETS);
      if (units === null) {
        issues.push({
          code: "UNKNOWN_DURATION",
          message: `亮段时长 ${segment.duration} 超出容差，无法判定为点(1单位)或划(3单位)`,
          segmentIndex: [i],
          sourceIndex: [...segment.sourceIndex],
          interval: [segment.start, segment.end],
          context: { duration: segment.duration, unit, tolerance },
        });
        currentSymbols += "?";
      } else {
        currentSymbols += units === UNIT.DOT ? "." : "-";
      }
      currentSegmentIndex.push(i);
      currentSourceIndex.push(...segment.sourceIndex);
    } else {
      const units = matchUnits(segment.duration, unit, tolerance, GAP_TARGETS);

      if (units === UNIT.INTRA_CHAR_GAP) {
        continue;
      }

      if (currentSegmentIndex.length > 0) {
        pushChar();
      }
      pendingGap = { units, segment };
      currentSymbols = "";
      currentSegmentIndex = [];
      currentSourceIndex = [];
    }
  }

  if (currentSegmentIndex.length > 0) {
    pushChar();
  }

  const hasFailure = issues.length > 0;
  const text = hasFailure
    ? null
    : chars
        .map((char, index) => {
          const prefix = index > 0 && char.gapBefore === UNIT.WORD_GAP ? " " : "";
          return prefix + char.char;
        })
        .join("");

  return {
    status: hasFailure ? "failed" : "ok",
    text,
    normalizedSegments: normalized,
    charCodes,
    chars,
    leadingSilence: silenceInfo(leadingSilence),
    trailingSilence: silenceInfo(trailingSilence),
    unit,
    tolerance,
    allSilence: false,
    issues,
  };
}
