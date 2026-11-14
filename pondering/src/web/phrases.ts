// The words Pondering shows while Claude works, in six languages. Each piece of work gets one: a language at random,
// then one of its words, picked from the session and the time the work started. It so stays the same while the work
// goes on, and every screen that shows the session shows the same one.

export interface Phrase {
  text: string;
  /** Its language, for the lang attribute (fonts of Chinese and Korean, reading aloud). */
  lang: string;
}

export const PHRASES: Readonly<Record<string, readonly string[]>> = {
  ja: [
    "考え中",
    "思案中",
    "熟考中",
    "沈思黙考中",
    "頭をひねっています",
    "知恵を絞っています",
    "練っています",
    "こねています",
    "煮込んでいます",
    "醸しています",
    "ひらめき待ち",
    "段取り中",
    "吟味しています",
    "組み立てています",
    "うなっています",
    "腕を組んでいます",
  ],
  en: [
    "Pondering",
    "Mulling",
    "Musing",
    "Ruminating",
    "Noodling",
    "Tinkering",
    "Puzzling",
    "Brewing",
    "Simmering",
    "Percolating",
    "Contemplating",
    "Deliberating",
    "Cogitating",
    "Brainstorming",
    "Untangling",
    "Crafting",
    "Weaving",
    "Whittling",
    "Kneading",
    "Wrangling",
  ],
  ko: [
    "생각하는 중",
    "궁리하는 중",
    "고민하는 중",
    "숙고하는 중",
    "곰곰이 생각하는 중",
    "머리를 굴리는 중",
    "뚝딱뚝딱 만드는 중",
    "실타래를 푸는 중",
    "차근차근 정리하는 중",
    "아이디어를 굽는 중",
    "끙끙대는 중",
    "이리저리 맞춰 보는 중",
  ],
  "zh-Hans": [
    "思考中",
    "琢磨中",
    "酝酿中",
    "构思中",
    "推敲中",
    "斟酌中",
    "沉思中",
    "冥思苦想中",
    "绞尽脑汁中",
    "捣鼓中",
    "盘算中",
    "理清头绪中",
    "灵感孵化中",
    "慢慢炖着",
  ],
  de: [
    "Grübeln",
    "Nachdenken",
    "Tüfteln",
    "Sinnieren",
    "Werkeln",
    "Basteln",
    "Brüten",
    "Knobeln",
    "Abwägen",
    "Köcheln",
    "Ausklamüsern",
    "Durchdenken",
    "Herumprobieren",
    "Sortieren",
    "Feilen",
    "Entwirren",
  ],
  // Toki Pona (ISO 639-3: tok).
  tok: [
    "mi pali",
    "mi toki insa",
    "lawa mi li pali",
    "mi alasa e sona",
    "mi lukin e lipu",
    "mi pona e ijo",
    "mi kama sona",
    "mi pali e nasin",
    "mi pali e ilo",
  ],
};

const LANGS = Object.keys(PHRASES);

/**
 * FNV-1a (32 bits) of a string, mixed at the end as MurmurHash3 does (fmix32). Without the mixing, the lowest bit of
 * FNV-1a is the parity of the string's characters, and the language picked would decide half of its phrases.
 */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The phrase for a seed: each language as likely as the others, then each of its phrases. */
export function pickPhrase(seed: string): Phrase {
  const lang = LANGS[hash(`lang:${seed}`) % LANGS.length] ?? "ja";
  const list = PHRASES[lang] ?? [];
  return { lang, text: list[hash(`phrase:${seed}`) % list.length] ?? "" };
}
