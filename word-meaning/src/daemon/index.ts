// The daemon part of Word Meaning: the meaning of a word selected in one of Claude's answers (explain.ts).
import { defineDaemonPlugin } from "@gasho/plugin-sdk/daemon";
import { explain } from "./explain.ts";

export default defineDaemonPlugin({
  methods: {
    /** The meaning of `word` in the text around it (MeaningParams). */
    meaning: (params, ctx) => explain(params, ctx),
  },
});
