import assert from "node:assert/strict";
import { auditReceiptReadiness } from "../lib/audit-receipt.mjs";

const receipt = `# Delivery audit

## Acceptance criteria

- The requested result is present and each criterion was checked against the implementation.

## Verification

- I reviewed the changed behavior and the scope record after completing the work.

## Tests

- \`npm test\` — passed.
- \`npm run typecheck\` — passed.

## Git evidence

- Branch: feature/audit-receipt; working tree and commit state recorded at completion.
`;

assert.equal(auditReceiptReadiness(receipt, [{ stage: "audit", path: ".stelow/x/audit.md" }]).ready, true, "a registered receipt with every evidence section is ready");
assert.match(auditReceiptReadiness("too short", []).error, /substantive audit\.md/, "thin receipts are refused");
assert.match(auditReceiptReadiness(receipt.replace("## Tests", "## Checks"), [{ stage: "audit", path: ".stelow/x/audit.md" }]).error, /tests/, "test evidence is mandatory");
assert.match(auditReceiptReadiness(receipt, [{ stage: "planning", path: ".stelow/x/audit.md" }]).error, /Register audit\.md/, "the receipt must be visible on the audit trail");

console.log("audit receipt test ok: Build completion needs a visible, structured delivery receipt");
