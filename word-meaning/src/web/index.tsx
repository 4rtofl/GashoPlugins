// The web part of Word Meaning: by a word selected in one of Claude's answers, in Gasho's popup (P22, plugin API
// 1.21), a button that shows the word's meaning in the text around it (meaning.tsx).
import { definePlugin, type AnswerSelectionItem } from "@gasho/plugin-sdk";
import { isWord } from "../word.ts";
import { WordMeaning } from "./meaning";
import "./style.css";

/** A word (not a sentence) selected where the daemon part can be asked. */
export const shows: NonNullable<AnswerSelectionItem["when"]> = (c) => c.machine.connected && c.daemon.ready && isWord(c.selection.text);

export default definePlugin({
  answerSelection: [{ id: "meaning", when: shows, component: WordMeaning }],
});
