"""Shared multi-value filter utilities."""
from typing import Optional, List
from sqlalchemy import or_


def parse_multi(value: Optional[str]) -> Optional[List[str]]:
    """Parse a comma-separated filter string into a list.
    Returns None if the input is None or empty.
    """
    if not value:
        return None
    parts = [v.strip() for v in value.split(",") if v.strip()]
    return parts if parts else None


def apply_multi_filter(query, column, value: Optional[str]):
    """Apply a filter that may contain comma-separated multi-values.
    Single value -> ==, multiple values -> .in_()
    """
    parts = parse_multi(value)
    if parts is None:
        return query
    if len(parts) == 1:
        return query.filter(column == parts[0])
    return query.filter(column.in_(parts))


def apply_multi_ilike(query, column, value: Optional[str]):
    """Apply multi-value ILIKE filter (for JSON-stored tags like relevance_tags).
    Each value is wrapped in quotes for JSON array matching.
    """
    parts = parse_multi(value)
    if parts is None:
        return query
    if len(parts) == 1:
        return query.filter(column.ilike(f'%"{parts[0]}"%'))
    conditions = [column.ilike(f'%"{t}"%') for t in parts]
    return query.filter(or_(*conditions))
