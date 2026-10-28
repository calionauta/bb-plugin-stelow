/**
 * The `./panel-header` stub for tests that mount a track panel view.
 *
 * `PanelHeader` is a layout component, so a view test only needs the pieces it
 * was handed — the title as its heading, the explanation as prose, and the
 * actions. Rendering them keeps a view test's own assertions (the title comes
 * from its config, the actions are the config's) working without dragging the
 * header's class list into a test about something else.
 */
export function panelHeaderStub() {
  const PanelHeader = (props) => ({
    type: "header",
    props: {},
    children: [
      { type: "h1", props: {}, children: [props.title ?? ""] },
      { type: "p", props: {}, children: [props.blurb ?? ""] },
      props.actions ?? [],
    ],
  });
  const BoardScrollHint = () => ({
    type: "p",
    props: {},
    children: ["Swipe sideways to view every stage."],
  });
  return { PanelHeader, BoardScrollHint };
}
