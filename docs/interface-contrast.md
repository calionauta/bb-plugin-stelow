# Interface Contrast and Scope Map

Stelow now has a host-neutral contract for Interface Contrast and Scope Map artifacts.

## Scope ownership

The existing `scope` stage owns the approved delivery map. The `stelow-product-scope-mapping` skill is a product method, not a new stage. Shape may produce candidate slices; planning may enrich approved slices with technical detail but cannot change scope IDs, ownership, IN/OUT boundaries, or dependency meaning.

A narrow bugfix or mechanical refactor may use a one-scope plan instead of a full map. The reason and minimum evidence must be recorded. A refactor with more than one delivery scope is refused at execution until an approved, semantically valid `scope-map.json` exists.

## Explore

Explore exposes Scope Mapping as one focused technique. It writes the readable `explore-scope-map.md` artifact first. Validated `scope-map.json` evidence is optional and never replaces the readable artifact. An Explore result remains draft until an approval receipt exists.

## Decision records

Interface Contrast receipts distinguish:

- agent-authored evidence from human authority;
- the decision route and disposition;
- fixed constraints, criteria, options, and accepted sacrifice;
- Shape and Scope Map versions;
- provenance and missing evidence;
- the next required action.

An agent may stop for a human decision, but it cannot fabricate human evidence or silently change product policy.

## Scope Map challenges

A scope-map challenge names the affected scopes, reason, evidence, and destination. Product-commitment changes return to Shape. Scope-boundary and dependency changes return to Scope. Dependent artifacts are marked stale until the required approval is current.

## Native human boundaries

A native `needs_input` result carries:

- the question;
- question ID;
- contract ID;
- boundary ID;
- reaction or confirmation kind;
- Shape version;
- Scope Map version when present;
- answer schema.

The card control plane remains the only owner of the question. An answer resumes the same run only when its boundary and versions match the current run.

## Validation status

The deterministic preflight and simulated case matrix validate structural contracts, mutations, artifact validation, and route refusals. They do not claim human decision quality or human usability. The canonical plan and simulated evidence are kept separately from production implementation claims.
