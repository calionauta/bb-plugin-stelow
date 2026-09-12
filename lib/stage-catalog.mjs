/**
 * Explore technique catalog: one-off executions of a single Stelow method,
 * without the Build workflow — no triage, sequence, gates, or scopes. The
 * human picks one technique, supplies input (an idea, proposal, or doc), and
 * the worker runs that playbook and saves its artifact.
 *
 * Each entry maps to one stelow-workflow-* skill bundled with this plugin
 * (skills/). Single source of truth for the Explore picker, the worker
 * prompt, and the card detail.
 */

export const TECHNIQUE_CATALOG = [
  {
    id: "shape-up",
    label: "Shape Up proposal",
    skill: "stelow-workflow-shape-up",
    emoji: "📐",
    blurb: "Turn an idea into a shaped proposal with IN/OUT scope, appetite, and risk — before any planning.",
    keywords: ["shape", "proposal", "scope", "appetite", "idea"],
  },
  {
    id: "interface-alternatives",
    label: "Interface alternatives",
    skill: "stelow-workflow-interface-alternatives",
    emoji: "🎨",
    blurb: "Explore 1, 3, or 5 interface directions with explicit trade-offs — no code, no mockups wasted.",
    keywords: ["ui", "interface", "design", "tradeoffs", "alternatives"],
  },
  {
    id: "plan-critique",
    label: "Product plan critique",
    skill: "stelow-workflow-plan-critique",
    emoji: "🔍",
    blurb: "Review an existing product plan or proposal: gaps, risks, assumptions, and questions to resolve.",
    keywords: ["critique", "review", "gaps", "questions", "risks", "proposal"],
  },
  {
    id: "tech-planning",
    label: "Tech plan + scopes",
    skill: "stelow-workflow-tech-planning",
    emoji: "🧱",
    blurb: "Generate a technical plan with typed, dependency-sequenced scopes from a document you already have.",
    keywords: ["tech", "scopes", "planning", "sequencing", "architecture"],
  },
  {
    id: "codebase-critique",
    label: "Codebase critique",
    skill: "stelow-workflow-codebase-critique",
    emoji: "🏗️",
    blurb: "Structural review of a codebase: architecture, coupling, hotspots, and maintenance risk.",
    keywords: ["code", "architecture", "review", "coupling", "refactor"],
  },
  {
    id: "ux-critique",
    label: "UX critique",
    skill: "stelow-workflow-ux-critique",
    emoji: "🖥️",
    blurb: "Evaluate an interface or live URL against heuristics, accessibility, and visual hierarchy.",
    keywords: ["ux", "accessibility", "heuristics", "design", "wcag"],
  },
  {
    id: "testing-ai-code",
    label: "Testing strategy",
    skill: "stelow-workflow-testing-ai-code",
    emoji: "🧪",
    blurb: "AI-aware testing plan with security gates and risk-based coverage targets for a feature or repo.",
    keywords: ["test", "coverage", "quality", "security", "qa"],
  },
  {
    id: "execution-critique",
    label: "Execution critique",
    skill: "stelow-workflow-execution-critique",
    emoji: "✅",
    blurb: "Post-implementation gap check: verify scope completion and surface what is missing.",
    keywords: ["execution", "gap", "verify", "done", "delivery"],
  },
];

export function techniqueById(id) {
  return TECHNIQUE_CATALOG.find((entry) => entry.id === id) ?? null;
}

// Compatibility for persisted cards and older plugin clients. New code should
// use the technique names above; an Explore choice is never a Build stage.
export const STAGE_CATALOG = TECHNIQUE_CATALOG;
export const stageById = techniqueById;
