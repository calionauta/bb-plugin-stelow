import { formatDuration } from "../../lib/card-metrics.mjs";
import { scopeElapsedMs } from "../../lib/scope-elapsed.mjs";
import { useState } from "react";
import { DisclosureChevron, SUMMARY_LINK } from "../disclosure";
import { Pill } from "../dashboard/build-status-pills";
import { isDoneStatus } from "../../lib/trackables.mjs";
import { scopeClaimLines, type ScopeClaimTone } from "../../lib/lock-blocked.mjs";
import { orderScopes, statusRank } from "../../lib/scope-order.mjs";
import { conditionSpread, groupConditionsByType, isSharedCondition } from "../../lib/scope-conditions-grouping.mjs";
import { TEXT_META, TEXT_SECTION } from "../../lib/design-tokens";

// Scope list: dependency-ordered scopes with waiting markers, per-task
// tracking, record/claim evidence, and acceptance criteria. Ordering and
// rank math live in lib (tested); status presentation arrives as label
// functions so the list never pastes its own pills.

export type ScopeListTask = {
  id: string;
  name: string;
  status: string;
  source?: string | null;
  note?: string | null;
  conditions?: Array<{ type: string; message: string }> | null;
  blockedBy?: string[] | null;
  dependsOn?: string[] | null;
};

export type ScopeBlockedFile = { file: string; heldBy: string; expiresAt: number };

/**
 * A condition is a fault the reader has to act on, so it is named once here
 * rather than re-spelled at each site. The amber tone is the card's existing
 * "needs a decision" colour, not a new one.
 */
const CONDITION_TEXT = `${TEXT_META} text-amber-700 dark:text-amber-300`;
const DEP_PILL = "rounded-md border border-dashed px-1.5 py-0.5 text-muted-foreground";
const BLOCKED_PILL = "rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 "
  + "text-amber-700 dark:text-amber-300";

export type ScopeListScope = {
  id: string;
  name: string;
  type?: string | null;
  source?: string | null;
  gap?: string | null;
  status: string;
  startedAt?: string | null;
  record?: { completedAt?: string | null; verified?: boolean | null; filesCount?: number | null; commandsCount?: number | null } | null;
  tasks: ScopeListTask[];
  conditions?: Array<{ type: string; message: string }> | null;
  claimed?: boolean | null;
  claimFiles?: string[];
  blockedFiles?: ScopeBlockedFile[];
  contract?: { acceptanceCriteria: string[] } | null;
  blockedBy?: string[] | null;
  dependsOn?: string[] | null;
};

export type ScopeStatusFns = {
  statusTone: (status: string) => string;
  statusGlyph: (status: string) => string;
  statusLabel: (status: string) => string;
};

function ScopeTasks({ tasks, fns }: { tasks: ScopeListTask[]; fns: ScopeStatusFns }) {
  if (tasks.length === 0) {
    return <p className={TEXT_META}>No tasks tracked for this scope.</p>;
  }
  const tasksSorted = [...tasks].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  const done = tasksSorted.filter((task) => statusRank(task.status) === 4).length;
  return (
    <div className="space-y-2">
      <h5 className={TEXT_SECTION}>Tasks ({done}/{tasksSorted.length})</h5>
      <ul className="space-y-1.5">
        {tasksSorted.map((task) => (
          <li key={task.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 font-mono" aria-hidden>{fns.statusGlyph(task.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={statusRank(task.status) === 4 ? "line-through text-muted-foreground" : ""}>{task.name}</span>
                <span className={TEXT_META}>({fns.statusLabel(task.status)})</span>
                {task.source ? <Pill>{task.source}</Pill> : null}
              </div>
              {task.note ? <div className={TEXT_META}>{task.note}</div> : null}
              {task.conditions && task.conditions.length > 0
                ? task.conditions.map((condition) => (
                  <p key={condition.type} className={CONDITION_TEXT} role="note">{condition.message}</p>
                ))
                : null}
              {(task.blockedBy?.length || task.dependsOn?.length) ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {task.dependsOn?.map((dep) => (
                    <span key={dep} className={DEP_PILL}>after {dep}</span>
                  ))}
                  {task.blockedBy?.map((dep) => (
                    <span key={dep} className={BLOCKED_PILL}>blocked by {dep}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Which line needs a decision, and which is only history. The judgement lives
 * in lib/lock-blocked.mjs (`scopeClaimLines`); this maps its tone to the card's
 * existing vocabulary, so a fault can never ship in the muted grey that
 * "files claimed" and "no live file claim" once shared.
 */
const CLAIM_TONE_CLASS: Record<ScopeClaimTone, string> = {
  held: "text-muted-foreground",
  blocked: "text-amber-700 dark:text-amber-300",
  missing: "text-amber-700 dark:text-amber-300",
};
const CLAIM_TONE_GLYPH: Record<ScopeClaimTone, string> = { held: "●", blocked: "⛔", missing: "○" };

/**
 * The file claims, as a reader would ask for them: which files, and who holds
 * the ones this scope cannot have.
 */
function ScopeClaimLine({ scope }: { scope: ScopeListScope }) {
  const rows = scopeClaimLines({
    claimFiles: scope.claimFiles,
    blockedFiles: scope.blockedFiles,
    claimed: scope.claimed,
    status: scope.status,
  });
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row) => (
        <p
          key={`${row.tone}:${row.text}`}
          className={`mt-1 text-[11px] ${CLAIM_TONE_CLASS[row.tone]}`}
          title={row.title}
          role={row.tone === "held" ? undefined : "note"}
        >
          <span aria-hidden>{CLAIM_TONE_GLYPH[row.tone]} </span>
          {row.text}
        </p>
      ))}
    </>
  );
}

// Below the summary: conditions, record/claim evidence, acceptance
// criteria, and the task list. Conditions are NOT all here — a condition shared
// by several scopes used to print once per scope, so shared types moved up to
// one card-level block (ScopeConditions) that names the scopes it applies to.
function ScopeBody({ scope, fns, sharedTypes }: {
  scope: ScopeListScope;
  fns: ScopeStatusFns;
  sharedTypes: Set<string>;
}) {
  const ownConditions = (scope.conditions ?? []).filter(
    (condition) => !sharedTypes.has(condition.type),
  );
  return (
    <>
      {ownConditions.length > 0 ? (
        <div className="mt-2 space-y-1">
          {ownConditions.map((condition) => (
            <p key={condition.type} className={CONDITION_TEXT} role="note">{condition.message}</p>
          ))}
        </div>
      ) : null}
      <ScopeClaimLine scope={scope} />
      {scope.record ? (
        <p className={`mt-2 ${TEXT_META}`}>
          {scope.record.verified === true ? "✓ verified" : scope.record.verified === false ? "⚠ record unverified" : "record without verdict"}
          {typeof scope.record.filesCount === "number" ? ` · ${scope.record.filesCount} files` : null}
          {typeof scope.record.commandsCount === "number" ? ` · ${scope.record.commandsCount} commands` : null}
        </p>
      ) : null}
      {scope.contract && scope.contract.acceptanceCriteria.length > 0 ? (
        <details className="mt-2">
          <summary className={SUMMARY_LINK}>Acceptance criteria ({scope.contract.acceptanceCriteria.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {scope.contract.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}
          </ul>
        </details>
      ) : null}
      {/* Tasks lead the body: they are what the scope was for, and they were
          last — under three evidence lines — so a scope with real work in it
          looked identical to one with none. */}
      <div className="mt-3">
        <ScopeTasks tasks={scope.tasks} fns={fns} />
      </div>
    </>
  );
}

/**
 * Condition types that more than one scope carries, decided once per list.
 *
 * A shared type is said once for the card, so repeating it inside each scope
 * would be the fourteen-line wall this replaces. A type only one scope carries
 * stays in that scope, because a single-scope condition reads better as a
 * sentence about that scope. Computed per render and passed down, so two lists
 * on one page cannot share an answer.
 */
function sharedConditionTypesFor(scopes: ScopeListScope[]): Set<string> {
  return new Set(groupConditionsByType(scopes).filter(isSharedCondition).map((group) => group.type));
}

/**
 * The conditions the card has in common, one row per type, naming the scopes
 * they apply to.
 *
 * The count is the point. Per-scope rendering made "one scope is missing a
 * record" and "every scope is missing a record" look identical, when the first
 * is a task and the second is a problem with how the card was closed.
 */
function ScopeConditions({ scopes }: { scopes: ScopeListScope[] }) {
  const groups = groupConditionsByType(scopes).filter(isSharedCondition);
  if (groups.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Scope conditions">
      <h4 className={TEXT_SECTION}>Shared conditions</h4>
      <p className={TEXT_META}>
        Applies to more than one scope — a fact about how this card closed, not about any single scope.
      </p>
      <ul className="space-y-1.5">
        {groups.map((group) => (
          <li key={group.type} className={`${TEXT_META} text-amber-700 dark:text-amber-300`} role="note">
            <span className="font-medium">{conditionSpread(group)} scopes</span>{" — "}
            {group.message}
            <span className="block text-muted-foreground">
              {group.scopes.length > 6
                ? `${group.scopes.slice(0, 6).join(", ")} and ${group.scopes.length - 6} more`
                : group.scopes.join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScopeRow({ scope, isOpen, onToggle, waitingOn, byId, fns, sharedTypes }: {
  scope: ScopeListScope;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  waitingOn: Map<string, string[]>;
  byId: Map<string, ScopeListScope>;
  fns: ScopeStatusFns;
  sharedTypes: Set<string>;
}) {
  const wait = waitingOn.get(scope.id) ?? [];
  const blockedNow = wait.length > 0;
  const finished = (id: string) => isDoneStatus(byId.get(id)?.status ?? "");
  const tasksDone = scope.tasks.filter((task) => statusRank(task.status) === 4).length;
  return (
    <details key={scope.id} open={isOpen} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)} className={`group rounded-md border p-3 ${scope.status === "in-progress" ? "stelow-border-running" : blockedNow ? "border-amber-500/50" : "border-border"}`}>
      <summary className="cursor-pointer list-none space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <DisclosureChevron open={isOpen} />
          <span className="font-mono text-xs text-muted-foreground">{scope.id}</span>
          <span className="font-medium">{scope.name}</span>
          {scope.type ? <Pill>{scope.type}</Pill> : null}
          {scope.source === "audit-gap" ? <Pill tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" title={scope.gap ? `Rework for escalated gap: ${scope.gap}` : "Rework scope from an escalated gap"}>↻ rework</Pill> : null}
          <Pill tone={fns.statusTone(scope.status)}><span className="mr-1">{fns.statusGlyph(scope.status)}</span>{fns.statusLabel(scope.status)}</Pill>
          {scope.tasks.length > 0 ? <span className="text-[11px] text-muted-foreground" title={`${tasksDone} of ${scope.tasks.length} tasks done`}>{tasksDone}/{scope.tasks.length} tasks</span> : null}
           {scopeElapsedMs(scope) != null ? <span className="text-[11px] text-muted-foreground">· {formatDuration(scopeElapsedMs(scope) ?? 0)}</span> : null}
          {blockedNow ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" title={wait.join(", ")}>⛔ waiting on {wait.length}</span> : null}
        </div>
        {(scope.blockedBy?.length || scope.dependsOn?.length) ? (
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            {scope.dependsOn?.filter((id) => byId.has(id)).map((dep) => <span key={dep} className={`rounded-md border px-2 py-0.5 ${finished(dep) ? "border-border" : "border-amber-500/40 bg-amber-500/10"}`}>after {byId.get(dep)!.name}</span>)}
            {scope.blockedBy?.filter((id) => byId.has(id)).map((dep) => <span key={dep} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">blocked by {byId.get(dep)!.name}</span>)}
            {scope.dependsOn?.filter((id) => !byId.has(id)).map((dep) => <span key={dep} className="rounded-md border border-dashed px-2 py-0.5">after {dep} (missing)</span>)}
          </div>
        ) : null}
      </summary>
      <ScopeBody scope={scope} fns={fns} sharedTypes={sharedTypes} />
    </details>
  );
}

export function ScopesList({ scopes, statusTone, statusGlyph, statusLabel }: {
  scopes: ScopeListScope[];
  statusTone: (status: string) => string;
  statusGlyph: (status: string) => string;
  statusLabel: (status: string) => string;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(scopes.filter((scope) => scope.status === "in-progress").map((scope) => scope.id)));
  const { ordered, waitingOn } = orderScopes<ScopeListScope>(scopes);
  const byId = new Map(scopes.map((s) => [s.id, s]));
  const sharedTypes = sharedConditionTypesFor(scopes);
  const toggle = (id: string, next: boolean) => {
    setOpenIds((prev) => { const updated = new Set(prev); if (next) updated.add(id); else updated.delete(id); return updated; });
  };
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scopes ({scopes.length})</h3>
      {scopes.length > 1 ? <p className={TEXT_META}>Ordered by dependency — ⛔ waits on unfinished work.</p> : null}
      <ScopeConditions scopes={scopes} />
      {ordered.map((scope) => (
        <ScopeRow
          key={scope.id}
          scope={scope}
          isOpen={openIds.has(scope.id)}
          onToggle={(next) => toggle(scope.id, next)}
          waitingOn={waitingOn}
          byId={byId}
          fns={{ statusTone, statusGlyph, statusLabel }}
          sharedTypes={sharedTypes}
        />
      ))}
    </section>
  );
}
