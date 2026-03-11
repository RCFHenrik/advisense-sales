interface FilterChip {
  category: string;
  value: string;
  onRemove: () => void;
}

interface ActiveFiltersBarProps {
  chips: FilterChip[];
  onClearAll: () => void;
}

export default function ActiveFiltersBar({ chips, onClearAll }: ActiveFiltersBarProps) {
  if (chips.length === 0) return null;

  return (
    <div className="active-filters-bar">
      {chips.map((chip, idx) => (
        <span key={`${chip.category}-${chip.value}-${idx}`} className="filter-chip">
          <span className="chip-category">{chip.category}:</span>
          <span className="chip-value">{chip.value}</span>
          <span className="chip-remove" onClick={chip.onRemove} title="Remove">&times;</span>
        </span>
      ))}
      <button type="button" className="clear-all-btn" onClick={onClearAll}>
        Clear All
      </button>
    </div>
  );
}
