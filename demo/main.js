import van from "https://cdn.jsdelivr.net/npm/vanjs-core@1.5.2/src/van.min.js";
import { cssExit, VanimatePresence, webExit } from "../dist/index.js";

const { main, h1, h2, p, div, button, strong } = van.tags;

const show = van.state(true);
const existingTargetStatus = van.state("mounted");
const initialPopListItems = [
  { id: 1, label: "Alpha" },
  { id: 2, label: "Bravo" },
  { id: 3, label: "Charlie" },
  { id: 4, label: "Delta" },
];
const popListItems = van.state(initialPopListItems);
const nextPopListId = van.state(5);
const popListItemNodes = new Map();
const popListHost = div({ class: "stack pop-list-stack" });

const renderImmediateCard = () =>
  div(
    { class: "card immediate" },
    strong("Regular Conditional Render"),
    "This one is removed from the DOM immediately when toggled off.",
  );

const renderWebCard = () =>
  VanimatePresence(
    div(
      { class: "card presence web-presence" },
      strong("Web Animations Exit"),
      "Persists in the DOM until element.animate(...).finished resolves.",
    ),
    {
      exit: webExit(
        [
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(-14px) scale(0.96)" },
        ],
        {
          duration: 650,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          fill: "forwards",
        },
      ),
    },
  );

const renderCssCard = () =>
  VanimatePresence(
    div(
      { class: "card presence css-presence" },
      strong("CSS Exit"),
      "Persists until CSS animationend/transitionend (configured in opts).",
    ),
    {
      exit: cssExit("card-css-exit", { waitFor: "animationend" }),
    },
  );

const renderPopLayoutCard = () =>
  VanimatePresence(
    div(
      { class: "card presence pop-layout-presence" },
      strong("Pop Layout Exit"),
      "Leaves layout immediately while the exit animation keeps playing.",
    ),
    {
      mode: "popLayout",
      exit: cssExit("card-pop-layout-exit", { waitFor: "animationend" }),
    },
  );

const renderPopListItem = (item, index) =>
  VanimatePresence(
    div(
      {
        class: "card pop-list-item",
        style: `--row-tone: ${index % 4};`,
      },
      strong(`Row ${item.label}`),
      `Item id ${item.id} - siblings ease on add/remove in popLayout mode.`,
    ),
    {
      mode: "popLayout",
      exit: cssExit("card-pop-layout-exit", { waitFor: "animationend" }),
    },
  );

const syncPopListDom = () => {
  const desiredIds = new Set(popListItems.val.map((item) => item.id));

  for (const [id, node] of popListItemNodes) {
    if (desiredIds.has(id)) {
      continue;
    }
    if (node.isConnected) {
      node.remove();
    }
    popListItemNodes.delete(id);
  }

  popListItems.val.forEach((item, index) => {
    let node = popListItemNodes.get(item.id);
    if (!(node instanceof HTMLElement)) {
      node = renderPopListItem(item, index);
      popListItemNodes.set(item.id, node);
    } else {
      node.style.setProperty("--row-tone", String(index % 4));
    }

    const referenceNode = popListHost.children.item(index);
    if (referenceNode !== node) {
      popListHost.insertBefore(node, referenceNode);
    }
  });
};

const createExistingTargetNode = () =>
  div(
    { id: "target", class: "card existing-target" },
    strong("Existing Element (#target)"),
    'Attached via document.querySelector("#target")?.VanimatePresence(...)',
  );

const attachPresenceToTarget = (element) => {
  element.VanimatePresence({
    exit: cssExit("existing-css-exit", { waitFor: "animationend" }),
  });
};

const ensureTargetExists = () => {
  const slot = document.getElementById("existing-slot");
  if (!(slot instanceof HTMLElement)) {
    return;
  }

  const existing = slot.querySelector("#target");
  if (existing instanceof HTMLElement) {
    existingTargetStatus.val = "mounted";
    return;
  }

  const target = createExistingTargetNode();
  slot.append(target);
  attachPresenceToTarget(target);
  existingTargetStatus.val = "mounted";
};

const removeTarget = () => {
  const target = document.querySelector("#target");
  if (!(target instanceof HTMLElement)) {
    existingTargetStatus.val = "missing";
    return;
  }

  existingTargetStatus.val = "exiting";
  target.remove();
};

const addPopListItem = () => {
  const id = nextPopListId.val;
  const labels = ["Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];
  const label = labels[id % labels.length] ?? `Item-${id}`;
  popListItems.val = [{ id, label }, ...popListItems.val];
  nextPopListId.val = id + 1;
};

const removeTopPopListItem = () => {
  if (popListItems.val.length === 0) {
    return;
  }
  popListItems.val = popListItems.val.slice(1);
};

const resetPopList = () => {
  popListItems.val = [...initialPopListItems];
  nextPopListId.val = 5;
};

van.derive(syncPopListDom);

const app = main(
  h1("VanimatePresence Demo"),
  p(
    { class: "subtitle" },
    'Simple wrapper API: `visible ? VanimatePresence(node, { exit: ... }) : ""`.',
  ),
  div(
    { class: "controls" },
    button(
      {
        class: "toggle-btn",
        onclick: () => {
          show.val = !show.val;
        },
      },
      () => (show.val ? "Hide cards" : "Show cards"),
    ),
    div({ class: "status-text" }, "Toggle quickly to observe delayed unmount."),
  ),
  div(
    { class: "grid" },
    div(
      { class: "panel" },
      h2("Without Presence"),
      p("VanJS re-render removes the element as soon as state flips."),
      div({ class: "slot" }, () => (show.val ? renderImmediateCard() : "")),
    ),
    div(
      { class: "panel" },
      h2("With Presence (Web Animations)"),
      p("Node is reinserted and removed only after `animation.finished`."),
      div({ class: "slot" }, () => (show.val ? renderWebCard() : "")),
    ),
    div(
      { class: "panel" },
      h2("With Presence (CSS)"),
      p("Node waits for CSS `animationend` before final removal."),
      div({ class: "slot" }, () => (show.val ? renderCssCard() : "")),
    ),
    div(
      { class: "panel" },
      h2("With Presence (popLayout)"),
      p("Top card pops out of flow while all rows below ease into place."),
      div(
        { class: "slot stack-slot" },
        div(
          { class: "stack" },
          () => (show.val ? renderPopLayoutCard() : ""),
          div(
            { class: "card stack-sibling" },
            strong("Sibling Row A"),
            "First sibling reflows with easing.",
          ),
          div(
            { class: "card stack-sibling" },
            strong("Sibling Row B"),
            "Second sibling follows the same eased motion.",
          ),
          div(
            { class: "card stack-sibling" },
            strong("Sibling Row C"),
            "Third sibling makes the stack shift more obvious.",
          ),
          div(
            { class: "card stack-sibling" },
            strong("Sibling Row D"),
            "Fourth sibling confirms multi-row layout easing.",
          ),
        ),
      ),
    ),
    div(
      { class: "panel" },
      h2("popLayout List (Add/Remove)"),
      p(
        "Add or remove rows to observe eased sibling reflow in both directions.",
      ),
      div(
        { class: "controls list-controls" },
        button(
          {
            class: "toggle-btn tertiary-btn",
            onclick: addPopListItem,
          },
          "Add item",
        ),
        button(
          {
            class: "toggle-btn secondary-btn",
            onclick: removeTopPopListItem,
          },
          "Remove top",
        ),
        button(
          {
            class: "toggle-btn",
            onclick: resetPopList,
          },
          "Reset",
        ),
      ),
      div(
        { class: "status-text" },
        () => `List size: ${popListItems.val.length}`,
      ),
      div({ class: "slot stack-slot" }, popListHost),
    ),
    div(
      { class: "panel" },
      h2("Attach Existing Element"),
      p('Use `document.querySelector("#target")?.VanimatePresence(...)`.'),
      div(
        { class: "controls existing-controls" },
        button(
          {
            class: "toggle-btn secondary-btn",
            onclick: removeTarget,
          },
          "Remove #target",
        ),
        button(
          {
            class: "toggle-btn tertiary-btn",
            onclick: ensureTargetExists,
          },
          "Recreate #target",
        ),
      ),
      div(
        { class: "status-text" },
        () => `Existing target status: ${existingTargetStatus.val}`,
      ),
      div({ id: "existing-slot", class: "slot" }),
    ),
  ),
);

van.add(document.getElementById("app"), app);
ensureTargetExists();
