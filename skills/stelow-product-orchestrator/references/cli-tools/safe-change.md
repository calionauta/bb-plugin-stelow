# Tool: safe-change

> Regression check before planning using pi-agent-codebase-workflows.

---

## Install

This is an **optional third-party tool, installed by the user only** — never run these installers yourself. If it is not already present, use the fallback below. The user may install it from a terminal (their choice), pinning a version or verifying a digest if the registry supports it:

```text
pi install git:github.com/PriNova/pi-agent-codebase-workflows
# or, for other agents:
npx skills add Prinova/pi-agent-codebase-workflows -g
```

---

## Specific Command (PI)

```bash
safe-change
```

| Info | Value |
|------|-------|
| Package | pi-agent-codebase-workflows (PriNova) |
| Command | `safe-change` |

---

## When to Use

| Phase | Purpose |
|-------|---------|
| Phase 2 (Setup) | Validate impact before planning |

---

## Output

Returns analysis of:
- Files that will be affected
- Possible regressions
- Warnings and risks

---

## Fallback (Not Installed)

If `safe-change` is not available:
- Manually check relevant files with `git diff`
- Run existing tests to verify regressions
- Document manual analysis

**Abstraction:** "Regression check before changes"