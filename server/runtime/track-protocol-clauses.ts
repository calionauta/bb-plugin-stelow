/**
 * The protocol clauses a TRACK worker prompt carries, as one object.
 *
 * A second bag rather than a subset of `WORKER_PROTOCOL_CLAUSES`, because the
 * sets are genuinely different and the difference is the point: research and
 * explore cards have no stages, no gates, and no advance, so the build bag's
 * intro, skills pointer, seed ban, recon, turn, commit, interface, split and
 * command-failure clauses all describe machinery their workers cannot reach.
 * Carrying them would not make a track worker safer; it would tell it about a
 * stage machine it must not touch and make every track prompt pay for it.
 *
 * The completion rule is the other half of the split: a build card finishes at
 * `audit` with a run bundle, an `audit.md`, and a gap loop, and a track card
 * has none of that. `DONE_PROTOCOL_TRACK` carries the rule a track worker
 * actually owes — finish with `bb stelow done` once `verify` passes — so no
 * track prompt renders the 2.3 KB build payload.
 *
 * Built once here for the same reason as the build bag: a caller that hands the
 * prompt a hand-written copy is a caller that can drift.
 */
import {
  CARD_OWNER_RULES,
  DONE_PROTOCOL_TRACK,
  DRAFT_PROTOCOL,
  REVIEW_PROTOCOL,
  USER_INPUT_CONTRACT,
} from "./plugin-protocols.js";

export const TRACK_PROTOCOL_CLAUSES = {
  cardOwnerRules: CARD_OWNER_RULES,
  // Keyed `doneProtocolTrack`, not `doneProtocol`: it is a DIFFERENT clause
  // from the build one, and a shared key would let the two be budgeted as one.
  doneProtocolTrack: DONE_PROTOCOL_TRACK,
  reviewProtocol: REVIEW_PROTOCOL,
  draftProtocol: DRAFT_PROTOCOL,
  userInputContract: USER_INPUT_CONTRACT,
} as const;
