/**
 * Where an exploratory card's workspace lives when it has no project source.
 *
 * A Personal-project request gets an isolated, persistent workspace instead
 * of a project checkout, so its state dir, claims, and worktrees are all
 * resolved under one root rather than inside a project the card does not own.
 */
import { join as nodeJoin } from "node:path";

export const EXPLORATORY_SCOPE = nodeJoin(
  process.env.HOME ?? "/tmp",
  ".bb",
  "stelow",
  "exploratory",
);
