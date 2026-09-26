export declare function optionSectionAnchor(
  content: unknown,
  label: unknown,
): { anchor: string; line: number } | null;
export declare function optionSectionExcerpt(
  content: unknown,
  label: unknown,
): { heading: string; body: string; line: number } | null;
export declare function anchorIdFor(headingLine: unknown, index: number): string;
