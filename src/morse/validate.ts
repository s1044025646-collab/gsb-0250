import { MAX_DURATION, MAX_SEGMENT_COUNT, MAX_TOLERANCE } from "./table.js";
import type { Segment } from "./types.js";
import { fail } from "../errors.js";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateUnit(unit: unknown): number {
  if (!isFiniteNumber(unit)) {
    fail("INVALID_UNIT", "单位时长必须是有限数字", { received: String(unit) });
  }
  if (unit <= 0) {
    fail("INVALID_UNIT", "单位时长必须为正数", { received: unit });
  }
  if (unit > MAX_DURATION) {
    fail("INVALID_UNIT", `单位时长不能超过 ${MAX_DURATION}`, { received: unit });
  }
  return unit;
}

export function validateTolerance(tolerance: unknown): number {
  const value = tolerance === undefined ? MAX_TOLERANCE : tolerance;
  if (!isFiniteNumber(value)) {
    fail("INVALID_TOLERANCE", "相对误差必须是有限数字", { received: String(value) });
  }
  if (value < 0 || value > MAX_TOLERANCE) {
    fail(
      "INVALID_TOLERANCE",
      `相对误差必须位于 0 与 ${MAX_TOLERANCE}(20%) 之间`,
      { received: value },
    );
  }
  return value;
}

export function validateSegments(input: unknown): Segment[] {
  if (!Array.isArray(input)) {
    fail("INVALID_SEGMENTS", "段列表必须是数组");
  }
  if (input.length === 0) {
    fail("INVALID_SEGMENTS", "段列表不能为空");
  }
  if (input.length > MAX_SEGMENT_COUNT) {
    fail(
      "SEQUENCE_TOO_LARGE",
      `序列段数不能超过 ${MAX_SEGMENT_COUNT}`,
      { received: input.length },
    );
  }

  const segments: Segment[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown>;
    if (raw === null || typeof raw !== "object") {
      fail("INVALID_SEGMENTS", `第 ${i} 段不是对象`, { segmentIndex: i });
    }
    const state = raw.state;
    if (state !== "on" && state !== "off") {
      fail("INVALID_SEGMENT_STATE", `第 ${i} 段状态必须为 "on" 或 "off"`, {
        segmentIndex: i,
        received: String(state),
      });
    }
    const duration = raw.duration;
    if (!isFiniteNumber(duration)) {
      fail("INVALID_DURATION", `第 ${i} 段时长必须是有限数字`, {
        segmentIndex: i,
        received: String(duration),
      });
    }
    if (duration <= 0) {
      fail("INVALID_DURATION", `第 ${i} 段时长必须为正数（零、负数不允许）`, {
        segmentIndex: i,
        received: duration,
      });
    }
    if (duration > MAX_DURATION) {
      fail("DURATION_OUT_OF_RANGE", `第 ${i} 段时长超过上限 ${MAX_DURATION}`, {
        segmentIndex: i,
        received: duration,
      });
    }
    segments.push({ state, duration });
  }

  const total = segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (!Number.isFinite(total)) {
    fail("DURATION_OUT_OF_RANGE", "全部段时长之和超出可表示范围");
  }
  return segments;
}
