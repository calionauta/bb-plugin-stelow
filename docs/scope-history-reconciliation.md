# Maintainer runbook: reconcile a versioned technical plan

Scope Map approval compares the exact bytes read from the current draft and
state mirror before publishing them. Formatting differences are harmless;
an intervening edit still refuses approval. Re-read the current map and retry
`bb stelow scope-approve --card <card-id>` after resolving the edit.

Technical plan replacement is a separate operation. A newer `spec-tech` file
cannot automatically replace nonempty scope tracking. Both execution advance
and its dry-run report this refusal before the stage changes. Card details
diagnose tracking against the latest plan's version and any recorded hash;
scopes from an earlier plan do not certify that the newer plan was synced.

## Preview and apply

Publish a new versioned technical plan, preserve the previous plan, and obtain
the required independent review. Keep existing task names and IDs for work
whose meaning is unchanged. Give additional work new task IDs. Completed
scopes cannot silently receive expanded definitions or new work.

From the owning workflow thread, preview the explicit reconciliation:

```sh
bb stelow sync-scopes --preserve-history --dry-run --json
```

An unfinished task in a retired scope must have an explicit destination:

```sh
bb stelow sync-scopes --preserve-history \
  --move-task scope-3:3.4:scope-1 --dry-run --json
```

Inspect the preview and resolve every refusal. Apply the same command without
`--dry-run` at a coordinated writer checkpoint. The host parses the plan in
temporary storage, uses the SDK file writer with compare-and-swap, reserves
the tracking and target plan files, and saves the exact prior tracking bytes
in `.stelow-history/` with mode `0600` before committing. A competing tracker
write or a target-plan edit detected before publication refuses the commit.
Reservations coordinate participating writers; they do not authorize
uncoordinated external edits or multi-host maintenance. If a target-plan edit
crosses the tracker publication boundary, a post-write check reports
“Migration committed, but the target spec changed.” Tracking remains committed
with the originally reviewed hash; the host does not roll back over another
writer. Inspect the backup, tracker and current plan, then publish a new plan
version and preview reconciliation again before proceeding.

The result reports the backup path and reconciliation summary. The workflow
also retains its entire old scope array in append-only `scopeHistory` entries.
Unrelated workflows remain unchanged. Existing operational records, clocks,
task results and discovered tasks survive; newly planned work starts pending.
Historical test evidence remains historical and does not accept expanded work.

A repeat against the same version is unchanged. An edited active plan with a
recorded different hash is refused: publish another version instead. If lock
release fails after commit, the error explicitly reports that the migration
committed. Inspect the persisted tracker and lock owner before recovery; do
not force-unlock or replay an assumed failed migration.

The host must provide its SDK file writer for application. CLI help and
`bb stelow schema sync-scopes` expose the host's preservation flags. The
vendored standalone helper does not implement this host transaction.
