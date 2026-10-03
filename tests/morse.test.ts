import { test } from "node:test";
import assert from "node:assert/strict";
import { MORSE_TABLE, encodeText, decodeSegments, MorseError } from "../src/morse.ts";

// 独立参考码表（与实现分开书写，避免编码器/解码器互证）
const REFERENCE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};

test("36 个字符的码表逐一核对", () => {
  assert.equal(Object.keys(MORSE_TABLE).length, 36);
  for (const [ch, pattern] of Object.entries(REFERENCE)) {
    assert.equal(MORSE_TABLE[ch], pattern, `字符 ${ch} 码表不符`);
  }
});

test("每个字符单独编码-解码往返，且点划与参考一致", () => {
  for (const [ch, pattern] of Object.entries(REFERENCE)) {
    const enc = encodeText(ch, 100);
    assert.equal(enc.dotDash, pattern);
    const dec = decodeSegments(enc.segments, 100, 0.1);
    assert.ok(dec.ok);
    assert.equal(dec.text, ch);
  }
});

test("组合文本往返（字母+数字+多词）", () => {
  const enc = encodeText("HELLO WORLD 123 ABC", 50);
  const dec = decodeSegments(enc.segments, 50, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "HELLO WORLD 123 ABC");
});

test("连续空格折叠为单个词间隔，首尾空格忽略", () => {
  const enc = encodeText("  AB   CD  ", 100);
  assert.equal(enc.text, "AB CD");
  const offs = enc.segments.filter((s) => s.state === "off");
  assert.ok(offs.some((s) => s.duration === 700));
  assert.ok(!offs.some((s) => s.duration === 1400));
  assert.equal(enc.segments[0].state, "on");
  assert.equal(enc.segments[enc.segments.length - 1].state, "on");
});

test("字符内/字符间/词间三种暗间隔不混淆", () => {
  // "EA B"：E 后字符内间隔(1)、E-A 字符间隔(3)、A-B 词间隔(7)
  const enc = encodeText("EA B", 100);
  const dec = decodeSegments(enc.segments, 100, 0.2);
  assert.ok(dec.ok);
  assert.equal(dec.text, "EA B");
  assert.deepEqual(dec.chars.map((c) => c.char), ["E", "A", "B"]);
});

test("连续点划（如 S=...、5=.....）正确分段", () => {
  const enc = encodeText("S5", 100);
  const dec = decodeSegments(enc.segments, 100, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "S5");
});

test("相邻同状态段合并并记录来源下标", () => {
  // 把 E 的点拆成两段 on（中间无 off）
  const segs = [
    { state: "on", duration: 60 },
    { state: "on", duration: 40 }, // 合并为 100 = 1 单位
    { state: "off", duration: 300 },
    { state: "on", duration: 100 },
  ];
  const dec = decodeSegments(segs, 100, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "EE");
  assert.deepEqual(dec.normalized[0].sourceIndices, [0, 1]);
});

test("首尾静默被剥离且不产生空单词", () => {
  const enc = encodeText("HI", 100);
  const segs = [
    { state: "off", duration: 700 },
    ...enc.segments,
    { state: "off", duration: 300 },
  ];
  const dec = decodeSegments(segs, 100, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "HI");
  assert.deepEqual(dec.leadingSilence, [0]);
  assert.deepEqual(dec.trailingSilence, [segs.length - 1]);
});

test("全静默返回空文本且 ok", () => {
  const dec = decodeSegments([{ state: "off", duration: 500 }], 100, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "");
});

test("容差边界：恰好等于容差通过，超出即失败并定位", () => {
  const enc = encodeText("E", 100);
  const atEdge = enc.segments.map((s) => ({ ...s, duration: s.duration * 1.2 }));
  assert.ok(decodeSegments(atEdge, 100, 0.2).ok);
  const beyond = enc.segments.map((s) => ({ ...s, duration: s.duration * 1.21 }));
  const dec = decodeSegments(beyond, 100, 0.2);
  assert.equal(dec.ok, false);
  assert.equal(dec.errors[0].code, "DURATION_OUT_OF_TOLERANCE");
  assert.equal(dec.errors[0].segmentIndex, 0);
});

test("容差上限 20%：超过即拒绝参数", () => {
  assert.throws(() => decodeSegments([{ state: "on", duration: 100 }], 100, 0.2001),
    (e: MorseError) => e.code === "INVALID_TOLERANCE");
  assert.throws(() => decodeSegments([{ state: "on", duration: 100 }], 100, -0.1),
    (e: MorseError) => e.code === "INVALID_TOLERANCE");
});

test("不合法间隔（5 单位暗段）被定位，整段失败", () => {
  const enc = encodeText("AB", 100);
  const segs = enc.segments.map((s) => ({ ...s }));
  const idx = segs.findIndex((s) => s.state === "off" && s.duration === 300);
  segs[idx].duration = 500;
  const dec = decodeSegments(segs, 100, 0.15);
  assert.equal(dec.ok, false);
  assert.equal(dec.text, "");
  assert.equal(dec.errors[0].code, "DURATION_OUT_OF_TOLERANCE");
  assert.equal(dec.errors[0].segmentIndex, idx);
});

test("未知点划组合被定位，部分可读也不标成功", () => {
  // ".-" = A，".-.-" 不是任何字符
  const segs = [
    { state: "on", duration: 100 }, { state: "off", duration: 100 },
    { state: "on", duration: 300 }, { state: "off", duration: 100 },
    { state: "on", duration: 100 }, { state: "off", duration: 100 },
    { state: "on", duration: 300 },
  ];
  const dec = decodeSegments(segs, 100, 0.1);
  assert.equal(dec.ok, false);
  assert.equal(dec.errors[0].code, "UNKNOWN_PATTERN");
  assert.equal(dec.errors[0].pattern, ".-.-");
  assert.equal(dec.errors[0].segmentIndex, 0);
});

test("无效输入：零/负/非有限时长、非法状态、过长序列", () => {
  assert.throws(() => decodeSegments([{ state: "on", duration: 0 }], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENT");
  assert.throws(() => decodeSegments([{ state: "on", duration: -5 }], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENT");
  assert.throws(() => decodeSegments([{ state: "on", duration: NaN }], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENT");
  assert.throws(() => decodeSegments([{ state: "on", duration: Infinity }], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENT");
  assert.throws(() => decodeSegments([{ state: "blink", duration: 1 }], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENT");
  assert.throws(() => decodeSegments([], 100, 0.1),
    (e: MorseError) => e.code === "INVALID_SEGMENTS");
  const huge = Array.from({ length: 100001 }, () => ({ state: "on", duration: 1 }));
  assert.throws(() => decodeSegments(huge, 100, 0.1),
    (e: MorseError) => e.code === "SEQUENCE_TOO_LONG");
});

test("无效文本：空文本、仅空格、非法字符", () => {
  assert.throws(() => encodeText("", 100), (e: MorseError) => e.code === "EMPTY_TEXT");
  assert.throws(() => encodeText("   ", 100), (e: MorseError) => e.code === "EMPTY_TEXT");
  assert.throws(() => encodeText("HELLO!", 100), (e: MorseError) => e.code === "INVALID_CHARACTER");
  assert.throws(() => encodeText("你好", 100), (e: MorseError) => e.code === "INVALID_CHARACTER");
});

test("非法 unitMs 拒绝", () => {
  for (const bad of [0, -1, NaN, Infinity, "100"]) {
    assert.throws(() => decodeSegments([{ state: "on", duration: 1 }], bad, 0.1),
      (e: MorseError) => e.code === "INVALID_UNIT");
  }
});

test("有限小数时长稳定比较", () => {
  const enc = encodeText("SOS", 33.3);
  const dec = decodeSegments(enc.segments, 33.3, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.text, "SOS");
});

test("字符追踪：原始段下标与时间区间正确", () => {
  const enc = encodeText("ET", 100); // E=.(1) off3 T=-(3)
  const dec = decodeSegments(enc.segments, 100, 0.1);
  assert.ok(dec.ok);
  assert.equal(dec.chars.length, 2);
  assert.equal(dec.chars[0].segmentStart, 0);
  assert.equal(dec.chars[0].segmentEnd, 0);
  assert.equal(dec.chars[0].timeStartMs, 0);
  assert.equal(dec.chars[0].timeEndMs, 100);
  assert.equal(dec.chars[1].segmentStart, 2);
  assert.equal(dec.chars[1].timeStartMs, 400);
  assert.equal(dec.chars[1].timeEndMs, 700);
});

test("相同参数重复分析结果一致", () => {
  const enc = encodeText("REPEAT 7", 80);
  const a = decodeSegments(enc.segments, 80, 0.1);
  const b = decodeSegments(enc.segments, 80, 0.1);
  assert.deepEqual(a, b);
});
