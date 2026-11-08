export declare function stagePlaybookRelPath(stage: string): string | null;
export declare function knownStages(): string[];
export declare type PlaybookEntry = { label: string; path: string; missing: boolean };
export declare function playbookEntries(
  options: {
    kind: string;
    stage?: string | null;
    /** The card's state dir; every fixed-name file in it is named from it. */
    stateDir?: string | null;
    /** The workspace root, for host files outside the state dir (stelow.json). */
    workspaceRoot?: string | null;
    statePath?: string | null;
    transitionsPath?: string | null;
    skillsDir: string;
    strategySkill?: string | null;
    exploreSkill?: string | null;
    researchIndexPath?: string | null;
    exploreArtifactPath?: string | null;
    /**
     * The current run's artifact root and the outputs its recipe declares,
     * relative to that root. Both together or neither: a root with no declared
     * outputs still names the directory the stage writes into.
     */
    run?: {
      artifactRoot: string | null;
      /** Recipe-declared outputs, relative to the root. */
      outputs: string[];
      /** Files actually present in the run dir, relative to the root. */
      present?: string[];
    } | null;
  },
  exists: (path: string) => boolean,
): PlaybookEntry[];
export declare function renderPlaybook(entries: PlaybookEntry[]): string;
