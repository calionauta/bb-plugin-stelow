import {
  PresetManagerBandRouting,
  PresetManagerDelegatedWork,
} from "./preset-manager-band-routing";
import { PresetManagerRoutingSection } from "./preset-manager-routing-section";
import type { PresetManagerRoutingProps } from "./preset-manager-routing-props";

const BAND_ROUTING = {
  title: "Worker preset per track",
  hint: "phase routing",
  explanation: "Each track runs on its own preset. Build phases can each override it; "
    + "the worker switches automatically at phase boundaries. Unset rows fall back to "
    + "the card preset (or default).",
};

const DELEGATED_WORK = {
  title: "Delegated work",
  hint: "subagent tiers",
  explanation: "Work the host delegates to subthreads. Empty selects revert to the band "
    + "preset — except Review, where empty means no reviewer.",
};

/**
 * The two routing sections, split out of `PresetManagerDialog` so the shell
 * can gain the delete confirmation without growing a function that already
 * sits at its recorded ceiling. One call site owns both sections, so they
 * cannot disagree about which props they take.
 */
export function PresetManagerRoutingSections({ routing }: { routing: PresetManagerRoutingProps }) {
  return (
    <>
      <PresetManagerRoutingSection {...BAND_ROUTING} {...routing}>
        <PresetManagerBandRouting {...routing} />
      </PresetManagerRoutingSection>
      <PresetManagerRoutingSection {...DELEGATED_WORK} {...routing}>
        <PresetManagerDelegatedWork {...routing} />
      </PresetManagerRoutingSection>
    </>
  );
}
