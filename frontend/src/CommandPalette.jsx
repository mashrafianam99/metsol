import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons.jsx";

// Keyboard-first page switcher: Ctrl/Cmd+K opens it, arrows move, Enter opens, Escape closes.
export default function CommandPalette({ open, items, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.name} ${item.group} ${item.hint || ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const choose = (item) => {
    if (!item) return;
    onSelect(item.name);
    onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[index]);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Go to page"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cmdk-search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a page…"
            aria-label="Search pages"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[index] ? `cmdk-${results[index].name}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk-list" id="cmdk-list" role="listbox">
          {results.length === 0 && <li className="cmdk-empty">No pages match “{query}”.</li>}
          {results.map((item, itemIndex) => (
            <li
              key={item.name}
              id={`cmdk-${item.name}`}
              role="option"
              aria-selected={itemIndex === index}
              className={itemIndex === index ? "cmdk-item active" : "cmdk-item"}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => choose(item)}
            >
              <span className="cmdk-icon"><Icon name={item.icon} size={17} /></span>
              <span className="cmdk-name">{item.name}</span>
              <span className="cmdk-group">{item.group}</span>
            </li>
          ))}
        </ul>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
        </div>
      </div>
    </div>
  );
}
