import { exploreArtifactFile } from "../../lib/research-artifacts.mjs";
import {
  RESEARCH_STRATEGIES,
  researchStrategyById,
} from "../../lib/research-strategies.mjs";
import { TECHNIQUE_CATALOG, techniqueById } from "../../lib/stage-catalog.mjs";

export type ResearchStrategyEntry = (typeof RESEARCH_STRATEGIES)[number];
export type TechniqueEntry = (typeof TECHNIQUE_CATALOG)[number];

export type ExploreTechnique = {
  skill: string;
  artifactFile: string;
};

/**
 * The index surface the two standalone tracks expose: which strategies and
 * techniques exist, what each one is called, and which skill backs it.
 *
 * Every lookup reads the catalogs at call time on purpose. The host merges
 * upstream strategy contracts into `RESEARCH_STRATEGIES` during startup
 * (splice in place, so imported bindings stay live); a snapshot taken when
 * this factory runs would pin the embedded fallback and quietly ignore the
 * synced registry.
 */
export function createTrackCapabilities() {
  return {
    researchStrategy: (id: string) => researchStrategyById(id),
    exploreStage: (id: string) => techniqueById(id),
    researchIds: (): string[] => RESEARCH_STRATEGIES.map((entry) => entry.id),
    exploreIds: (): string[] => TECHNIQUE_CATALOG.map((entry) => entry.id),
    researchStrategySkill: (id: string): string | null =>
      researchStrategyById(id)?.skill ?? null,
    exploreTechnique: (id: string): ExploreTechnique | null => {
      const technique = techniqueById(id);
      return technique
        ? { skill: technique.skill, artifactFile: exploreArtifactFile(technique.id) }
        : null;
    },
  };
}

export type TrackCapabilities = ReturnType<typeof createTrackCapabilities>;
