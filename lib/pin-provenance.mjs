/**
 * Is the pinned upstream commit one the upstream project validated and released?
 *
 * The drift gate proves the vendored tree equals the pin. Nothing proved the pin
 * was a *ref worth pinning*, and the evidence is in this repository's history:
 * the pin once named the tip of an unmerged branch (`abc51fb`, from
 * `fix-question-copy-verify`), so the tree matched a commit no CI and no release
 * ever blessed, and the only thing that noticed was a human reading the file.
 *
 * The decision is a pure function of GitHub's compare payload so it is testable
 * without a network; `scripts/check-pin-provenance.mjs` is the adapter.
 */

/** Compare payload → verdict. `behind` and `identical` mean the pin is on main's history. */
export function classifyPinProvenance(payload, pin) {
  if (!payload || typeof payload !== "object") {
    return {
      state: "unknown",
      detail: `Could not read the upstream comparison for ${pin}.`,
    };
  }
  if (payload.status === "behind" || payload.status === "identical") {
    const behind = Number.isFinite(payload.behind_by) ? payload.behind_by : null;
    return {
      state: "released",
      detail: behind === null || behind === 0
        ? `pin ${pin} is the tip of upstream main`
        : `pin ${pin} is ${behind} commit(s) behind upstream main`,
    };
  }
  if (payload.status === "ahead" || payload.status === "diverged") {
    return {
      state: "unreleased",
      detail: `pin ${pin} is not on upstream main (${payload.status}). Cut a release on main, then dispatch `
        + "the sync with that ref — a branch tip is not a pin a host should follow.",
    };
  }
  return {
    state: "unknown",
    detail: `Unrecognised upstream comparison status: ${String(payload.status)}.`,
  };
}

export function describePinProvenance(verdict, version) {
  const label = version ? `${version} (${verdict.state})` : verdict.state;
  return `pin provenance: ${label} — ${verdict.detail}`;
}
