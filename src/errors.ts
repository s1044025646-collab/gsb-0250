export type ErrorCode =
  | "EMPTY_TEXT"
  | "INVALID_CHARACTER"
  | "INVALID_SEGMENTS"
  | "INVALID_SEGMENT_STATE"
  | "INVALID_DURATION"
  | "DURATION_OUT_OF_RANGE"
  | "SEQUENCE_TOO_LARGE"
  | "INVALID_UNIT"
  | "INVALID_TOLERANCE"
  | "UNKNOWN_DURATION"
  | "UNKNOWN_CODE";

export interface Issue {
  code: ErrorCode;
  message: string;
  segmentIndex?: number[];
  sourceIndex?: number[];
  interval?: [number, number];
  context?: Record<string, unknown>;
}

export class MorseError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MorseError";
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new MorseError(code, message, details);
}
