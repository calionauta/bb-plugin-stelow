/**
 * Disclosure affordance, and the sites this card migrated off the legacy size.
 *
 * Split out of `card-design-tokens.test.mjs`, which the file budget caught at
 * 448 lines. The concern is distinct anyway: that file is about the SCALE — the
 * named steps and their sizes. This is about two things that ride on it. A
 * hand-written `<summary>` that drops what `SUMMARY_BASE` guarantees, and a site
 * that was migrated and could quietly go back.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeLinesOf as stripComments } from "./helpers/source-code.mjs";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

function componentFiles() {
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  return walk(join(repoRoot, "components")).filter((file) => file.endsWith(".tsx"));
}

const ALL = componentFiles().map((file) => file.replace(`${repoRoot}/`, ""));
const codeLinesOf = (relative) => stripComments(read(relative));

const SUMMARY_REQUIRED = ["cursor-pointer", "list-none", "focus-visible:outline", "marker:hidden"];

/**
 * Every `<summary className={CONST}>` resolved through what CONST actually holds.
 *
 * A summary that names a constant is only as correct as that constant, so the
 * value is resolved rather than the identifier trusted. An earlier version of
 * this guard skipped `className={CONST}` lines entirely, which let a
 * hand-written constant through — the same blind spot one level down.
 *
 * Two declaration shapes are read: a template literal and an array joined into
 * one. `SUMMARY_BASE` is the second, so a backtick-only reader cannot see it and
 * reports a correct family as missing everything — which is exactly what this
 * guard did on its first run.
 */
function summariesViaConstant() {
  const disclosureSource = readFileSync(join(repoRoot, "components", "disclosure.tsx"), "utf8");
  const constantValues = new Map([
    ...[...disclosureSource.matchAll(/export const (\w+)\s*=\s*`([^`]*)`/g)].map((m) => [m[1], m[2]]),
    ...[...disclosureSource.matchAll(/export const (\w+)\s*=\s*\[([\s\S]*?)\]\.join\(" "\)/g)]
      .map((m) => [m[1], [...m[2].matchAll(/"([^"]*)"/g)].map((s) => s[1]).join(" ")]),
  ]);
  return ALL
    .filter((file) => file !== "components/disclosure.tsx")
    .flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const local = new Map([...source.matchAll(/^const (\w+)\s*=\s*`([^`]*)`/gm)].map((m) => [m[1], m[2]]));
      return codeLinesOf(file)
        .filter((line) => /<summary/.test(line) && /className=\{(\w+)\}/.test(line))
        .map((line) => {
          const name = line.match(/className=\{(\w+)\}/)[1];
          const value = local.get(name) ?? constantValues.get(name) ?? "";
          const resolved = value.replace(/\$\{(SUMMARY_[A-Z]+)\}/g, (_, key) => constantValues.get(key) ?? "");
          const missing = SUMMARY_REQUIRED.filter((token) => !resolved.includes(token));
          return missing.length > 0 ? `${file}: <summary> via ${name} is missing ${missing.join(", ")}` : null;
        })
        .filter(Boolean);
    });
}

test("a hand-written <summary> keeps the tokens SUMMARY_BASE guarantees", () => {
  const handWritten = ALL
    .filter((file) => file !== "components/disclosure.tsx")
    .flatMap((file) => codeLinesOf(file)
      .filter((line) => /<summary/.test(line) && /className=/.test(line))
      // A summary that composes a named family (SUMMARY_ROW / SUMMARY_LINK) is
      // already correct; only one spelling its own classes needs the check.
      // Composing a named family OR a constant that itself composes one is
      // correct; only a summary that spells its own classes needs the check. A
      // `className={SOME_CONST}` line says nothing on its own, so it is
      // resolved through the constants file rather than guessed at.
      .filter((line) => !/SUMMARY_(ROW|LINK|BASE)/.test(line))
      .filter((line) => !/className=\{[A-Z_]+\}/.test(line))
      .map((line) => {
        const missing = SUMMARY_REQUIRED.filter((token) => !line.includes(token));
        return missing.length > 0 ? `${file}: <summary> is missing ${missing.join(", ")}` : null;
      })
      .filter(Boolean));

  const composedElsewhere = summariesViaConstant();
  // No deferrals. There was one — `build-publication.tsx`, inherited at the base
  // commit, whose 900-character line hid a hand-written summary — but the whole
  // Advanced Git disclosure was refactored away upstream, taking the violation
  // with it. The empty set stays because it is the shape a future deferral
  // takes: named, counted, and never a file nobody is working on.
  const DEFERRED = new Set();
  const regressions = [...handWritten, ...composedElsewhere]
    .filter((entry) => ![...DEFERRED].some((file) => entry.startsWith(file)));
  const deferred = [...handWritten, ...composedElsewhere]
    .filter((entry) => [...DEFERRED].some((file) => entry.startsWith(file)));

  assert.deepEqual(
    regressions,
    [],
    "a summary must keep cursor-pointer, list-none, focus-visible:outline and marker:hidden — "
    + "compose SUMMARY_BASE (or a named family) instead, so keyboard focus stays visible "
    + "(WCAG 2.4.7) and the marker stays hidden everywhere",
  );
  assert.ok(
    deferred.length <= DEFERRED.size,
    `deferred, each named here so it cannot be forgotten: ${deferred.join("; ") || "none"}`,
  );
});
