export declare const CANONICAL_VOCABULARY: readonly string[];
export declare const VOCABULARY_COMPAT: Readonly<Record<string, string>>;
export declare function isCanonicalTerm(term: unknown): boolean;
export declare function normalizeVocabularyTerm<T>(term: T): T | string;
