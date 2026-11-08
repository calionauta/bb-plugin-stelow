export declare const FLOW_DIAGRAM_KIND: string;

export declare const FLOW_DIAGRAM_DIRECTION: string;

/** The Mermaid link for one transition verb, arrow included (`-->`, `-.->`). */
export declare function verbArrow(verb: unknown): string;

/** The flow diagram as Mermaid text, derived from parsed transition rows. */
export declare function flowDiagramMermaid(input?: { transitions: unknown; title?: string }): string;
