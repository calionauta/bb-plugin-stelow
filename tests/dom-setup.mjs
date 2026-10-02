/**
 * The DOM the rendered UI audit runs against.
 *
 * happy-dom, chosen by measurement in the P2 spike (`dom-spike/bench.mjs`) over
 * jsdom and linkedom:
 *
 *   library     setup    render/iter   getByRole   click   axe   RSS
 *   happy-dom   625ms    3.7ms         ok          ok      ok    124MB
 *   jsdom      1160ms    4.3ms         ok          ok      ok    181MB
 *   linkedom    149ms    -             -           -       -     (cannot render
 *                                                                 React: no
 *                                                                 location)
 *
 * jsdom works and is smaller on disk (8.7MB vs 19MB); happy-dom is ~2x faster to
 * set up and uses ~46% less memory, and the render cost is React's, not the
 * library's — so the memory and setup wins are the ones that are real.
 *
 * globals are defined, never assigned: Node 21+ ships a read-only `navigator`
 * and `globalThis.navigator = ...` throws.
 */
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

for (const name of [
  "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "CustomEvent", "MutationObserver", "DOMParser",
  "getComputedStyle", "SVGElement", "CSSStyleDeclaration", "DocumentFragment",
]) {
  if (window[name] !== undefined) define(name, window[name]);
}
define("window", window);
define("requestAnimationFrame", (callback) => setTimeout(() => callback(Date.now()), 0));
define("cancelAnimationFrame", (handle) => clearTimeout(handle));

// React 19 reads these to decide between concurrent and legacy rendering.
define("IS_REACT_ACT_ENVIRONMENT", true);
