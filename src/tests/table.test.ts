import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_TO_CHAR, MORSE_TABLE, SUPPORTED_CHARS } from "../morse/table.js";
import { decode } from "../morse/decode.js";
import { encode } from "../morse/encode.js";

const EXPECTED: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
};

test("码表恰好覆盖 A-Z 与 0-9 共 36 个字符且全部正确", () => {
  assert.equal(SUPPORTED_CHARS.length, 36);
  for (const [char, code] of Object.entries(EXPECTED)) {
    assert.equal(MORSE_TABLE[char], code, `${char} 码值错误`);
    assert.equal(CODE_TO_CHAR.get(code), char, `${code} 反向映射错误`);
  }
  assert.equal(new Set(Object.values(MORSE_TABLE)).size, 36, "码值必须唯一");
});

test("36 个字符逐一编码后独立解码，与公开码表一致", () => {
  for (const char of Object.keys(EXPECTED)) {
    const encoded = encode(char, 1);
    const decoded = decode(encoded.segments, { unit: 1, tolerance: 0.2 });
    assert.equal(decoded.status, "ok", `${char} 解码失败: ${JSON.stringify(decoded.issues)}`);
    assert.equal(decoded.text, char);
    assert.deepEqual(decoded.charCodes, [EXPECTED[char]]);
  }
});
