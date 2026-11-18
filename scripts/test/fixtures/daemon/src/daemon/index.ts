// A daemon part for the tests of test/daemon.ts (scripts/test/daemon.test.ts).
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";

const close = async (ctx: DaemonContext) => (await ctx.github.write(["issue", "close", "7", "--repo", "o/r"], { repo: "o/r" })).stdout;

export default defineDaemonPlugin({
  methods: {
    echo: (params, ctx) => ({ params, at: new Date(0), gone: undefined, dir: ctx.session?.repo("lib").dir }),
    refuse: () => {
      throw new PluginError("この番号は読めません。");
    },
    crash: () => {
      throw new Error("an error of the code");
    },
    close: (_params, ctx) => close(ctx),
    sneak: (_params, ctx) => close(ctx),
  },
});
