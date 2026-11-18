// The daemon part of the usage plugin: the Claude.ai plan's usage limits on its working server, read with Claude Code's
// get_usage (usage.ts). The context window needs no daemon part: gasho-daemon puts it in SessionInfo.context.
import { defineDaemonPlugin } from "@gasho/plugin-sdk/daemon";
import { readLimits } from "./usage.ts";

export default defineDaemonPlugin({
  methods: {
    /** The plan's usage limits (UsageLimits). No params: they are the account's, not a session's. */
    async limits(_params, ctx) {
      return readLimits({ dataDir: ctx.dataDir });
    },
  },
});
