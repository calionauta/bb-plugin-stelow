export declare type CardMove =
  | { ok: true; move: { type: "status"; status: string } | { type: "phase"; phase: string } }
  | { ok: false; error: string };
export declare function resolveCardMove(kind: unknown, target: unknown): CardMove;
