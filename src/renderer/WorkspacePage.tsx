import { useEffect, useRef, type ReactNode } from "react";

export function WorkspacePage({ active, children, label }: { active: boolean; children: ReactNode; label: string }) {
  const visited = useRef(active);
  const page = useRef<HTMLDivElement>(null);
  if (active) visited.current = true;
  useEffect(() => {
    if (!active) page.current?.querySelectorAll("video, audio").forEach(media => (media as HTMLMediaElement).pause());
  }, [active]);
  if (!visited.current) return null;
  return <div ref={page} className="workspace-page" hidden={!active} aria-label={label}>{children}</div>;
}

export function workspaceScroller(): HTMLElement {
  return document.querySelector<HTMLElement>(".membership-workspace") ?? document.scrollingElement as HTMLElement;
}

export function scrollWorkspace({ selector, top = 0, focus }: { selector?: string; top?: number; focus?: HTMLElement } = {}) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const scroller = workspaceScroller();
    if (selector) {
      const target = document.querySelector<HTMLElement>(selector);
      if (target && target.getClientRects().length) {
        target.scrollIntoView({ block: "start" });
        const header = document.querySelector<HTMLElement>(".workspace-header");
        if (header) {
          const overlap = header.getBoundingClientRect().bottom + 16 - target.getBoundingClientRect().top;
          if (overlap > 0) scroller.scrollTop = Math.max(0, scroller.scrollTop - overlap);
        }
        const control = target.matches("input,textarea,select,button") ? target : target.querySelector<HTMLElement>("input,textarea,select,button");
        control?.focus({ preventScroll: true });
      }
    } else scroller.scrollTo({ top, behavior: "instant" });
    if (focus?.isConnected && focus.getClientRects().length) focus.focus({ preventScroll: true });
  }));
}
