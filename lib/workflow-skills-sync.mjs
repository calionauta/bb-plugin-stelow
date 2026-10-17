/**
 * Release-time sync for the plugin's vendored Stelow assets. Runtime code
 * never calls these functions: a published plugin must execute the helper and
 * skills it shipped, rather than silently adopting upstream main.
 *
 * Scope: every top-level skills/stelow-<name>/ directory upstream — workflow
 * skills AND product playbooks. Discovery is dynamic (no allowlist), so a
 * new upstream skill arrives on the next sync and a removed one is pruned.
 * Fail-soft: any error returns a summary with `error` set and persists the
 * current on-disk skills untouched. The plugin never breaks because sync
 * failed.
 *
 * Implementation is split by phase — fetch (network), diff (local state
 * plus the pure drift core), swap (atomic publish) — and this module is
 * the stable facade: every historic import path keeps resolving here.
 */
export {
  REPO, SRC_PREFIX, TREE_URL, RAW_URL,
  gitBlobSha, fetchTreeBlobs, fetchStelowSkillTree, fetchVerifiedBlob,
} from "./skills-sync-fetch.mjs";
export {
  STATE_FILE, CORE_SKILLS, WORKFLOW_SKILLS, SINGLE_FILES, EXECUTION_ASSET_PREFIXES,
  assertSingleFilePresent, walk, loadState, saveState, defaultStateFile,
  SYNC_TIMESTAMP_KEY, readLastSyncAt, readPinnedStelowSource, fileMode,
  localGitBlobSha, readUpstreamForks, diffFileMaps, applyAllowlist,
} from "./skills-sync-diff.mjs";
export { syncWorkflowSkills, syncHelperScript } from "./skills-sync-swap.mjs";
