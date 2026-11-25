// The daemon part of OK: the prompts the person is likely to send next to a session, predicted from the end of its
// conversation (predict.ts).
import { defineDaemonPlugin, PluginError } from "@gasho/plugin-sdk/daemon";
import { predict } from "./predict.ts";

export default defineDaemonPlugin({
  methods: {
    /**
     * Prediction for the session of the call. `at`: when its last reply ended (SessionInfo.lastActivityAt), so that a
     * new reply is a new call while the same one shares the answer.
     */
    async predict(params, ctx) {
      const at = (params as { at?: unknown } | undefined)?.at;
      if (typeof at !== "number" || !Number.isFinite(at)) throw new PluginError("返答の時刻が正しくありません。");
      return predict(ctx, at);
    },
  },
});
