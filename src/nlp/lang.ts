// Message language detection and caps ratio.
// Language is determined by the franc library (limited to the rus/eng pair — that way
// it's accurate even on short prompts). The script heuristic remains only to
// separately flag "mixed" (Russian with English terms) and "other".

import { franc } from "franc";

const CYR = /[Ѐ-ӿ]/;
const LAT = /[A-Za-z]/;

export type Lang = "ru" | "en" | "mixed" | "other";

function scriptCounts(text: string): { cyr: number; lat: number } {
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (CYR.test(ch)) cyr++;
    else if (LAT.test(ch)) lat++;
  }
  return { cyr, lat };
}

export function detectLang(text: string): Lang {
  const { cyr, lat } = scriptCounts(text);
  const total = cyr + lat;
  if (total < 3) return "other";
  // A single alphabet — an unambiguous, instant answer; franc isn't needed.
  if (lat === 0) return "ru";
  if (cyr === 0) return "en";
  // Both alphabets are notably present → mixed.
  const minorityShare = Math.min(cyr, lat) / total;
  if (minorityShare > 0.3) return "mixed";
  // One dominates but the other alphabet is present — an ambiguous case;
  // this is where franc really helps (it distinguishes the language, not just the script).
  const code = franc(text, { only: ["rus", "eng"], minLength: 2 });
  if (code === "rus") return "ru";
  if (code === "eng") return "en";
  return cyr >= lat ? "ru" : "en";
}

/** Uppercase letter? Latin A-Z + Cyrillic U+0410..U+042F and U+0401. */
function isUpper(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x410 && code <= 0x42f) ||
    code === 0x401
  );
}

function isLower(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x430 && code <= 0x44f) ||
    code === 0x451
  );
}

/**
 * Ratio of uppercase letters among all letters (Latin + Cyrillic).
 * Detects "shouting"/frustration (CAPS LOCK). There's no off-the-shelf library for this —
 * it's a trivial domain function.
 */
export function capsLetterRatio(text: string): number {
  let letters = 0;
  let upper = 0;
  const limit = Math.min(text.length, 4000);
  for (let i = 0; i < limit; i++) {
    const c = text.charCodeAt(i);
    if (isUpper(c)) {
      letters++;
      upper++;
    } else if (isLower(c)) {
      letters++;
    }
  }
  return letters > 0 ? upper / letters : 0;
}
