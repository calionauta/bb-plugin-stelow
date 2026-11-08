export declare function isViewableArtifactPath(path: string | null | undefined): boolean;
export declare function artifactFileName(path: string | null | undefined): string;
export declare function resolveArtifactLink(
  currentPath: string | null | undefined,
  href: string | null | undefined,
): string | null;
export declare function artifactLinkTarget(
  click: {
    defaultPrevented?: boolean;
    button?: number;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    href?: string | null;
  } | null | undefined,
  currentPath: string | null | undefined,
): string | null;
