import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Opening a completed card is what satisfies its review request.
 *
 * `hasPendingReview` (lib/inbox-events.mjs) answers from `read_at`, and
 * `server/inbox.ts` writes `read_at` from three places: `markNotificationRead`
 * (the inbox panel's own button), `markNotificationUnread` (its reversal), and
 * `markCardNotificationsRead` (the card). The board chip and the completion
 * notification both read the third writer's output — so if the card stops
 * calling it, the review request is never satisfied by the one act that can
 * satisfy it, and the chip stays lit forever on a card that is not archived.
 *
 * **This file pins the WIRING, and that is the whole point of it.**
 * `tests/server-inbox.test.mjs` already proves the handler's semantics in
 * depth — idempotence, the archived refusal, and that question/error/paused are
 * never cleared by an open. Every one of those assertions holds with the call
 * site deleted from the tree, because they exercise the handler directly and
 * never ask who calls it. That is the failure this repo has already shipped
 * once: a rule correct inside `lib/` and absent from the component, green in
 * every suite. So a handler test is not evidence that opening a card clears
 * anything, and this file refuses to be satisfied by one.
 *
 * **Why a receipt may be spent on any card is a measured claim, not an
 * assumption.** The only fetch of `cardDetail` in the tree is
 * `build-detail-body.tsx`, and there is no prefetch, hover-open or visibility
 * hook anywhere in `components/`, `lib/` or `app.tsx` — every mount that
 * reaches it is one a person asked for (the drawer, the quick palette, a board
 * row, an inbox row, or a create dialog opening its own card deliberately).
 * That is why clearing on open cannot spend a review on a card nobody chose,
 * and it is why the first assertion below re-counts the call sites instead of
 * trusting this paragraph: a new prefetch would invalidate the premise, and the
 * count is what notices.
 *
 * Two card kinds never reach the build body, so their receipts are pinned here
 * too. All three are guarded on the completed status, because only a
 * completion carries the "audit evidence is ready" claim — an unread question or
 * failure is answered or acted on, never looked at.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

/** The three card bodies a reader can land in. Each owns one kind's receipt. */
const BODIES = [
  {
    file: "components/detail/build-detail-body.tsx",
    kind: "build",
    status: "card?.status",
    receivesTheFetch: true,
  },
  {
    file: "components/detail/use-research-detail-state.ts",
    kind: "research",
    status: "cardStatus",
    receivesTheFetch: false,
  },
  {
    file: "components/detail/use-explore-detail-state.ts",
    kind: "explore",
    status: "cardStatus",
    receivesTheFetch: false,
  },
];

/**
 * The receipt, and the guard that keeps it from firing early. Both idioms count
 * as guarded — the bodies are three files written at three times, and pinning
 * one spelling would make a reader reshape working code to satisfy a test:
 *   inline    if (cardStatus === "completed") void rpc.call("markCardNotificationsRead", …)
 *   early-out if (card?.status !== "completed") return;  void rpc.call("markCardNotificationsRead", …)
 * What must hold is that the status is consulted and the call carries the
 * completion kind. The spelling between them is not the rule.
 */
// `cardStatus` is a plain identifier; `card?.status` carries a `?` that would
// otherwise be read as a regex quantifier and match nothing.
const escapeStatus = (status) => status.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const GUARDED_RECEIPT = (status) => new RegExp(
  String.raw`(?:if \(${escapeStatus(status)} === "completed"\) void rpc\.call\("markCardNotificationsRead"`
  + String.raw`|if \(${escapeStatus(status)} !== "completed"\) return;[\s\S]{0,80}?`
  + String.raw`void rpc\.call\("markCardNotificationsRead")`
  + String.raw`, \{ cardId, kind: "completed" \}\)`,
);

test("the completion receipt has exactly one call site per card kind, and every one is guarded on completed", () => {
  for (const body of BODIES) {
    const source = read(body.file);
    assert.equal(
      (source.match(/markCardNotificationsRead/g) ?? []).length,
      1,
      `${body.file} must carry exactly one completion receipt — a second copy is a second `
      + "place the rule can be satisfied or quietly dropped",
    );
    assert.match(
      source,
      GUARDED_RECEIPT(body.status),
      `${body.file} must clear the review only for a completed ${body.kind} card: a reader who `
      + "opens a card mid-work must not silence a live question, error or pause by looking at it",
    );
  }
});

test("the build body both fetches the card and spends the receipt, so no chosen card can lose its review", () => {
  const body = read("components/detail/build-detail-body.tsx");
  assert.equal(
    (body.match(/rpc\.call\("cardDetail"/g) ?? []).length,
    1,
    "cardDetail is fetched once, in the body that also spends the receipt — a build card is the "
    + "one kind whose detail and whose review live in the same component",
  );
  // The receipt must be re-evaluated when the STATUS arrives, not only on mount:
  // `card` is null on first paint, so a mount-only read would clear nothing.
  assert.match(
    body,
    /useEffect\(\(\) => \{[\s\S]*?card\?\.status !== "completed"[\s\S]*?\}, \[cardId, card\?\.status, rpc\]\);/,
    "the build receipt depends on the loaded status, because the card is null until cardDetail "
    + "resolves — keying it on mount alone would clear the review for nobody",
  );
});

test("no prefetch can spend a review, because a reader who never chose the card must not lose one", () => {
  // The premise that makes clearing-on-open honest is that every fetch of
  // cardDetail is user-initiated. Assert the count rather than trusting the
  // comment: a new prefetch or hover-open would make the receipt fire for a
  // card nobody opened, which is exactly the bug the old deferral feared.
  const candidateCallers = [
    "app.tsx",
    ...BODIES.map((body) => body.file),
    "components/app-support/panel-rendering.tsx",
    "components/detail/card-detail-route.tsx",
    "components/panels/inbox-panel.tsx",
  ];
  const callers = candidateCallers.filter((file) => /rpc\.call\("cardDetail"/.test(read(file)));

  assert.deepEqual(
    callers,
    ["components/detail/build-detail-body.tsx"],
    "cardDetail must be fetched from the detail body alone — a second fetch site (a prefetch, a "
    + "peek, a hover) would let a card lose its review without a reader ever choosing it",
  );
  const surfaces = BODIES.filter((body) => body.receivesTheFetch);
  assert.equal(
    surfaces.length,
    1,
    "exactly one card body may fetch the card; the other two kinds receive their detail from the "
    + "route and only owe the receipt",
  );
});

test("the review is cleared by a read, and a read never resolves what it read", () => {
  // One fact, one home: the inbox row and the board chip are two surfaces of
  // ONE row's `read_at`. Spending the receipt moves read state only — the
  // completion keeps its own lifecycle, so "reviewed" never reads downstream as
  // "closed", and an archived card's row is refused the stamp entirely.
  const inbox = read("server/inbox.ts");
  assert.match(
    inbox,
    /UPDATE inbox_events SET read_at = \?\s+WHERE card_id = \? AND kind = 'completed'\s+AND read_at IS NULL AND archived_at IS NULL/,
    "the receipt writes read_at for unarchived completions only, and never resolved_at — an "
    + "archived card is unreachable, so a read there would record a sighting nobody can make",
  );
});
