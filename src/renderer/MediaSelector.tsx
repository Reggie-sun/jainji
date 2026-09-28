import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./media-selector.css";

type MediaOption = { id: string; displayName: string };

export function MediaSelector({ id, label, media, value, disabled, onChange }: {
  id?: string; label: string; media: readonly MediaOption[]; value?: string; disabled?: boolean;
  onChange(id: string): void;
}) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const selectedIndex = Math.max(0, media.findIndex(item => item.id === value));
  const selected = media[selectedIndex];
  const activeIndex = media.findIndex(item => item.id === activeId);
  const highlightedIndex = activeIndex < 0 ? selectedIndex : activeIndex;
  const expanded = open && !disabled && media.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${highlightedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, highlightedIndex, listId]);
  useEffect(() => { if (disabled || !media.length) setOpen(false); }, [disabled, media.length]);

  const choose = (item: MediaOption) => {
    setOpen(false); setActiveId(item.id); onChange(item.id); trigger.current?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded && media[highlightedIndex]) choose(media[highlightedIndex]);
      else { setActiveId(selected?.id); setOpen(true); }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? media.length - 1
      : expanded ? Math.max(0, Math.min(media.length - 1, highlightedIndex + (event.key === "ArrowDown" ? 1 : -1))) : selectedIndex;
    setActiveId(media[next]?.id); setOpen(true);
  };

  return <div className="media-selector" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <div className="media-selector-menu">
    <button type="button" id={id} className="media-selector-trigger" ref={trigger} role="combobox" aria-label={`选择${label}`} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded ? `${listId}-${highlightedIndex}` : undefined} disabled={disabled || !media.length} title={selected?.displayName} onKeyDown={keyDown} onClick={() => { setActiveId(selected?.id); setOpen(!expanded); }}>
      <span>{selected?.displayName ?? "暂无素材"}</span><span aria-hidden="true">▾</span>
    </button>
    {expanded && <div id={listId} className="media-selector-list" role="listbox" aria-label={`${label}列表`}>
      {media.map((item, index) => <button type="button" id={`${listId}-${index}`} key={item.id} className={index === highlightedIndex ? "highlighted" : ""} role="option" aria-selected={item.id === selected?.id} tabIndex={-1} title={item.displayName} onPointerDown={event => event.preventDefault()} onPointerMove={() => setActiveId(item.id)} onClick={() => choose(item)}><span>{index + 1}. {item.displayName}</span>{item.id === selected?.id && <span aria-hidden="true">✓</span>}</button>)}
    </div>}
    </div>
    <div className="media-selector-navigation">
      <button type="button" disabled={disabled || selectedIndex <= 0 || !media.length} aria-label={`上一个${label}`} onClick={() => choose(media[selectedIndex - 1])}>上一个</button>
      <span aria-live="polite">{media.length ? selectedIndex + 1 : 0} / {media.length}</span>
      <button type="button" disabled={disabled || selectedIndex >= media.length - 1} aria-label={`下一个${label}`} onClick={() => choose(media[selectedIndex + 1])}>下一个</button>
    </div>
  </div>;
}
