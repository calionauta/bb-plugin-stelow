import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import axe from "axe-core";

// The exploration knob's progressive disclosure, rendered — not grepped.
// The choice cards name counts; this names what each count explores. It
// starts closed (history does not push the page down), opens on its own
// toggle, and shows one row per count plus the five archetype philosophies.
import { ExplorationArchetypes } from "../components/creation/exploration-archetypes.tsx";

const tree = render(h(ExplorationArchetypes));
assert.ok(screen.getByText("Which archetypes do these counts explore?"), "the toggle names its job");
assert.equal(tree.container.querySelector("details")?.open, false, "closed by default");

fireEvent.click(screen.getByText("Which archetypes do these counts explore?"));
assert.equal(tree.container.querySelector("details")?.open, true, "opens on its own toggle");
assert.ok(screen.getByText(/model picks the best fit/), "count 1 stays LLM-chosen, said out loud");
assert.ok(screen.getByText(/Conventional Standard/), "archetype philosophies render");

const real = await axe.run(tree.container, {
  resultTypes: ["violations"],
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
});
assert.equal(real.violations.length, 0, `must stay clean; got ${real.violations.map((v) => v.id).join(", ")}`);
cleanup();

console.log("exploration-archetypes-ui: ok");
