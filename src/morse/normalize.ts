import type { NormalizedSegment, Segment } from "./types.js";

export interface NormalizeResult {
  normalized: NormalizedSegment[];
  leadingSilence: NormalizedSegment | null;
  trailingSilence: NormalizedSegment | null;
  allSilence: boolean;
}

export function mergeAdjacent(segments: Segment[]): NormalizedSegment[] {
  const merged: NormalizedSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const last = merged[merged.length - 1];
    if (last !== undefined && last.state === segment.state) {
      last.duration += segment.duration;
      last.sourceIndex.push(i);
      last.end = cursor + segment.duration;
    } else {
      merged.push({
        state: segment.state,
        duration: segment.duration,
        sourceIndex: [i],
        start: cursor,
        end: cursor + segment.duration,
      });
    }
    cursor += segment.duration;
  }
  return merged;
}

export function normalize(segments: Segment[]): NormalizeResult {
  const merged = mergeAdjacent(segments);

  let body = merged;
  let leadingSilence: NormalizedSegment | null = null;
  let trailingSilence: NormalizedSegment | null = null;

  if (body[0]?.state === "off") {
    leadingSilence = body[0];
    body = body.slice(1);
  }
  if (body.length > 0 && body[body.length - 1]!.state === "off") {
    trailingSilence = body[body.length - 1]!;
    body = body.slice(0, -1);
  }

  const allSilence = body.length === 0;
  return { normalized: body, leadingSilence, trailingSilence, allSilence };
}
