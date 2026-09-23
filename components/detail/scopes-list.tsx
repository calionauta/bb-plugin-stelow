import { useState } from "react";
import { DisclosureChevron } from "../disclosure";
import { Pill } from "../dashboard/build-status-pills";
import { isDoneStatus } from "../../lib/trackables.mjs";
import { orderScopes, statusRank } from "../../lib/scope-order.mjs";

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

export type ScopeListScope = {
  id: string;
  name: string;
  type?: string | null;
  source?: string | null;
  gap?: string | null;
  status: string;
  tasks: ScopeListTask[];
  conditions?: Array<{ type: string; message: string }> | null;
  record?: { verified?: boolean | null; filesCount?: number | null; commandsCount?: number | null } | null;
  claimed?: boolean | null;
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
  if (tasks.length === 0) return <p className="text-xs text-muted-foreground">No tasks tracked.</p>;
  const tasksSorted = [...tasks].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  return (
    <>
      {tasksSorted.map((task) => (
        <div key={task.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 font-mono">{fns.statusGlyph(task.status)}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={statusRank(task.status) === 4 ? "line-through text-muted-foreground" : ""}>{task.name}</span>
              <span className="text-xs text-muted-foreground">({fns.statusLabel(task.status)})</span>
              {task.source ? <Pill>{task.source}</Pill> : null}
            </div>
            {task.note ? <div className="text-xs text-muted-foreground">{task.note}</div> : null}
            {task.conditions && task.conditions.length > 0 ? task.conditions.map((condition) => <p key={condition.type} className="text-[11px] text-amber-700 dark:text-amber-300" role="note">{condition.message}</p>) : null}
            {(task.blockedBy?.length || task.dependsOn?.length) ? (
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                {task.dependsOn?.map((dep) => <span key={dep} className="rounded-md border border-dashed px-1.5 py-0.5">after {dep}</span>)}
                {task.blockedBy?.map((dep) => <span key={dep} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5">blocked by {dep}</span>)}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}

// Below the summary: conditions, record/claim evidence, acceptance
// criteria, and the task list.
function ScopeBody({ scope, fns }: { scope: ScopeListScope; fns: ScopeStatusFns }) {
  return (
    <>
      {scope.conditions && scope.conditions.length > 0 ? (
        <div className="mt-2 space-y-1">
          {scope.conditions.map((condition) => <p key={condition.type} className="text-[11px] text-amber-700 dark:text-amber-300" role="note">{condition.message}</p>)}
        </div>
      ) : null}
      {scope.record || scope.claimed !== null ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {scope.record ? (scope.record.verified === true ? "✓ verified" : scope.record.verified === false ? "⚠ record unverified" : "record without verdict") : null}
          {scope.record && typeof scope.record.filesCount === "number" ? ` · ${scope.record.filesCount} files` : null}
          {scope.record && typeof scope.record.commandsCount === "number" ? ` · ${scope.record.commandsCount} commands` : null}
          {scope.claimed === true ? " · ● files claimed" : scope.claimed === false && scope.status === "in-progress" ? " · ○ no live file claim" : null}
        </p>
      ) : null}
      {scope.contract && scope.contract.acceptanceCriteria.length > 0 ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[11px] font-medium text-primary hover:underline">Acceptance criteria ({scope.contract.acceptanceCriteria.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {scope.contract.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}
          </ul>
        </details>
      ) : null}
      <div className="mt-3 space-y-1 border-l pl-3">
        <ScopeTasks tasks={scope.tasks} fns={fns} />
      </div>
    </>
  );
}

function ScopeRow({ scope, isOpen, onToggle, waitingOn, byId, fns }: {
  scope: ScopeListScope;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  waitingOn: Map<string, string[]>;
  byId: Map<string, ScopeListScope>;
  fns: ScopeStatusFns;
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
      <ScopeBody scope={scope} fns={fns} />
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
  const toggle = (id: string, next: boolean) => {
    setOpenIds((prev) => { const updated = new Set(prev); if (next) updated.add(id); else updated.delete(id); return updated; });
  };
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scopes ({scopes.length})</h3>
      {scopes.length > 1 ? <p className="text-[11px] text-muted-foreground">Ordered by dependency — ⛔ waits on unfinished work.</p> : null}
      {ordered.map((scope) => (
        <ScopeRow
          key={scope.id}
          scope={scope}
          isOpen={openIds.has(scope.id)}
          onToggle={(next) => toggle(scope.id, next)}
          waitingOn={waitingOn}
          byId={byId}
          fns={{ statusTone, statusGlyph, statusLabel }}
        />
      ))}
    </section>
  );
}
