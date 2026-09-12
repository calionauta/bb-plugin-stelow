/**
 * Deliberately small first architecture gate. `app.tsx` uses server's RPC
 * type contract, so a blanket app→server ban would fail honestly today.
 * These rules instead enforce the boundaries that are already real and safe.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      comment: "Cycles make worker and UI changes harder for both humans and agents to reason about.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-stays-host-neutral",
      comment: "Shared library code must not reach into the bb server or React app layers.",
      severity: "error",
      from: { path: "^lib/" },
      to: { path: "^(app\\.tsx|server\\.ts|components/|hooks/)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
