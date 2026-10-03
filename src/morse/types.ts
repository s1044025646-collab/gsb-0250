export type SegmentState = "on" | "off";

export interface Segment {
  state: SegmentState;
  duration: number;
}

export interface NormalizedSegment extends Segment {
  sourceIndex: number[];
  start: number;
  end: number;
}

export interface DecodedChar {
  char: string | null;
  code: string;
  segmentIndex: number[];
  sourceIndex: number[];
  start: number;
  end: number;
  gapBefore: 1 | 3 | 7 | null;
  gapBeforeSourceIndex?: number[];
  gapBeforeInterval?: [number, number];
}

export interface EncodeResult {
  segments: Segment[];
  text: string;
  unit: number;
}

export interface DecodeResult {
  status: "ok" | "failed";
  text: string | null;
  normalizedSegments: NormalizedSegment[];
  charCodes: string[];
  chars: DecodedChar[];
  leadingSilence: { duration: number; sourceIndex: number[]; interval: [number, number] } | null;
  trailingSilence: { duration: number; sourceIndex: number[]; interval: [number, number] } | null;
  unit: number;
  tolerance: number;
  allSilence: boolean;
  issues: import("../errors.js").Issue[];
}

export interface DecodeParams {
  unit: number;
  tolerance?: number;
}
