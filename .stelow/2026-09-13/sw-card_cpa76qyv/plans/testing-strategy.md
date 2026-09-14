# Testing strategy — Inbox filters

Use existing Node tests for lifecycle truth in `tests/inbox-flows.test.mjs`. Extract only a pure predicate/presentation helper if necessary; test its four classifications directly. Run `npm run typecheck` and `npm test` after implementation.
