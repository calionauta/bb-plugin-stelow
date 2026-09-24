# Native BB Workflows integration

Stelow uses the host's built-in `workflows` plugin as its native execution backend for recipes that are safe to run through the durable Workflows substrate. This is a real runtime integration: eligible recipes are submitted through `bb workflows run`, their `runId` is persisted in the Stelow execution ledger, and status, cancellation, receipts, and artifacts are reconciled back into the card.

It is not a universal replacement for every Stelow operation. The execution router chooses the narrowest safe mode for each recipe.

## Why some work stays sequential

`scope-batch` is the main example. Its recipe declares `write_policy: workspace`, dependency partitioning, file claims, parent verification, and gap escalation. Those operations need a shared workspace and a parent-owned merge. A generic workflow fan-out cannot by itself prove that two workers will not edit the same files or that the parent result remains consistent after a worker fails.

The current route is therefore:

```text
scope-batch → coordinator-sequential
```

The design permits future parallelism, but real fan-out stays disabled until the host has proven:

- file-level claims and conflict refusal;
- isolated or otherwise safe writes;
- deterministic cleanup after success, failure, and cancellation;
- retry without duplicate side effects;
- parent merge and post-merge verification;
- cancellation of a whole batch;
- conflict behavior between independent scopes.

The current BB Workflows capabilities help with durable runs, pipelines, status, resume, cancellation, structured output, and controlled fan-out. They do not silently waive the workspace-safety contract.

## What the host does automatically

At runtime Stelow probes the built-in plugin and uses the native path when the recipe is eligible. If the plugin is unavailable or a capability is missing, the route fails soft to the explicit `coordinator-sequential` fallback. The About tab and first-visit setup identify the dependency, explain the benefit, and offer an explicit install or enable action.

The dependency is intentionally a host runtime capability rather than a hidden package dependency. On a normal BB installation `workflows` is built in; the Stelow package does not install or enable another plugin silently during its own installation.

## Future direction

The next safe step is not to remove the sequential guard. It is to add a host-level claims and isolation contract, then promote only the scope classes that satisfy that contract to native fan-out. The execution ledger, artifacts, and parent verification already provide the evidence boundary needed for that migration.
