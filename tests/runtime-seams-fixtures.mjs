// The board-read fixture workspace: one tracking file, one real document, one
// whitespace-only file and one script, plus an approvals directory holding a
// gate receipt. The shapes server/runtime/board-read.ts has to tell apart, kept
// apart from the assertions that read them.
export const stateMarkdown = [
  "current_stage: execution",
  "workflow_id: card_1",
].join("\n");

const specBody = "# Spec\n\nThe product, in enough words to be evidence.\n";

/** A workspace with one workflow, one real document, and one empty file. */
export const boardFiles = {
  read: async ({ path: target }) => {
    if (target.endsWith("stelow.json")) {
      return {
        content: JSON.stringify({
          workflows: [
            {
              workflowId: "card_1",
              dirHash: "sw-1",
              created: "2026-01-02T00:00:00.000Z",
              name: "Work",
              status: "in-progress",
            },
          ],
        }),
      };
    }
    if (target.endsWith("state.md")) return { content: stateMarkdown };
    if (target.endsWith("spec-product.md")) return { content: specBody };
    if (target.endsWith("notes.md")) return { content: "   \n" };
    throw new Error(`missing ${target}`);
  },
  listPaths: async ({ path: dir }) => {
    if (dir.includes("/approvals/")) return { paths: ["gate-approved.md"] };
    if (dir.endsWith("/sw-1")) {
      return {
        paths: [`${dir}/spec-product.md`, `${dir}/notes.md`, `${dir}/run.sh`],
      };
    }
    throw new Error("no such dir");
  },
};
