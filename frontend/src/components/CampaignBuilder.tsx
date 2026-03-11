import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Users, Filter, Eye, Loader2, AlertTriangle, UserPlus2 } from 'lucide-react';
import FilterGroupCard, { EMPTY_FILTERS } from './FilterGroupCard';
import type {
  FilterGroup, FilterGroupFilters, GroupCombineOperator,
  FilterOptions, GroupedPreviewResponse, QuickCreateContactRequest,
} from '../types';
import api from '../api/client';

interface Props {
  campaignId: number;
  filterOptions: FilterOptions;
  onRecipientsAdded: () => void;
}

function newFilterGroup(): FilterGroup {
  return {
    id: crypto.randomUUID(),
    type: 'filter',
    filters: { ...EMPTY_FILTERS },
    contactIds: [],
    contactLabels: [],
  };
}

function newIndividualGroup(): FilterGroup {
  return {
    id: crypto.randomUUID(),
    type: 'individual',
    filters: { ...EMPTY_FILTERS },
    contactIds: [],
    contactLabels: [],
  };
}

function filtersToPayload(f: FilterGroupFilters) {
  return {
    filter_client_tier: f.client_tier.length ? f.client_tier.join(',') : null,
    filter_sector: f.sector.length ? f.sector.join(',') : null,
    filter_responsibility_domain: f.responsibility_domain.length ? f.responsibility_domain.join(',') : null,
    filter_group_domicile: f.group_domicile.length ? f.group_domicile.join(',') : null,
    filter_owner_business_area: f.owner_business_area.length ? f.owner_business_area.join(',') : null,
    filter_owner_team: f.owner_team.length ? f.owner_team.join(',') : null,
    filter_relevance_tag: f.relevance_tag.length ? f.relevance_tag.join(',') : null,
    filter_search: f.search || null,
    filter_is_decision_maker: f.is_decision_maker === 'true' ? true : f.is_decision_maker === 'false' ? false : null,
  };
}

function groupHasFilters(g: FilterGroup): boolean {
  if (g.type === 'individual') return g.contactIds.length > 0;
  const f = g.filters;
  return !!(f.client_tier.length || f.sector.length || f.responsibility_domain.length ||
    f.group_domicile.length || f.owner_business_area.length || f.owner_team.length ||
    f.relevance_tag.length || f.search || f.is_decision_maker);
}

export default function CampaignBuilder({ campaignId, filterOptions, onRecipientsAdded }: Props) {
  const [groups, setGroups] = useState<FilterGroup[]>([newFilterGroup()]);
  const [operator, setOperator] = useState<GroupCombineOperator>('or');
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<GroupedPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showPreviewTable, setShowPreviewTable] = useState(false);

  // Gap analysis state
  const [gapHints, setGapHints] = useState<any>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState<{
    company: string; domain: string; title: string;
  } | null>(null);
  const [quickCreateData, setQuickCreateData] = useState({ name: '', email: '' });
  const [quickCreateLoading, setQuickCreateLoading] = useState(false);

  const activeFilterGroups = useMemo(() =>
    groups.filter(g => g.type === 'filter' && groupHasFilters(g)), [groups]);

  const activeIndividualGroups = useMemo(() =>
    groups.filter(g => g.type === 'individual' && g.contactIds.length > 0), [groups]);

  const hasAnySelection = activeFilterGroups.length > 0 || activeIndividualGroups.length > 0;

  // Debounced per-group count fetch
  const groupKey = useMemo(() => JSON.stringify(groups.map(g => ({
    type: g.type, filters: g.filters, contactIds: g.contactIds,
  }))), [groups]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const counts: Record<string, number> = {};
      for (const g of groups) {
        if (g.type === 'individual') {
          counts[g.id] = g.contactIds.length;
          continue;
        }
        if (!groupHasFilters(g)) { counts[g.id] = 0; continue; }
        try {
          const payload = filtersToPayload(g.filters);
          const { data: res } = await api.post(`/campaigns/${campaignId}/preview-recipients-grouped`, {
            groups: [payload],
            combine: 'or',
          });
          counts[g.id] = res.total_count ?? 0;
        } catch { counts[g.id] = 0; }
      }
      setGroupCounts(counts);
      // Clear full preview when filters change
      setPreview(null);
      setShowPreviewTable(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [groupKey, campaignId]);

  const updateGroup = useCallback((id: string, updated: FilterGroup) => {
    setGroups(prev => prev.map(g => g.id === id ? updated : g));
  }, []);

  const removeGroup = useCallback((id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  const fetchFullPreview = async () => {
    setPreviewLoading(true);
    try {
      const filterPayloads = groups
        .filter(g => g.type === 'filter' && groupHasFilters(g))
        .map(g => filtersToPayload(g.filters));

      const individualIds = groups
        .filter(g => g.type === 'individual')
        .flatMap(g => g.contactIds);

      // If we have filter groups, use grouped endpoint
      if (filterPayloads.length > 0) {
        const { data: res } = await api.post(`/campaigns/${campaignId}/preview-recipients-grouped`, {
          groups: filterPayloads,
          combine: operator,
        });
        // Add individual contacts count
        res.total_count = (res.total_count || 0) + individualIds.length;
        setPreview(res);
      } else if (individualIds.length > 0) {
        setPreview({ total_count: individualIds.length, group_counts: [], contacts: [] });
      }
      setShowPreviewTable(true);
    } catch (err) {
      console.error('Preview failed:', err);
    }
    setPreviewLoading(false);
  };

  const commitRecipients = async () => {
    setAdding(true);
    try {
      const filterPayloads = groups
        .filter(g => g.type === 'filter' && groupHasFilters(g))
        .map(g => filtersToPayload(g.filters));

      const individualIds = groups
        .filter(g => g.type === 'individual')
        .flatMap(g => g.contactIds);

      await api.post(`/campaigns/${campaignId}/recipients`, {
        groups: filterPayloads.length > 0 ? filterPayloads : undefined,
        combine: filterPayloads.length > 0 ? operator : undefined,
        contact_ids: individualIds.length > 0 ? individualIds : undefined,
      });

      // Reset builder
      setGroups([newFilterGroup()]);
      setPreview(null);
      setShowPreviewTable(false);
      setGroupCounts({});
      onRecipientsAdded();
    } catch (err) {
      console.error('Add recipients failed:', err);
    }
    setAdding(false);
  };

  // Gap analysis
  const analyzeGaps = async () => {
    setGapLoading(true);
    try {
      const { data } = await api.get(`/campaigns/${campaignId}/gap-hints`);
      setGapHints(data);
    } catch { setGapHints(null); }
    setGapLoading(false);
  };

  const quickCreateContact = async () => {
    if (!quickCreateData.name || !quickCreateData.email) return;
    setQuickCreateLoading(true);
    try {
      const payload: QuickCreateContactRequest = {
        name: quickCreateData.name,
        email: quickCreateData.email,
        company_name: quickCreateForm?.company || undefined,
        job_title: quickCreateForm?.title || undefined,
        responsibility_domain: quickCreateForm?.domain || undefined,
      };
      await api.post('/contacts/quick-create', payload);
      setQuickCreateForm(null);
      setQuickCreateData({ name: '', email: '' });
      // Re-run gap analysis to refresh
      analyzeGaps();
    } catch (err: any) {
      alert(err.message || 'Failed to create contact');
    }
    setQuickCreateLoading(false);
  };

  const totalCount = preview?.total_count ?? null;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>
          <Filter size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
          Campaign Builder
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline" onClick={() => setGroups(prev => [...prev, newFilterGroup()])}
            disabled={groups.length >= 5}>
            <Plus size={14} /> Filter Group
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => setGroups(prev => [...prev, newIndividualGroup()])}>
            <UserPlus2 size={14} /> Individual Contacts
          </button>
        </div>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        {groups.map((group, idx) => (
          <React.Fragment key={group.id}>
            {idx > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0' }}>
                <div style={{ flex: 1, borderTop: '1px dashed #cbd5e0' }} />
                <button
                  onClick={() => setOperator(prev => prev === 'or' ? 'and' : 'or')}
                  style={{
                    margin: '0 12px', padding: '2px 16px', borderRadius: 12,
                    border: '1px solid #cbd5e0', background: operator === 'or' ? '#ebf8ff' : '#fefcbf',
                    color: operator === 'or' ? '#2b6cb0' : '#975a16',
                    fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  }}>
                  {operator.toUpperCase()}
                </button>
                <div style={{ flex: 1, borderTop: '1px dashed #cbd5e0' }} />
              </div>
            )}
            <FilterGroupCard
              group={group}
              index={idx}
              filterOptions={filterOptions}
              matchCount={groupCounts[group.id] ?? null}
              canRemove={groups.length > 1}
              onUpdate={updateGroup}
              onRemove={removeGroup}
            />
          </React.Fragment>
        ))}

        {/* Summary + Actions */}
        <div style={{
          marginTop: 16, padding: 12, background: '#edf2f7', borderRadius: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#2d3748' }}>
            {preview
              ? `Total unique matches: ${preview.total_count}`
              : hasAnySelection
                ? 'Click "Preview" to see combined results'
                : 'Add filters or contacts above'
            }
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={fetchFullPreview}
              disabled={!hasAnySelection || previewLoading}>
              {previewLoading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
              {' '}Preview
            </button>
            <button className="btn btn-sm btn-primary" onClick={commitRecipients}
              disabled={!preview || preview.total_count === 0 || adding}>
              {adding ? <Loader2 size={14} className="spin" /> : <Users size={14} />}
              {' '}Add {preview ? preview.total_count : ''} to Campaign
            </button>
          </div>
        </div>

        {/* Preview Table */}
        {showPreviewTable && preview && preview.contacts.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f7fafc' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Name</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Email</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Company</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Title</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Domain</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Country</th>
                </tr>
              </thead>
              <tbody>
                {preview.contacts.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid #edf2f7' }}>
                    <td style={{ padding: '4px 8px' }}>{c.full_name}</td>
                    <td style={{ padding: '4px 8px', color: '#718096' }}>{c.email}</td>
                    <td style={{ padding: '4px 8px' }}>{c.company_name}</td>
                    <td style={{ padding: '4px 8px' }}>{c.job_title}</td>
                    <td style={{ padding: '4px 8px' }}>{c.responsibility_domain}</td>
                    <td style={{ padding: '4px 8px' }}>{c.group_domicile}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total_count > 200 && (
              <p style={{ textAlign: 'center', color: '#a0aec0', fontSize: 11, padding: 4 }}>
                Showing 200 of {preview.total_count} matches
              </p>
            )}
          </div>
        )}

        {/* Gap Analysis */}
        <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={analyzeGaps} disabled={gapLoading}>
              {gapLoading ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />}
              {' '}Analyze Coverage Gaps
            </button>
            {gapHints && (
              <span style={{ fontSize: 12, color: '#718096' }}>
                {gapHints.summary.companies_with_gaps} of {gapHints.summary.companies_checked} companies have gaps
                — {gapHints.summary.total_critical} critical, {gapHints.summary.total_potential} potential
              </span>
            )}
          </div>

          {gapHints && gapHints.hints.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
              {gapHints.hints.map((h: any, i: number) => (
                <div key={i} style={{
                  padding: '8px 12px', background: i % 2 === 0 ? '#fff' : '#fafafa',
                  borderBottom: '1px solid #edf2f7', fontSize: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{h.company_name}</strong>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {h.critical_gap_count > 0 && (
                        <span className="badge" style={{ background: '#fed7d7', color: '#c53030', fontSize: 10 }}>
                          {h.critical_gap_count} critical
                        </span>
                      )}
                      {h.potential_gap_count > 0 && (
                        <span className="badge" style={{ background: '#fefcbf', color: '#975a16', fontSize: 10 }}>
                          {h.potential_gap_count} potential
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ color: '#718096', marginTop: 2 }}>
                    {h.missing_domains_critical.length > 0 && (
                      <span>Missing: {h.missing_domains_critical.join(', ')}</span>
                    )}
                    {h.missing_titles_critical.length > 0 && (
                      <span style={{ fontStyle: 'italic' }}>
                        {h.missing_domains_critical.length > 0 ? ' | ' : 'Missing: '}
                        {h.missing_titles_critical.join(', ')}
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ marginTop: 4, fontSize: 11, padding: '2px 8px', color: 'var(--accent)' }}
                    onClick={() => {
                      setQuickCreateForm({
                        company: h.company_name,
                        domain: h.missing_domains_critical[0] || '',
                        title: h.missing_titles_critical[0] || '',
                      });
                      setQuickCreateData({ name: '', email: '' });
                    }}>
                    + Create Contact
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick-create form */}
          {quickCreateForm && (
            <div style={{
              marginTop: 8, padding: 12, background: '#ebf8ff', borderRadius: 6,
              border: '1px solid #bee3f8',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                Create contact at {quickCreateForm.company}
                {quickCreateForm.domain && ` — ${quickCreateForm.domain}`}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input className="form-control" placeholder="Full name *" style={{ fontSize: 12 }}
                  value={quickCreateData.name}
                  onChange={(e) => setQuickCreateData(prev => ({ ...prev, name: e.target.value }))} />
                <input className="form-control" placeholder="Email *" style={{ fontSize: 12 }}
                  value={quickCreateData.email}
                  onChange={(e) => setQuickCreateData(prev => ({ ...prev, email: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={quickCreateContact}
                  disabled={!quickCreateData.name || !quickCreateData.email || quickCreateLoading}>
                  {quickCreateLoading ? 'Creating...' : 'Create'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => setQuickCreateForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
