import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type BoardWorkflow = {
  id: string;
  name: string;
  stage: string;
  status: string;
  appetite: string;
  reviewMode: string;
  scopes: Array<{ id: string; status: string }>;
};

type Board = {
  workflows: BoardWorkflow[];
};

type MentionDeps = {
  db: Db;
  loadBoard: (projectId: string | null) => Promise<Board>;
};

function cardRows(deps: MentionDeps, projectId: string | null) {
  const sql = projectId
    ? "SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE project_id = ? AND status != 'archived'"
    : "SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE status != 'archived'";
  return (projectId ? deps.db.prepare(sql).all(projectId) : deps.db.prepare(sql).all()) as Array<{
    id: string;
    display_name: string | null;
    name: string;
    stage: string;
    status: string;
    intent: string;
    dir_hash: string | null;
  }>;
}

export function registerMentionProviders(bb: BbPluginApi, deps: MentionDeps): void {
  bb.ui.registerMentionProvider({
    id: "workflow",
    label: "Stelow workflows",
    triggers: ["@"],
    async search({ query, projectId }) {
      const board = await deps.loadBoard(projectId ?? null);
      const needle = query.toLowerCase();
      const fromBoard = board.workflows
        .filter((workflow) => workflow.name.toLowerCase().includes(needle))
        .slice(0, 20)
        .map((workflow) => ({
          id: workflow.id,
          title: workflow.name,
          subtitle: `${workflow.stage} · ${workflow.status}`,
        }));
      const fromCards = cardRows(deps, projectId ?? null)
        .filter((card) => (card.display_name ?? card.name).toLowerCase().includes(needle))
        .slice(0, 20)
        .map((card) => ({
          id: card.dir_hash ?? card.id,
          title: card.display_name ?? card.name,
          subtitle: `${card.stage} · ${card.status} · ${card.intent}`,
        }));
      const seen = new Set(fromBoard.map((item) => item.id));
      return [...fromBoard, ...fromCards.filter((item) => !seen.has(item.id))].slice(0, 20);
    },
    async resolve(itemId) {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      for (const project of projects) {
        const board = await deps.loadBoard(project.id);
        const workflow = board.workflows.find((item) => item.id === itemId);
        if (workflow) {
          const scopes = workflow.scopes.map((scope) => `${scope.id}:${scope.status}`).join(", ") || "none";
          const context = `Stelow workflow ${workflow.name}: stage=${workflow.stage}, status=${workflow.status}, `
            + `appetite=${workflow.appetite}, review_mode=${workflow.reviewMode}. Scopes: ${scopes}.`;
          return { context };
        }
      }
      const card = deps.db.prepare(
        "SELECT display_name, name, stage, status, intent FROM cards WHERE dir_hash = ? OR id = ?",
      ).get(itemId, itemId) as {
        display_name: string | null;
        name: string;
        stage: string;
        status: string;
        intent: string;
      } | undefined;
      if (card) {
        return { context: `Stelow card ${card.display_name ?? card.name}: stage=${card.stage}, status=${card.status}, intent=${card.intent}.` };
      }
      throw new Error("Stelow workflow no longer exists.");
    },
  });

  bb.ui.registerMentionProvider({
    id: "file",
    label: "Workspace files",
    triggers: ["@"],
    async search({ query, projectId }) {
      if (!projectId) return [];
      const project = await bb.sdk.projects.get({ projectId }).catch(() => null);
      const root = project?.sources.find((entry) => entry.isDefault)?.path ?? null;
      if (!root) return [];
      const listed = await bb.sdk.files.list({ path: root, query, limit: 20 }).catch(() => null);
      return (listed?.files ?? []).slice(0, 20).map((file) => ({
        id: file.path,
        title: file.path.split("/").pop() ?? file.path,
        subtitle: file.path,
      }));
    },
    async resolve(itemId) {
      return { context: `Workspace file: ${itemId}` };
    },
  });
}
