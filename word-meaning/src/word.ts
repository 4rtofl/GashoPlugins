// What the web and daemon parts of Word Meaning share: which selections are words, and what the method gets and gives.

/** The longest text that is taken for a word: longer ones are sentences, which the button does not show for. */
export const MAX_WORD = 40;

/** The range of the setting contextChars (gasho-plugin.json): the word and the text around it given to Claude Code. */
export const CONTEXT = { default: 600, min: 0, max: 4000 };

/** Whether text selected in an answer (trimmed by Gasho) is a word to look up. */
export const isWord = (text: string) => text.length > 0 && text.length <= MAX_WORD && !text.includes("\n");

/**
 * What the web part sends to `meaning`: the word, and as much of the answer before and after it as the setting can
 * ask for (CONTEXT.max each), which the daemon part cuts to the setting, as it knows its value.
 */
export interface MeaningParams {
  word: string;
  before: string;
  after: string;
}

/** What `meaning` answers. */
export interface Meaning {
  /** The meaning of the word in that text, in one sentence. */
  meaning: string;
}
