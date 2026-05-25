/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Profanity detection backed by the `leo-profanity` dictionary, so the
 * plaintext wordlist lives in an external package and is not committed to
 * this repository.
 *
 * We strip fenced code blocks and inline backticks before checking so that
 * strings inside code snippets don't produce false positives.
 */

import leoProfanity from 'leo-profanity';
import BadWordsNext from 'bad-words-next';
import bwEn from 'bad-words-next/lib/en';
import bwRu from 'bad-words-next/lib/ru';
import bwRuLat from 'bad-words-next/lib/ru_lat';

// Русский мат leo-profanity не ловит (англоязычный словарь). Добавляем
// bad-words-next с русскими словарями (ru + транслит ru_lat) и английским.
// Инициализируем один раз на модуль — конструктор тяжёлый.
const bw = new BadWordsNext();
bw.add(bwEn);
bw.add(bwRu);
bw.add(bwRuLat);

// Кап длины: bad-words-next заметно тормозит на длинных текстах, а мат
// почти всегда в начале сообщения. Хватает первых символов.
const MAX_SCAN = 600;

/** Strip code blocks and inline-backtick content so we don't flag code strings. */
function stripCode(text: string): string {
  return text.replaceAll(/```[\s\S]*?```/g, '').replaceAll(/`[^`]+`/g, '');
}

/** Remove machine noise that produces phantom profanity matches: UUIDs/hashes
 *  (e.g. `aeb946c70afd…` → the ru_lat dictionary reads `eb` as «еб»), file
 *  paths, and [Image: …] tokens. Hex runs must contain a digit so plain words
 *  like "facade"/"decade" survive (harmless either way). */
function stripNoise(text: string): string {
  return text
    .replaceAll(/\[image[^\]]*\]/gi, ' ')
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replaceAll(/(?:\/[\w.\-]+){2,}\/?/g, ' ')        // absolute-ish file paths
    .replaceAll(/\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/gi, ' ') // hex hashes/ids (with a digit)
    .replaceAll(/\bдеб[еи]т\w*/gi, ' ');               // accounting «дебет/дебит» ≠ мат
}

/** Returns true if the (code-stripped, noise-stripped) text has a flagged word (RU+EN). */
export function containsProfanity(text: string): boolean {
  if (!text) return false;
  const cleaned = stripNoise(stripCode(text));
  if (leoProfanity.check(cleaned)) return true;
  return bw.check(cleaned.slice(0, MAX_SCAN));
}

/**
 * Extract all flagged words found in the text (deduped, order-preserving,
 * lowercased). Matches inside fenced or inline code are ignored.
 */
export function extractProfaneWords(text: string): string[] {
  if (!text) return [];
  const cleaned = stripCode(text);
  const found = leoProfanity.badWordsUsed(cleaned);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const w = raw.toLowerCase();
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}
