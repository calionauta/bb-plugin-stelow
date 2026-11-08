export interface DerivedDiagram {
  mermaid: string;
  caption: string;
}
export declare function derivedDiagram(
  path: unknown,
  content: unknown,
  options?: { truncated?: boolean },
): DerivedDiagram | null;
