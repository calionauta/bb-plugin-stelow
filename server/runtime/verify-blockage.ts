/**
 * Whether the verify failure parking this card is still the failure to act on.
 *
 * A SEPARATE call, for the same reason `sharedCheckoutExposure` is one: the
 * answer costs a subprocess (`git rev-parse HEAD` in the card's checkout),
 * and folding it into `cardDetail` would put that cost on every open-card
 * read for a notice most cards never show. Asked when the reader is looking
 * at a decision hero with open questions.
 *
 * Fail-soft throughout: this is an advisory notice, so an unreadable tree, a
 * missing card, or a non-build track reads as `unknown` — and `unknown`
 * renders nothing — never as an error on the card.
 */
import { classifyVerifyBlockage } from "../../lib/verify-blockage.mjs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type VerifyBlockageReport = {
  state: "clear" | "stale" | "confirmed" | "unknown";
  exitCode: number | null;
  runHeadSha: string | null;
  currentHeadSha: string | null;
};

type VerifyBlockageDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string | null } | null>;
  runGitIn: (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;
};

const UNKNOWN: VerifyBlockageReport = { state: "unknown", exitCode: null, runHeadSha: null, currentHeadSha: null };

export function createVerifyBlockageReader(deps: VerifyBlockageDeps) {
  return {
    reportFor: async (cardId: string): Promise<VerifyBlockageReport> => {
      const card = deps.getCard(cardId);
      // Research and explore tracks verify artifacts, never `--tests`: there
      // is no suite whose failure could go stale, so there is nothing to say.
      if (!card || card.kind !== "build") return UNKNOWN;
      let run: { exit_code: unknown; head_sha: unknown } | null = null;
      try {
        run = deps.db.prepare(
          "SELECT exit_code, head_sha FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
        ).get(cardId) as { exit_code: unknown; head_sha: unknown } | null;
      } catch {
        return UNKNOWN;
      }
      if (!run || typeof run.exit_code !== "number" || typeof run.head_sha !== "string" || !run.head_sha) {
        return UNKNOWN;
      }
      const workspace = await deps.cardWorkspace(card).catch(() => null);
      const checkoutPath = workspace?.path ?? null;
      if (!checkoutPath) return UNKNOWN;
      const head = await deps.runGitIn(checkoutPath, ["rev-parse", "HEAD"]).catch(() => ({ ok: false as const, stdout: "" }));
      const current = head.ok ? head.stdout.trim() : "";
      if (!current) return UNKNOWN;
      return classifyVerifyBlockage({
        latestRun: { exitCode: run.exit_code, headSha: run.head_sha },
        currentHeadSha: current,
      });
    },
  };
}

export type VerifyBlockageReader = ReturnType<typeof createVerifyBlockageReader>;
