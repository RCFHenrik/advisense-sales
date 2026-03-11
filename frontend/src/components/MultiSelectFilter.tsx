import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface MultiSelectFilterProps {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

export default function MultiSelectFilter({ options, selected, onChange, placeholder }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Compute portal position (fixed positioning to avoid scroll jumps)
  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = Math.min(280, filtered.length * 30 + 80);
    const top = spaceBelow >= dropdownHeight
      ? rect.bottom + 2
      : rect.top - dropdownHeight - 2;
    setPos({
      top,
      left: rect.left,
      width: Math.max(rect.width, 200),
    });
  }, [filtered.length]);

  // Reposition on open, scroll, resize
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, updatePosition]);

  // Focus search input when opened
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const selectAll = () => onChange([...options]);
  const clearAll = () => onChange([]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  };

  const triggerLabel = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  const dropdown = open
    ? createPortal(
        <div
          ref={listRef}
          className="ms-dropdown"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
          }}
          onKeyDown={handleKeyDown}
        >
          {/* Search */}
          <div className="ms-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="ms-search-input"
            />
          </div>
          {/* Actions */}
          <div className="ms-actions">
            <button type="button" className="ms-action-btn" onMouseDown={(e) => { e.preventDefault(); selectAll(); }}>
              Select All
            </button>
            <button type="button" className="ms-action-btn" onMouseDown={(e) => { e.preventDefault(); clearAll(); }}>
              Clear
            </button>
          </div>
          {/* Options */}
          <div className="ms-options">
            {filtered.length === 0 ? (
              <div className="ms-no-match">No matches</div>
            ) : (
              filtered.map((opt) => (
                <label key={opt} className="ms-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                  />
                  <span className="ms-option-text">{opt}</span>
                </label>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div
        className={`ms-trigger${selected.length > 0 ? ' has-values' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className="ms-trigger-text">{triggerLabel}</span>
        <span className="ms-chevron">{open ? '\u25B4' : '\u25BE'}</span>
      </div>
      {dropdown}
    </div>
  );
}
