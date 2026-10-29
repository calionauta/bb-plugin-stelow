export type PreviewShape =
  | { kind: "mermaid"; source: string; prose: string }
  | { kind: "text"; text: string };

export declare function previewShape(preview: string | null | undefined): PreviewShape | null;
