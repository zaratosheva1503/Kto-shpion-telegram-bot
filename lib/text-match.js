"use strict";

// Pure text utilities for fuzzy guess matching (RU/EN transliteration).

const RU_TO_EN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};
const EN_TO_RU = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "и", j: "дж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "й", z: "з",
};

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/gi, "");
}

function toEn(str) {
  return str
    .toLowerCase()
    .split("")
    .map((c) => RU_TO_EN[c] || c)
    .join("");
}

function toRu(str) {
  return str
    .toLowerCase()
    .split("")
    .map((c) => EN_TO_RU[c] || c)
    .join("");
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(guess, cardName) {
  const g = normalize(guess);
  const c = normalize(cardName);
  if (!g || !c) return false;
  if (g === c) return true;
  if (c.includes(g) || g.includes(c)) return true;
  const variants = new Set([g]);
  variants.add(normalize(toEn(guess)));
  variants.add(normalize(toRu(guess)));
  const targets = new Set([c]);
  targets.add(normalize(toEn(cardName)));
  targets.add(normalize(toRu(cardName)));
  for (const v of variants) {
    for (const t of targets) {
      if (v === t) return true;
      if (t.includes(v) || v.includes(t)) return true;
      const maxLen = Math.max(v.length, t.length);
      if (
        maxLen > 2 &&
        levenshtein(v, t) <= Math.max(1, Math.floor(maxLen * 0.25))
      )
        return true;
    }
  }
  return false;
}

function normalizeGuess(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

module.exports = {
  RU_TO_EN,
  EN_TO_RU,
  normalize,
  toEn,
  toRu,
  levenshtein,
  fuzzyMatch,
  normalizeGuess,
};
