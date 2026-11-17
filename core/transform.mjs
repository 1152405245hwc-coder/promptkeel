import { fail } from "./errors.mjs";

/**
 * Deterministic, dependency-free payload transforms.
 *
 * These are the static half of the technique catalogue in
 * `docs/research/JAILBREAK_ECOSYSTEM_SURVEY.md`: every family a fixed string
 * can express (encoding, cipher, splitting) lands here. Anything that needs a
 * model in the loop (GCG suffixes, PAIR/TAP refinement) stays out.
 *
 * `encode` is total; `decode` exists only for the reversible kinds, and every
 * caller is expected to check `reversible(kind)` first instead of guessing.
 */
export const TRANSFORMS = ["none", "base64", "rot13", "leet", "vowels", "morse", "ascii", "reverse", "split"];

const REVERSIBLE = new Set(["none", "base64", "rot13", "morse", "ascii", "reverse", "split"]);

// Morse has no case, so a decoded payload comes back lowercase. Round-trip
// checks compare against the folded input for these kinds instead of failing.
const CASE_FOLDING = new Set(["morse"]);

const LEET = { a: "4", b: "8", e: "3", g: "9", i: "1", l: "1", o: "0", s: "5", t: "7" };
const UNLEET = { 4: "a", 8: "b", 3: "e", 9: "g", 1: "i", 0: "o", 5: "s", 7: "t" };

const MORSE = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---",
  k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-",
  u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...",
  8: "---..", 9: "----.", ".": ".-.-.-", ",": "--..--", ":": "---...", "?": "..--..", "/": "-..-.",
  "-": "-....-", "'": ".----.", "(": "-.--.", ")": "-.--.-", '"': ".-..-.",
  // Braces carry the \u escape for characters Morse has no code for.
  "{": "-.-.-", "}": ".-.-.",
};
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([ch, code]) => [code, ch]));

const SPLIT_WIDTH = 48;

export function reversible(kind = "none") {
  return REVERSIBLE.has(kind);
}

function assertKind(kind) {
  if (!TRANSFORMS.includes(kind)) fail("transform-kind", `unknown transform: ${kind}`, { known: TRANSFORMS });
}

function rot13(text) {
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// Morse cannot express a CJK character, so anything outside its table travels
// as a \uXXXX escape written in Morse. Decode restores the escape first.
function morseChar(ch) {
  if (MORSE[ch]) return MORSE[ch];
  const code = ch.codePointAt(0);
  if (code < 128) return "";
  const escape = `{u${code.toString(16).padStart(4, "0")}}`;
  return [...escape].map((c) => MORSE[c] ?? "").filter(Boolean).join(" ");
}

function morse(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word].map(morseChar).filter(Boolean).join(" "))
    .join(" / ");
}

function unmorse(text) {
  const letters = text
    .split(" / ")
    .map((word) => word.split(/\s+/).filter(Boolean).map((code) => UNMORSE[code] ?? "").join(""))
    .join(" ");
  return letters.replace(/\{u([0-9a-f]{4})\}/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function encode(text, kind = "none") {
  assertKind(kind);
  const value = String(text ?? "");
  switch (kind) {
    case "none":
      return value;
    case "base64":
      return Buffer.from(value, "utf8").toString("base64");
    case "rot13":
      return rot13(value);
    case "leet":
      return value.replace(/[abeilst]/gi, (ch) => {
        const lower = ch.toLowerCase();
        const mapped = LEET[lower];
        if (!mapped) return ch;
        return ch === lower ? mapped : mapped;
      });
    case "vowels":
      return value.replace(/[aeiou]/gi, "");
    case "morse":
      return morse(value);
    case "ascii":
      return [...value].map((ch) => ch.codePointAt(0)).join(" ");
    case "reverse":
      return [...value].reverse().join("");
    case "split":
      return value.match(new RegExp(`[\\s\\S]{1,${SPLIT_WIDTH}}`, "g"))?.join("\n") ?? "";
    default:
      fail("transform-kind", `unknown transform: ${kind}`, { known: TRANSFORMS });
  }
}

export function decode(text, kind = "none") {
  assertKind(kind);
  if (!REVERSIBLE.has(kind)) fail("transform-irreversible", `transform cannot be decoded: ${kind}`);
  const value = String(text ?? "");
  switch (kind) {
    case "none":
      return value;
    case "base64":
      return Buffer.from(value, "base64").toString("utf8");
    case "rot13":
      return rot13(value);
    case "morse":
      return unmorse(value);
    case "ascii":
      return value
        .split(/\s+/)
        .filter(Boolean)
        .map((code) => String.fromCodePoint(Number(code)))
        .join("");
    case "reverse":
      return [...value].reverse().join("");
    case "split":
      return value.replace(/\n/g, "");
    default:
      fail("transform-kind", `unknown transform: ${kind}`, { known: TRANSFORMS });
  }
}

/**
 * Encode, decode, compare. Callers that want a guarantee about a transform
 * get the measured answer instead of trusting the name.
 */
export function roundTrip(text, kind = "none") {
  const input = String(text ?? "");
  const output = encode(input, kind);
  const ratio = output.length / Math.max(input.length, 1);
  if (!reversible(kind)) return { kind, reversible: false, caseFolding: false, input, output, roundTrip: null, ratio };
  const back = decode(output, kind);
  const caseFolding = CASE_FOLDING.has(kind);
  const ok = back === input || (caseFolding && back === input.toLowerCase());
  return { kind, reversible: true, caseFolding, input, output, roundTrip: ok, ratio };
}
