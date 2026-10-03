import { MORSE_TABLE, UNIT } from "./table.js";
import type { EncodeResult, Segment } from "./types.js";
import { fail } from "../errors.js";
import { validateUnit } from "./validate.js";

export function normalizeText(input: unknown): string {
  if (typeof input !== "string") {
    fail("EMPTY_TEXT", "待编码文本必须是字符串");
  }
  const collapsed = input.toUpperCase().replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    fail("EMPTY_TEXT", "待编码文本为空（空文本没有可编码的脉冲）");
  }
  for (const char of collapsed) {
    if (char !== " " && !(char in MORSE_TABLE)) {
      fail("INVALID_CHARACTER", `字符 "${char}" 不在支持范围内（仅 A-Z、0-9、空格）`, {
        character: char,
      });
    }
  }
  return collapsed;
}

export function encode(input: unknown, unitInput: unknown = 1): EncodeResult {
  const text = normalizeText(input);
  const unit = validateUnit(unitInput);

  const words = text.split(" ");
  const segments: Segment[] = [];
  const scale = (units: number): number => units * unit;

  words.forEach((word, wordIndex) => {
    const chars = [...word];
    chars.forEach((char, charIndex) => {
      const code = MORSE_TABLE[char];
      if (code === undefined) {
        fail("INVALID_CHARACTER", `字符 "${char}" 无对应摩尔斯码`, { character: char });
      }
      [...code].forEach((symbol, symbolIndex) => {
        segments.push({
          state: "on",
          duration: scale(symbol === "." ? UNIT.DOT : UNIT.DASH),
        });
        const isLastSymbol = symbolIndex === code.length - 1;
        if (!isLastSymbol) {
          segments.push({ state: "off", duration: scale(UNIT.INTRA_CHAR_GAP) });
        }
      });
      const isLastChar = charIndex === chars.length - 1;
      if (!isLastChar) {
        segments.push({ state: "off", duration: scale(UNIT.INTER_CHAR_GAP) });
      }
    });
    const isLastWord = wordIndex === words.length - 1;
    if (!isLastWord) {
      segments.push({ state: "off", duration: scale(UNIT.WORD_GAP) });
    }
  });

  return { segments, text, unit };
}
