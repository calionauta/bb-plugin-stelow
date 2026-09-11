export declare const ABOUT_LOGO_FILE: string[];
export declare const ABOUT_LOGO_BUDGET_BYTES: number;
export declare function resolveAboutLogoPath(pluginRoot: string): string | null;
export declare function toLogoDataUri(bytes: unknown): string | null;
export declare function loadAboutLogo(pluginRoot: string, readFile?: (path: string) => unknown): string | null;
