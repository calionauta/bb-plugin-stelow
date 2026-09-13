export declare function stagePlaybookRelPath(stage: string): string | null;
export declare function knownStages(): string[];
export declare type PlaybookEntry = { label: string; path: string; missing: boolean };
export declare function playbookEntries(
  options: {
    kind: string;
    stage?: string | null;
    statePath?: string | null;
    transitionsPath?: string | null;
    skillsDir: string;
    strategySkill?: string | null;
    exploreSkill?: string | null;
    researchIndexPath?: string | null;
    exploreArtifactPath?: string | null;
  },
  exists: (path: string) => boolean,
): PlaybookEntry[];
export declare function renderPlaybook(entries: PlaybookEntry[]): string;
