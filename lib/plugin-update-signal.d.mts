export declare function setPluginUpdateAvailable(next: unknown): void;
export declare function subscribePluginUpdate(listener: () => void): () => void;
export declare function pluginUpdateSnapshot(): boolean;
export declare function markPluginUpdateLoaded(): boolean;
export declare function markPluginUpdateUnloaded(): void;
