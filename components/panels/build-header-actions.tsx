import { BucketGalleryButton } from "../board/card-gallery";
import type { BoardCardItem } from "../board/board-cards";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

/**
 * The Build header's four actions, as direct children of the shared header's
 * action layout.
 *
 * This used to return a `<div className="grid ...">` inside `PanelHeader`'s own
 * action grid. The outer container wrapped its single child; the inner one had
 * no `flex-wrap`; four buttons ran off a tablet panel instead of wrapping. A
 * fragment makes each button a child of the one layout that places them.
 *
 * It lives in its own module so the test can render THIS component with three
 * small stubs, instead of loading the whole panel view.
 */
export type BuildHeaderActionsProps = {
  groupedInbox: BoardCardItem[] | null;
  githubAutomationEnabled: boolean;
  onNewIssue: () => void;
  onOpenCard: (card: BoardCardItem, cardId: string) => void;
  onOpenPresets: () => void;
  onOpenGithub: () => void;
};

export function BuildHeaderActions(props: BuildHeaderActionsProps) {
  return (
    <>
      <Button
        className="min-h-11 w-full sm:w-auto sm:flex-none"
        onClick={props.onNewIssue}
      >
        <Icon name="Plus" className="h-4 w-4" aria-hidden />
        New issue
      </Button>
      <BucketGalleryButton
        cards={props.groupedInbox ?? []}
        onOpenCard={(card) => props.onOpenCard(card, card.id)}
      />
      <Button
        className="min-h-11 w-full sm:w-auto sm:flex-none"
        variant="outline"
        onClick={props.onOpenPresets}
        title="Manage agent presets and per-phase routing"
      >
        <Icon name="Settings" className="h-4 w-4" aria-hidden />
        Agent Presets
      </Button>
      {props.githubAutomationEnabled ? (
        <Button
          className="min-h-11 w-full sm:w-auto sm:flex-none"
          variant="outline"
          onClick={props.onOpenGithub}
          title="Import GitHub issues now or watch labels automatically"
        >
          <Icon name="Github" className="h-4 w-4" aria-hidden />
          GitHub issues
        </Button>
      ) : null}
    </>
  );
}
