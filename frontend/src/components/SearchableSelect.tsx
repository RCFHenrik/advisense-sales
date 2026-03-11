import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Option {
  value: number;
  label: string;
}

interface Props {
  options: Option[];
  placeholder?: string;
  onSelect: (value: number) => void;
  style?: React.CSSProperties;
}

/**
 * A lightweight searchable dropdown (combobox).
 * The dropdown list is rendered via a portal so it always
 * floats above surrounding content (tables, cards, etc.).
 */
export default function SearchableSelect({ options, placeholder = 'Search...', onSelect, style }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.length === 0
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  // Compute portal position (fixed positioning to avoid scroll jumps)
  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(rect.width, 180),
    });
  }, []);

  // Reposition on open and on scroll/resize
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();

    // Also reposition if any scrollable ancestor scrolls
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, updatePosition]);

  // Close when clicking outside both the wrapper and the portal list
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  // Scroll highlighted item into view inside the portal list
  // (manual scrollTop to avoid page-level scroll caused by scrollIntoView in portals)
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.children;
    if (items[highlightIdx]) {
      const item = items[highlightIdx] as HTMLElement;
      const list = listRef.current;
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;

      if (itemTop < list.scrollTop) {
        list.scrollTop = itemTop;
      } else if (itemBottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = itemBottom - list.clientHeight;
      }
    }
  }, [highlightIdx, open]);

  const handleSelect = (value: number) => {
    onSelect(value);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIdx]) {
          handleSelect(filtered[highlightIdx].value);
        }
        break;
      case 'Escape':
        setOpen(false);
        setQuery('');
        break;
    }
  };

  const dropdownList = open
    ? createPortal(
        <div
          ref={listRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            maxHeight: 220,
            overflowY: 'auto',
            zIndex: 9999,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 10px', color: '#999', fontSize: 11 }}>
              No matches
            </div>
          ) : (
            filtered.map((opt, idx) => (
              <div
                key={opt.value}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  background: idx === highlightIdx ? '#edf2f7' : '#fff',
                  borderBottom: '1px solid #f7fafc',
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(opt.value);
                }}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        className="form-control"
        style={{ fontSize: 11, padding: '2px 6px' }}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {dropdownList}
    </div>
  );
}
