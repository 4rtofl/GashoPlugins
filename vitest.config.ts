// The tests of the plugins' screens (*/test/*.test.tsx): their parts drawn in happy-dom, with "@gasho/plugin-sdk" read
// from test/sdk.tsx, as Gasho's screen is not there to give it. The tests of the .ts files run with node --test.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The times the parts show (toLocaleString and the like) are the same here and in GitHub Actions, which runs in UTC.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: { alias: [{ find: /^@gasho\/plugin-sdk$/, replacement: fileURLToPath(new URL("test/sdk.tsx", import.meta.url)) }] },
  test: {
    environment: "happy-dom",
    include: ["*/test/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    // A test presses and types as a person does (user-event), which takes several seconds on a busy machine.
    testTimeout: 60_000,
  },
});
