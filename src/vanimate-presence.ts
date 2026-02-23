export type PresenceExitHandler<TElement extends HTMLElement> = (
  element: TElement,
) => unknown;

export interface PresenceWebExit {
  type: "web";
  keyframes: Keyframe[] | PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
  cancelRunning?: boolean;
}

export interface PresenceCssExit {
  type: "css";
  exitClass: string;
  waitFor?: "animationend" | "transitionend" | "both";
  timeoutMs?: number;
}

export type PresenceExit<TElement extends HTMLElement> =
  | PresenceExitHandler<TElement>
  | PresenceWebExit
  | PresenceCssExit;

export interface PresenceLayoutOptions {
  animateSiblings?: boolean;
  durationMs?: number;
  easing?: string;
}

export interface VanimatePresenceOptions<TElement extends HTMLElement> {
  exit: PresenceExit<TElement>;
  mode?: "sync" | "popLayout";
  layout?: PresenceLayoutOptions;
}

declare global {
  interface Element {
    VanimatePresence(options: VanimatePresenceOptions<HTMLElement>): this;
  }
}

interface PresenceRecord {
  options: VanimatePresenceOptions<HTMLElement>;
  exiting: boolean;
}

const presenceRegistry = new WeakMap<HTMLElement, PresenceRecord>();
const observerRegistry = new WeakMap<Document, MutationObserver>();
const overlayRegistry = new WeakMap<Document, HTMLElement>();
const siblingLayoutAnimations = new WeakMap<HTMLElement, Animation>();
const parentRectSnapshots = new WeakMap<
  HTMLElement,
  Map<HTMLElement, DOMRect>
>();
const prototypeMethodName = "VanimatePresence";

export function VanimatePresence<TElement extends HTMLElement>(
  element: TElement,
  options: VanimatePresenceOptions<TElement>,
): TElement {
  if (!options || !options.exit) {
    throw new Error("VanimatePresence requires an exit option.");
  }

  const existingRecord = presenceRegistry.get(element);
  if (existingRecord?.exiting) {
    return element;
  }

  presenceRegistry.set(element, {
    options: options as VanimatePresenceOptions<HTMLElement>,
    exiting: false,
  });

  const ownerDocument =
    element.ownerDocument ??
    (typeof document === "undefined" ? null : document);
  if (ownerDocument) {
    ensureObserver(ownerDocument);
  }
  return element;
}

export function installVanimatePresencePrototype(): void {
  if (typeof Element === "undefined") {
    return;
  }

  const prototypeRef = Element.prototype as {
    VanimatePresence?: (
      this: Element,
      options: VanimatePresenceOptions<HTMLElement>,
    ) => Element;
  };

  if (typeof prototypeRef[prototypeMethodName] === "function") {
    return;
  }

  Object.defineProperty(Element.prototype, prototypeMethodName, {
    configurable: true,
    enumerable: false,
    writable: true,
    value(this: Element, options: VanimatePresenceOptions<HTMLElement>) {
      if (!(this instanceof HTMLElement)) {
        throw new Error(
          "VanimatePresence can only be attached to HTMLElement.",
        );
      }
      return VanimatePresence(this, options);
    },
  });
}

installVanimatePresencePrototype();

export function webExit(
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: KeyframeAnimationOptions,
  config?: { cancelRunning?: boolean },
): PresenceWebExit {
  return {
    type: "web",
    keyframes,
    options,
    cancelRunning: config?.cancelRunning ?? true,
  };
}

export function cssExit(
  exitClass: string,
  options?: {
    waitFor?: "animationend" | "transitionend" | "both";
    timeoutMs?: number;
  },
): PresenceCssExit {
  return {
    type: "css",
    exitClass,
    waitFor: options?.waitFor,
    timeoutMs: options?.timeoutMs,
  };
}

function ensureObserver(doc: Document): void {
  if (observerRegistry.has(doc)) {
    return;
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }

      if (mutation.removedNodes.length > 0) {
        for (let index = 0; index < mutation.removedNodes.length; index += 1) {
          const removedNode = mutation.removedNodes.item(index);
          if (!removedNode) {
            continue;
          }
          handleRemovedNode(removedNode, mutation.target, mutation.nextSibling);
        }
      }

      if (mutation.addedNodes.length > 0) {
        for (let index = 0; index < mutation.addedNodes.length; index += 1) {
          const addedNode = mutation.addedNodes.item(index);
          if (!addedNode) {
            continue;
          }
          handleAddedNode(addedNode, mutation.target);
        }
      }

      recordParentSnapshot(mutation.target);
    }
  });

  observer.observe(doc, { childList: true, subtree: true });
  observerRegistry.set(doc, observer);
}

function handleAddedNode(addedNode: Node, parentNode: Node): void {
  if (!(addedNode instanceof HTMLElement)) {
    return;
  }
  if (!(parentNode instanceof HTMLElement)) {
    return;
  }

  const presence = presenceRegistry.get(addedNode);
  if (!presence) {
    return;
  }
  if (presence.options.mode !== "popLayout") {
    return;
  }

  animateSiblingReflowFromSnapshot(
    parentNode,
    addedNode,
    presence.options.layout,
  );
}

function handleRemovedNode(
  removedNode: Node,
  parentNode: Node,
  nextSibling: Node | null,
): void {
  if (!(removedNode instanceof HTMLElement)) {
    return;
  }

  const presence = presenceRegistry.get(removedNode);
  if (!presence) {
    return;
  }

  if (presence.exiting) {
    return;
  }

  if (!parentNode.isConnected) {
    return;
  }

  try {
    parentNode.insertBefore(removedNode, nextSibling);
  } catch {
    presenceRegistry.delete(removedNode);
    return;
  }

  const playSiblingReflow =
    presence.options.mode === "popLayout"
      ? prepareSiblingReflow(parentNode, removedNode, presence.options.layout)
      : null;

  presence.exiting = true;
  const cleanupPopLayout =
    presence.options.mode === "popLayout"
      ? popElementOutOfLayout(removedNode)
      : null;
  if (cleanupPopLayout) {
    playSiblingReflow?.();
  }

  void runExit(removedNode, presence).finally(() => {
    presenceRegistry.delete(removedNode);
    cleanupPopLayout?.();
    removedNode.remove();
  });
}

function prepareSiblingReflow(
  parentNode: Node,
  exitingElement: HTMLElement,
  layoutOptions?: PresenceLayoutOptions,
): (() => void) | null {
  if (!(parentNode instanceof HTMLElement)) {
    return null;
  }

  const config = resolveLayoutOptions(layoutOptions);
  if (!config.animateSiblings) {
    return null;
  }

  const siblings = Array.from(parentNode.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== exitingElement,
  );
  if (siblings.length === 0) {
    return null;
  }

  const beforeRects = new Map<HTMLElement, DOMRect>();
  for (const sibling of siblings) {
    beforeRects.set(sibling, sibling.getBoundingClientRect());
  }

  return () => {
    for (const sibling of siblings) {
      if (!sibling.isConnected) {
        continue;
      }

      const beforeRect = beforeRects.get(sibling);
      if (!beforeRect) {
        continue;
      }

      const afterRect = sibling.getBoundingClientRect();
      const deltaX = beforeRect.left - afterRect.left;
      const deltaY = beforeRect.top - afterRect.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        continue;
      }

      siblingLayoutAnimations.get(sibling)?.cancel();
      const animation = sibling.animate(
        [{ translate: `${deltaX}px ${deltaY}px` }, { translate: "0px 0px" }],
        {
          duration: config.durationMs,
          easing: config.easing,
          fill: "both",
        },
      );
      siblingLayoutAnimations.set(sibling, animation);
      void animation.finished
        .catch(() => undefined)
        .then(() => {
          if (siblingLayoutAnimations.get(sibling) === animation) {
            siblingLayoutAnimations.delete(sibling);
          }
        });
    }
  };
}

function animateSiblingReflowFromSnapshot(
  parentNode: HTMLElement,
  stationaryElement: HTMLElement,
  layoutOptions?: PresenceLayoutOptions,
): void {
  const config = resolveLayoutOptions(layoutOptions);
  if (!config.animateSiblings) {
    return;
  }

  const snapshot = parentRectSnapshots.get(parentNode);
  if (!snapshot) {
    return;
  }

  for (const child of Array.from(parentNode.children)) {
    if (!(child instanceof HTMLElement) || child === stationaryElement) {
      continue;
    }

    const beforeRect = snapshot.get(child);
    if (!beforeRect) {
      continue;
    }

    const afterRect = child.getBoundingClientRect();
    const deltaX = beforeRect.left - afterRect.left;
    const deltaY = beforeRect.top - afterRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      continue;
    }

    siblingLayoutAnimations.get(child)?.cancel();
    const animation = child.animate(
      [{ translate: `${deltaX}px ${deltaY}px` }, { translate: "0px 0px" }],
      {
        duration: config.durationMs,
        easing: config.easing,
        fill: "both",
      },
    );
    siblingLayoutAnimations.set(child, animation);
    void animation.finished
      .catch(() => undefined)
      .then(() => {
        if (siblingLayoutAnimations.get(child) === animation) {
          siblingLayoutAnimations.delete(child);
        }
      });
  }
}

function recordParentSnapshot(node: Node): void {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  const snapshot = new Map<HTMLElement, DOMRect>();
  for (const child of Array.from(node.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    snapshot.set(child, child.getBoundingClientRect());
  }
  parentRectSnapshots.set(node, snapshot);
}

function resolveLayoutOptions(layoutOptions?: PresenceLayoutOptions): {
  animateSiblings: boolean;
  durationMs: number;
  easing: string;
} {
  return {
    animateSiblings: layoutOptions?.animateSiblings ?? true,
    durationMs: layoutOptions?.durationMs ?? 320,
    easing: layoutOptions?.easing ?? "cubic-bezier(0.22, 1, 0.36, 1)",
  };
}

function popElementOutOfLayout(element: HTMLElement): (() => void) | null {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!doc.body || !view) {
    return null;
  }

  try {
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) {
      return null;
    }

    const overlayRoot = ensureOverlayRoot(doc);
    const style = element.style;
    style.position = "fixed";
    style.top = `${rect.top}px`;
    style.left = `${rect.left}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    style.margin = "0";
    style.pointerEvents = "none";

    overlayRoot.append(element);

    return () => {
      cleanupOverlayRoot(doc);
    };
  } catch {
    return null;
  }
}

function ensureOverlayRoot(doc: Document): HTMLElement {
  const existingRoot = overlayRegistry.get(doc);
  if (existingRoot?.isConnected) {
    return existingRoot;
  }

  const overlayRoot = doc.createElement("div");
  overlayRoot.dataset.vanimateOverlayRoot = "true";
  overlayRoot.style.position = "fixed";
  overlayRoot.style.left = "0";
  overlayRoot.style.top = "0";
  overlayRoot.style.width = "100%";
  overlayRoot.style.height = "100%";
  overlayRoot.style.pointerEvents = "none";
  overlayRoot.style.overflow = "visible";
  overlayRoot.style.zIndex = "2147483647";

  doc.body.append(overlayRoot);
  overlayRegistry.set(doc, overlayRoot);
  return overlayRoot;
}

function cleanupOverlayRoot(doc: Document): void {
  const overlayRoot = overlayRegistry.get(doc);
  if (!overlayRoot) {
    return;
  }

  if (overlayRoot.childElementCount > 0) {
    return;
  }

  overlayRoot.remove();
  overlayRegistry.delete(doc);
}

async function runExit(
  element: HTMLElement,
  presence: PresenceRecord,
): Promise<void> {
  const exitConfig = presence.options.exit;

  if (typeof exitConfig === "function") {
    await Promise.resolve(exitConfig(element));
    return;
  }

  if (exitConfig.type === "web") {
    await runWebExit(element, exitConfig);
    return;
  }

  await runCssExit(element, exitConfig);
}

async function runWebExit(
  element: HTMLElement,
  exitConfig: PresenceWebExit,
): Promise<void> {
  if (exitConfig.cancelRunning ?? true) {
    for (const animation of element.getAnimations()) {
      animation.cancel();
    }
  }

  const animation = element.animate(exitConfig.keyframes, exitConfig.options);
  await animation.finished.catch(() => undefined);
}

function runCssExit(
  element: HTMLElement,
  exitConfig: PresenceCssExit,
): Promise<void> {
  const waitFor = exitConfig.waitFor ?? "animationend";

  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId: number | undefined;
    const eventTypes =
      waitFor === "both" ? ["animationend", "transitionend"] : [waitFor];

    const complete = (): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      for (const type of eventTypes) {
        element.removeEventListener(type, handleExitEvent);
      }
      resolve();
    };

    const handleExitEvent = (event: Event): void => {
      if (event.target !== element) {
        return;
      }
      complete();
    };

    for (const type of eventTypes) {
      element.addEventListener(type, handleExitEvent);
    }

    element.classList.add(exitConfig.exitClass);
    const timeoutMs = exitConfig.timeoutMs ?? inferCssTimeoutMs(element);

    if (timeoutMs <= 0) {
      queueMicrotask(complete);
      return;
    }

    timeoutId = window.setTimeout(complete, timeoutMs + 34);
  });
}

function inferCssTimeoutMs(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const transitionMs = maxListDurationMs(
    styles.transitionDuration,
    styles.transitionDelay,
  );
  const animationMs = maxListDurationMs(
    styles.animationDuration,
    styles.animationDelay,
  );
  return Math.max(transitionMs, animationMs);
}

function maxListDurationMs(durations: string, delays: string): number {
  const durationValues = durations.split(",").map(parseTimeValue);
  const delayValues = delays.split(",").map(parseTimeValue);
  const valueCount = Math.max(durationValues.length, delayValues.length);

  let maxMs = 0;
  for (let index = 0; index < valueCount; index += 1) {
    const duration = durationValues[index % durationValues.length] ?? 0;
    const delay = delayValues[index % delayValues.length] ?? 0;
    maxMs = Math.max(maxMs, duration + delay);
  }
  return maxMs;
}

function parseTimeValue(rawValue: string): number {
  const value = rawValue.trim();
  if (!value) {
    return 0;
  }

  if (value.endsWith("ms")) {
    return Number.parseFloat(value);
  }

  if (value.endsWith("s")) {
    return Number.parseFloat(value) * 1000;
  }

  return 0;
}
