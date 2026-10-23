/** A stage as the diagram sees it: its node id and the role the outline carries. */
export interface FlowNode {
  id: string;
  stage: string;
  role: "start" | "terminal" | "internal";
}

/** One declared transition: source stage, verb, target stage. */
export interface FlowEdge {
  from: string;
  to: string;
  verb: string;
}

export interface FlowModel {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export declare function stageNodeId(stage: unknown): string;

export declare function buildFlowModel(input?: { transitions: unknown }): FlowModel;
