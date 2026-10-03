import { test } from "node:test";
import assert from "node:assert/strict";
import { decode } from "../morse/decode.js";
import { encode } from "../morse/encode.js";
import { MorseError } from "../errors.js";

function roundTrip(text: string, unit = 1, tolerance = 0.2): string {
  const encoded = encode(text, unit);
  const decoded = decode(encoded.segments, { unit, tolerance });
  assert.equal(decoded.status, "ok", JSON.stringify(decoded.issues));
  assert.equal(decoded.text, text);
  return decoded.text!;
}

test("组合文本往返: 单词、连续点划与数字", () => {
  roundTrip("SOS");
  roundTrip("AGENT 42");
  roundTrip("THE QUICK BROWN FOX");
  roundTrip("EEEE TTTT");
  roundTrip("1234567890");
  roundTrip("SOS", 0.1);
  roundTrip("SOS", 333);
});

test("文本统一大写，制表/换行/连续空格折叠为单个单词间隔", () => {
  const encoded = encode("  sos   agent\t42 \n", 1);
  assert.equal(encoded.text, "SOS AGENT 42");
  const decoded = decode(encoded.segments, { unit: 1 });
  assert.equal(decoded.text, "SOS AGENT 42");
});

test("编码输出只以亮段开始和结束，不产生空的前后单词", () => {
  const encoded = encode("  HI  ", 1);
  assert.equal(encoded.segments[0]!.state, "on");
  assert.equal(encoded.segments.at(-1)!.state, "on");
  const decoded = decode(encoded.segments, { unit: 1 });
  assert.equal(decoded.text, "HI");
});

test("字符内/字符间/词间三种暗间隔不会被混淆", () => {
  const ee = decode(encode("EE", 1).segments, { unit: 1 });
  assert.equal(ee.text, "EE");
  assert.equal(ee.chars[1]!.gapBefore, 3);

  const eE = decode(encode("E E", 1).segments, { unit: 1 });
  assert.equal(eE.text, "E E");
  assert.equal(eE.chars[1]!.gapBefore, 7);

  const i = decode(encode("I", 1).segments, { unit: 1 });
  assert.equal(i.text, "I");
  assert.equal(i.chars[0]!.gapBefore, null);
});

test("容差边界: +20% 恰好接受，超过即报 UNKNOWN_DURATION", () => {
  const segments = encode("E", 100).segments;
  segments[0]!.duration = 120;
  const atBoundary = decode(segments, { unit: 100, tolerance: 0.2 });
  assert.equal(atBoundary.status, "ok");
  assert.equal(atBoundary.text, "E");

  segments[0]!.duration = 120.01;
  const beyond = decode(segments, { unit: 100, tolerance: 0.2 });
  assert.equal(beyond.status, "failed");
  assert.equal(beyond.text, null);
  assert.equal(beyond.issues[0]!.code, "UNKNOWN_DURATION");
});

test("容差 > 20% 被拒绝", () => {
  assert.throws(
    () => decode(encode("E", 1).segments, { unit: 1, tolerance: 0.21 }),
    (error: unknown) => error instanceof MorseError && error.code === "INVALID_TOLERANCE",
  );
});

test("未知点划组合标记 UNKNOWN_CODE 且整段失败", () => {
  const decoded = decode(
    [
      { state: "on", duration: 1 },
      { state: "off", duration: 1 },
      { state: "on", duration: 1 },
      { state: "off", duration: 1 },
      { state: "on", duration: 1 },
      { state: "off", duration: 1 },
      { state: "on", duration: 1 },
      { state: "off", duration: 1 },
      { state: "on", duration: 1 },
      { state: "off", duration: 1 },
      { state: "on", duration: 1 },
    ],
    { unit: 1 },
  );
  assert.equal(decoded.status, "failed");
  assert.equal(decoded.text, null);
  assert.equal(decoded.issues[0]!.code, "UNKNOWN_CODE");
});

test("非法间隔(5 单位)定位到具体暗段与时间区间", () => {
  const segments = encode("SOS", 100).segments;
  for (const segment of segments) {
    if (segment.state === "off" && segment.duration === 300) {
      segment.duration = 500;
      break;
    }
  }
  const decoded = decode(segments, { unit: 100, tolerance: 0.2 });
  assert.equal(decoded.status, "failed");
  const issue = decoded.issues.find((item) => item.code === "UNKNOWN_DURATION");
  assert.ok(issue);
  assert.ok(issue.interval![0] < issue.interval![1]);
  assert.ok(issue.sourceIndex!.length >= 1);
});

test("全静默语义: 空文字 ok 且 allSilence=true", () => {
  const decoded = decode([{ state: "off", duration: 700 }], { unit: 100 });
  assert.equal(decoded.status, "ok");
  assert.equal(decoded.text, "");
  assert.equal(decoded.allSilence, true);
});

test("首尾静默被剥离并记录，不产生空前后单词", () => {
  const body = encode("AB", 100).segments;
  const withSilence = [
    { state: "off", duration: 900 },
    ...body,
    { state: "off", duration: 450 },
  ];
  const decoded = decode(withSilence, { unit: 100 });
  assert.equal(decoded.text, "AB");
  assert.deepEqual(decoded.leadingSilence!.sourceIndex, [0]);
  assert.deepEqual(decoded.trailingSilence!.sourceIndex, [body.length + 1]);
  assert.equal(decoded.leadingSilence!.interval[0], 0);
});

test("相邻同状态段先合并并保留全部来源下标", () => {
  const decoded = decode(
    [{ state: "on", duration: 150 }, { state: "on", duration: 150 }],
    { unit: 100 },
  );
  assert.equal(decoded.status, "ok");
  assert.equal(decoded.text, "T");
  assert.deepEqual(decoded.chars[0]!.sourceIndex, [0, 1]);
  assert.equal(decoded.normalizedSegments[0]!.duration, 300);
});

test("每字符报告原始段下标与时间区间", () => {
  const decoded = decode(encode("SOS", 100).segments, { unit: 100 });
  assert.equal(decoded.chars.length, 3);
  for (const char of decoded.chars) {
    assert.ok(char.segmentIndex.length >= 1);
    assert.ok(char.end > char.start);
  }
  assert.deepEqual(
    decoded.chars.map((char) => char.char),
    ["S", "O", "S"],
  );
});

test("小数时长稳定比较", () => {
  const encoded = encode("E", 0.1);
  const decoded = decode(
    encoded.segments.map((segment) => ({
      state: segment.state,
      duration: segment.duration + 0.019,
    })),
    { unit: 0.1, tolerance: 0.2 },
  );
  assert.equal(decoded.status, "ok");
  assert.equal(decoded.text, "E");
});

test("无效输入的错误码", () => {
  const cases: Array<[unknown, unknown, string]> = [
    ["", 1, "EMPTY_TEXT"],
    ["A!", 1, "INVALID_CHARACTER"],
    [[], { unit: 1 }, "INVALID_SEGMENTS"],
    [[{ state: "bright", duration: 1 }], { unit: 1 }, "INVALID_SEGMENT_STATE"],
    [[{ state: "on", duration: 0 }], { unit: 1 }, "INVALID_DURATION"],
    [[{ state: "on", duration: -1 }], { unit: 1 }, "INVALID_DURATION"],
    [[{ state: "on", duration: Number.NaN }], { unit: 1 }, "INVALID_DURATION"],
    [[{ state: "on", duration: Number.POSITIVE_INFINITY }], { unit: 1 }, "INVALID_DURATION"],
    [[{ state: "on", duration: 1 }], { unit: 0 }, "INVALID_UNIT"],
    [[{ state: "on", duration: 1 }], { unit: -5 }, "INVALID_UNIT"],
  ];
  for (const [textOrSegments, params, code] of cases) {
    assert.throws(
      () => {
        if (typeof textOrSegments === "string") {
          encode(textOrSegments, params);
        } else {
          decode(textOrSegments, params as { unit: number });
        }
      },
      (error: unknown) => error instanceof MorseError && error.code === code,
      `应抛出 ${code}`,
    );
  }
});

test("过大的序列被拒绝", () => {
  const huge = Array.from({ length: 100_001 }, () => ({ state: "on" as const, duration: 1 }));
  assert.throws(
    () => decode(huge, { unit: 1 }),
    (error: unknown) => error instanceof MorseError && error.code === "SEQUENCE_TOO_LARGE",
  );
});
