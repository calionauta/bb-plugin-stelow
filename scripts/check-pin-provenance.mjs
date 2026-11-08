#!/usr/bin/env node
/**
 * Refuse to ship a pin that upstream never released.
 *
 * `scripts/check-upstream-drift.mjs` proves the vendored tree equals the pin;
 * this proves the pin is a commit upstream's own CI and release process stood
 * behind. The rule exists because the plugin pinned a branch tip once
 * (`abc51fb`, from `fix-question-copy-verify`) and the drift gate was perfectly
 * happy: the bytes matched, the ref was worthless.
 *
 * Reads the pin from data/stelow-source.json, asks GitHub whether it is an
 * ancestor of `main`, and exits non-zero when it is not. Unauthenticated calls
 * are enough for a public repository (one request per run); `GITHUB_TOKEN` is
 * used when present because CI and operators usually have one.
 *
 * The compare direction is `main...{pin}`, so the payload describes the PIN
 * against main: `identical` means the pin is main's tip and `behind` means main
 * has moved past it — both prove the pin is on main's history. The reverse
 * direction (`{pin}...main`) describes MAIN instead, where an already-released
 * pin reads as `ahead` and an unreleased one as `behind`; that inversion is
 * what shipped first, and it passed CI only because the pin happened to equal
 * main's tip at the time.
 *
 * Network, so it is a CI step and an operator verb, never part of `npm test`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPinProvenance, describePinProvenance } from "../lib/pin-provenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.STELOW_UPSTREAM_REPO ?? "calionauta/stelow";
const API = (process.env.STELOW_GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");
const BRANCH = process.env.STELOW_UPSTREAM_BRANCH ?? "main";

const source = JSON.parse(readFileSync(join(root, "data", "stelow-source.json"), "utf8"));
const pin = source.commit;
if (typeof pin !== "string" || !/^[0-9a-f]{40}$/.test(pin)) {
  console.error(`pin provenance: data/stelow-source.json carries no 40-hex commit (${String(pin)})`);
  process.exit(1);
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow-pin-check" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

let payload = null;
let failure = null;
try {
  const response = await fetch(`${API}/repos/${REPO}/compare/${BRANCH}...${pin}`, { headers });
  if (response.ok) payload = await response.json();
  else failure = `GitHub returned ${response.status} ${response.statusText}`;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

if (failure) {
  // Fail closed: an unreachable API is not evidence that the pin is good, and
  // this check exists precisely because nobody was looking.
  console.error(`pin provenance: could not reach ${API} (${failure})`);
  process.exit(1);
}

const verdict = classifyPinProvenance(payload, pin);
console.log(describePinProvenance(verdict, source.version));
if (verdict.state !== "released") process.exit(1);
