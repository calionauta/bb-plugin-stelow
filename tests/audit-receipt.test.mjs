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

## Execution context

- Checkout: /workspace/project. I did not write outside this checkout.
`;

const verified = { gitRoot: "/workspace/project", headSha: "0123456789abcdef0123456789abcdef01234567" };
const verifiedReceipt = receipt.replace("Branch: feature/audit-receipt;", `Git root: ${verified.gitRoot}.\n- HEAD: ${verified.headSha}.\n- Branch: feature/audit-receipt;`);
assert.equal(auditReceiptReadiness(verifiedReceipt, [{ stage: "audit", path: ".stelow/x/audit.md" }], "/workspace/project", verified).ready, true, "a registered receipt with the host-verified checkout identity is ready");
assert.match(auditReceiptReadiness("too short", []).error, /substantive audit\.md/, "thin receipts are refused");
assert.match(auditReceiptReadiness(receipt.replace("## Tests", "## Checks"), [{ stage: "audit", path: ".stelow/x/audit.md" }]).error, /tests/, "test evidence is mandatory");
assert.match(auditReceiptReadiness(receipt, [{ stage: "planning", path: ".stelow/x/audit.md" }]).error, /Register audit\.md/, "the receipt must be visible on the audit trail");
assert.match(auditReceiptReadiness(receipt, [{ stage: "audit", path: ".stelow/x/audit.md" }], "/another/checkout").error, /exact execution checkout/, "the receipt cannot silently attest the wrong checkout");
assert.match(auditReceiptReadiness(receipt, [{ stage: "audit", path: ".stelow/x/audit.md" }], "/workspace/project", verified).error, /Git root/, "the host refuses a receipt that omits the current Git root");
assert.match(auditReceiptReadiness(verifiedReceipt, [{ stage: "audit", path: ".stelow/x/audit.md" }], "/workspace/project", { ...verified, headSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }).error, /verified HEAD/, "a receipt cannot attest a stale commit");

console.log("audit receipt test ok: Build completion needs a visible, structured delivery receipt");
