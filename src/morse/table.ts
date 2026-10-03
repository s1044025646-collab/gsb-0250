export const MORSE_TABLE: Record<string, string> = {
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

export const CODE_TO_CHAR: Map<string, string> = new Map(
  Object.entries(MORSE_TABLE).map(([char, code]) => [code, char]),
);

export const SUPPORTED_CHARS: readonly string[] = Object.keys(MORSE_TABLE);

export const UNIT = {
  DOT: 1,
  DASH: 3,
  INTRA_CHAR_GAP: 1,
  INTER_CHAR_GAP: 3,
  WORD_GAP: 7,
} as const;

export const MAX_TOLERANCE = 0.2;
export const MAX_SEGMENT_COUNT = 100_000;
export const MAX_DURATION = 1_000_000;
