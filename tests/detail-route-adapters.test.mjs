import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const adapters = readFileSync(new URL("../components/detail/card-detail-route.tsx", import.meta.url), "utf8");
const rendering = readFileSync(new URL("../components/app-support/panel-rendering.tsx", import.meta.url), "utf8");
const panelRoute = readFileSync(new URL("../components/app-support/panel-route.tsx", import.meta.url), "utf8");

assert.match(adapters, /export function StelowCardDetail\(/, "track-prefixed cards own the detail adapter");
assert.match(adapters, /export function BareCardRoute\(/, "bare cards keep a live kind-resolution adapter");
assert.match(adapters, /export function CardDrawerAdapter\(/, "thread-panel cards use the drawer adapter");
assert.match(adapters, /setKind\(found \? found\.kind : "build"\)/, "bare cards fail closed to the build track");
assert.match(adapters, /rpc\.call\("cardByWorkerThread", \{ threadId \}\)/, "the drawer resolves palette thread context");
assert.match(adapters, /onOpenRecoveryAudit=\{/, "detail routes preserve recovery-audit navigation");
assert.match(rendering, /import \{ BareCardRoute, StelowCardDetail, INTENT_LABEL \}/, "the renderer owns card adapter imports");
assert.match(panelRoute, /renderCard=\{\(route\) => renderCardRoute\(/, "the panel route keeps the adapter boundary");
assert.match(
  app,
  /app\.slots\.threadPanelAction\(\{[\s\S]*id: "stelow-card-detail"[\s\S]*component: StelowCardDrawer[\s\S]*\}\)/,
  "the thread panel slot keeps the extracted drawer wired",
);
assert.doesNotMatch(app, /function StelowCardDetail\(|function BareCardRoute\(|function CardDrawerAdapter\(/, "no detail adapter remains local to the shell");

console.log("detail route adapters test ok: detail, bare-card, drawer, and slot wiring are extracted");
