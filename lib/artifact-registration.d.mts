export declare type RegistrationCopy = { from: string; to: string; relative: string };
export declare type RegistrationPlan = {
  copies: RegistrationCopy[];
  unresolved: string[];
};
/** The canonical home of a staged artifact, or null when the root is not staging. */
export declare function canonicalArtifactPath(
  artifactRoot: string,
  relative: string,
): string | null;
/** The copies one validated run implies, in recipe order. */
export declare function registrationPlan(
  artifactRoot: string,
  paths: readonly string[],
): RegistrationPlan;
/** `{ runId, outputs }` — the receipt that means "this run is registered". */
export declare function registrationReceipt(runId: string, paths: readonly string[]): string;
/** `<artifactRoot>/.registered.json`. */
export declare function registrationReceiptPath(artifactRoot: string): string | null;
