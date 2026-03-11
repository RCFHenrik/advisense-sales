import React, { useState } from 'react';
import { Trash2, Search, X, UserPlus } from 'lucide-react';
import MultiSelectFilter from './MultiSelectFilter';
import type { FilterGroup, FilterGroupFilters, FilterOptions } from '../types';
import api from '../api/client';

const EMPTY_FILTERS: FilterGroupFilters = {
  client_tier: [],
  sector: [],
  responsibility_domain: [],
  group_domicile: [],
  owner_business_area: [],
  owner_team: [],
  relevance_tag: [],
  search: '',
  is_decision_maker: '',
};

interface Props {
  group: FilterGroup;
  index: number;
  filterOptions: FilterOptions;
  matchCount: number | null;
  canRemove: boolean;
  onUpdate: (id: string, group: FilterGroup) => void;
  onRemove: (id: string) => void;
}

export default function FilterGroupCard({
  group, index, filterOptions, matchCount, canRemove, onUpdate, onRemove,
}: Props) {
  const [contactSearch, setContactSearch] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; full_name: string; email: string; company_name: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const updateFilters = (key: keyof FilterGroupFilters, value: any) => {
    onUpdate(group.id, {
      ...group,
      filters: { ...group.filters, [key]: value },
    });
  };

  const searchContacts = async (q: string) => {
    setContactSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data } = await api.get(`/contacts/?search=${encodeURIComponent(q)}&page_size=10&status=active`);
      const existing = new Set(group.contactIds);
      setSearchResults((data.contacts || []).filter((c: any) => !existing.has(c.id)));
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const addContact = (c: { id: number; full_name: string; email: string; company_name?: string }) => {
    onUpdate(group.id, {
      ...group,
      contactIds: [...group.contactIds, c.id],
      contactLabels: [...group.contactLabels, { id: c.id, name: c.full_name, email: c.email }],
    });
    setContactSearch('');
    setSearchResults([]);
  };

  const removeContact = (cid: number) => {
    onUpdate(group.id, {
      ...group,
      contactIds: group.contactIds.filter(id => id !== cid),
      contactLabels: group.contactLabels.filter(l => l.id !== cid),
    });
  };

  return (
    <div style={{
      background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: 16, position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#4a5568' }}>
            {group.type === 'filter' ? `Filter Group ${index + 1}` : `Individual Contacts`}
          </span>
          {group.type === 'individual' && <UserPlus size={14} style={{ color: '#718096' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {matchCount !== null && (
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: matchCount > 0 ? 'var(--accent)' : '#a0aec0',
            }}>
              {matchCount} {matchCount === 1 ? 'match' : 'matches'}
            </span>
          )}
          {canRemove && (
            <button onClick={() => onRemove(group.id)} className="btn btn-sm"
              style={{ padding: '2px 6px', color: '#e53e3e', background: 'transparent', border: 'none' }}
              title="Remove group">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {group.type === 'filter' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            <MultiSelectFilter placeholder="Tier" options={filterOptions.client_tiers}
              selected={group.filters.client_tier}
              onChange={(v) => updateFilters('client_tier', v)} />
            <MultiSelectFilter placeholder="Sector" options={filterOptions.sectors}
              selected={group.filters.sector}
              onChange={(v) => updateFilters('sector', v)} />
            <MultiSelectFilter placeholder="Domain" options={filterOptions.responsibility_domains}
              selected={group.filters.responsibility_domain}
              onChange={(v) => updateFilters('responsibility_domain', v)} />
            <MultiSelectFilter placeholder="Country" options={filterOptions.group_domiciles}
              selected={group.filters.group_domicile}
              onChange={(v) => updateFilters('group_domicile', v)} />
            <MultiSelectFilter placeholder="BA" options={filterOptions.business_areas}
              selected={group.filters.owner_business_area}
              onChange={(v) => updateFilters('owner_business_area', v)} />
            <MultiSelectFilter placeholder="Team" options={filterOptions.teams}
              selected={group.filters.owner_team}
              onChange={(v) => updateFilters('owner_team', v)} />
            <MultiSelectFilter placeholder="Tags" options={filterOptions.relevance_tags}
              selected={group.filters.relevance_tag}
              onChange={(v) => updateFilters('relevance_tag', v)} />
            <select className="form-control" style={{ fontSize: 12, padding: '4px 8px', height: 32 }}
              value={group.filters.is_decision_maker}
              onChange={(e) => updateFilters('is_decision_maker', e.target.value)}>
              <option value="">DM: Any</option>
              <option value="true">DM Only</option>
              <option value="false">Non-DM</option>
            </select>
          </div>
          <div style={{ marginTop: 6 }}>
            <input className="form-control" placeholder="Search name/email..."
              style={{ fontSize: 12, padding: '4px 8px', maxWidth: 250 }}
              value={group.filters.search}
              onChange={(e) => updateFilters('search', e.target.value)} />
          </div>
        </>
      )}

      {group.type === 'individual' && (
        <div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <input className="form-control" placeholder="Search contact to add..."
              style={{ fontSize: 12, padding: '4px 8px' }}
              value={contactSearch} onChange={(e) => searchContacts(e.target.value)} />
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
                maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                {searchResults.map(c => (
                  <div key={c.id} onClick={() => addContact(c)}
                    style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f0f0f0' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f7fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                    <strong>{c.full_name}</strong> — {c.email}
                    {c.company_name && <span style={{ color: '#718096' }}> ({c.company_name})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {group.contactLabels.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {group.contactLabels.map(c => (
                <span key={c.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#e2e8f0', borderRadius: 12, padding: '2px 8px', fontSize: 11,
                }}>
                  {c.name}
                  <X size={12} style={{ cursor: 'pointer', color: '#e53e3e' }}
                    onClick={() => removeContact(c.id)} />
                </span>
              ))}
            </div>
          )}
          {group.contactLabels.length === 0 && (
            <p style={{ color: '#a0aec0', fontSize: 12, margin: 0 }}>
              Search and add individual contacts above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { EMPTY_FILTERS };
