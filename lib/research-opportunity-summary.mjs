/**
 * Human-facing status for the interactive Research opportunities list.
 *
 * The index uses checked boxes internally to prevent duplicate fan-out. The
 * card should describe the user's next action, not expose that mechanism.
 */
export function researchOpportunityHint(available, total) {
  const ready = Math.max(0, Number.isInteger(available) ? available : 0);
  const all = Math.max(ready, Number.isInteger(total) ? total : 0);
  const created = all - ready;
  const opportunity = (count) => `${count} ${count === 1 ? "opportunity" : "opportunities"}`;
  const buildCard = (count) => `${count} build ${count === 1 ? "card" : "cards"} created`;

  if (all === 0) return "no opportunities yet";
  if (created === 0) return `${opportunity(ready)} ready to build`;
  if (ready === 0) return buildCard(created);
  return `${opportunity(ready)} ready to build · ${buildCard(created)}`;
}
