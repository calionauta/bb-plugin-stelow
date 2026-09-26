/**
 * The protocol clauses every worker prompt shares, as one object.
 *
 * Three call sites used to spell this list out by hand (the respawn
 * preparation, the card-creation rules, and the build sync). They must stay
 * in step: a spawn path that forgets a clause is exactly how the seed ban
 * and the turn discipline went missing once, so the list is built once here
 * and the prompt-contract test pins every consumer against this shape.
 */
import {
  CARD_OWNER_RULES,
  CLI_EQUIVALENTS,
  COMMIT_STYLE,
  DONE_PROTOCOL,
  DRAFT_PROTOCOL,
  INTERFACE_PICK,
  NEVER_SEED,
  RECON_PROTOCOL,
  SPLIT_PROTOCOL,
  TURN_DISCIPLINE,
} from "./plugin-protocols.js";

export const WORKER_PROTOCOL_CLAUSES = {
  cardOwnerRules: CARD_OWNER_RULES,
  neverSeed: NEVER_SEED,
  cliEquivalents: CLI_EQUIVALENTS,
  reconProtocol: RECON_PROTOCOL,
  draftProtocol: DRAFT_PROTOCOL,
  turnDiscipline: TURN_DISCIPLINE,
  commitStyle: COMMIT_STYLE,
  interfacePick: INTERFACE_PICK,
  doneProtocol: DONE_PROTOCOL,
  splitProtocol: SPLIT_PROTOCOL,
} as const;

export type WorkerProtocolClauses = typeof WORKER_PROTOCOL_CLAUSES;
