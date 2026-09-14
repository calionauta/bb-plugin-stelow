// GitHub web links derived from push output. Pure and host-neutral: the BB
// SDK exposes no remote URL, so the panel reads the `To <url>` line git
// itself prints. Unit-tested in tests/remote-url.test.mjs.
export function parsePushRemoteUrl(outputTail) {
  if (typeof outputTail !== "string" || !outputTail) return null;
  const https = outputTail.match(/To (https:\/\/([^\s/]+)\/([^\s]+\.git))/);
  if (https) return normalizeRemote(https[2], https[3]);
  const ssh = outputTail.match(/To git@([^:]+):([^\s]+\.git)/);
  if (ssh) return normalizeRemote(ssh[1], ssh[2]);
  return null;
}

function normalizeRemote(host, path) {
  // Compare/tree URL shapes are host-specific; GitHub is the BB world.
  if (host !== "github.com") return null;
  const repo = path.replace(/\.git$/, "");
  if (!repo || /\s/.test(repo) || !repo.includes("/")) return null;
  const owner = repo.split("/")[0];
  if (!owner) return null;
  return { owner, repo, webUrl: `https://github.com/${repo}` };
}

export function branchWebLinks(remote, branch, base) {
  if (!remote || !remote.webUrl || !branch) return null;
  return {
    treeUrl: `${remote.webUrl}/tree/${branch}`,
    compareUrl: base && base !== branch ? `${remote.webUrl}/compare/${base}...${branch}?expand=1` : null,
  };
}
