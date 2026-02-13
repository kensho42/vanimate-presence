# VanimatePresence

`VanimatePresence` is a tiny TypeScript helper that keeps a removed node in the DOM until its exit animation completes.
It works with plain DOM code and any framework. VanJS usage is supported, but optional.

## API

```ts
import { VanimatePresence, webExit, cssExit } from "vanimate-presence";

const el = document.createElement("div");
el.textContent = "Loading...";

VanimatePresence(el, {
  exit: webExit(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 400, fill: "forwards" },
  ),
});

document.body.append(el);
el.remove();
```

CSS exit option:

```ts
VanimatePresence(el, {
  exit: cssExit("fade-out", { waitFor: "animationend" }),
});
```

Attach to an existing element:

```ts
document.querySelector("#target")?.VanimatePresence({
  exit: cssExit("fade-out", { waitFor: "animationend" }),
});
```

VanJS usage (optional):

```ts
import van from "vanjs-core";
import { VanimatePresence, webExit } from "vanimate-presence";

const visible = van.state(true);
const { div } = van.tags;

const view = () =>
  visible.val
    ? VanimatePresence(div("Loading..."), {
        exit: webExit(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 400, fill: "forwards" },
        ),
      })
    : "";
```

## Build

```bash
npm run build
```

## Lint and Format (Biome)

```bash
npm run lint
npm run format
npm run check
```

## Demo

```bash
npm run demo
```

Then open:

```text
http://127.0.0.1:8000/demo/index.html
```

Optional:
- use `PORT=9000 npm run demo` to pick a different port.

The demo compares:
- immediate removal (plain conditional VanJS render)
- delayed removal with Web Animations
- delayed removal with CSS animation classes
- attachment to an existing DOM element via prototype method
