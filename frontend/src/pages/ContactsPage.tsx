import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Contact, FilterOptions } from '../types';

type SortField = keyof Pick<
  Contact,
  'full_name' | 'company_name' | 'job_title' | 'responsibility_domain' |
  'group_domicile' | 'days_since_interaction' | 'revenue' | 'priority_score' | 'last_activity_date'
>;
type SortDir = 'asc' | 'desc';
type SortKey = { field: SortField; dir: SortDir };

const DATE_FIELDS: SortField[] = ['last_activity_date'];

function getValue(c: Contact, field: SortField): string | number | null {
  const v = c[field];
  if (v === null || v === undefined) return null;
  if (field === 'days_since_interaction' || field === 'revenue' || field === 'priority_score') return v as number;
  return String(v);
}

function sortContacts(contacts: Contact[], keys: SortKey[]): Contact[] {
  if (keys.length === 0) return contacts;
  return [...contacts].sort((a, b) => {
    for (const { field, dir } of keys) {
      const av = getValue(a, field);
      const bv = getValue(b, field);
      if (av === null && bv === null) continue;
      if (av === null) return 1;
      if (bv === null) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      }
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

interface SortableThProps {
  label: string;
  field: SortField;
  sortKeys: SortKey[];
  onSort: (field: SortField) => void;
}

function SortableTh({ label, field, sortKeys, onSort }: SortableThProps) {
  const idx = sortKeys.findIndex(k => k.field === field);
  const active = idx >= 0;
  const dir = active ? sortKeys[idx].dir : null;
  const priority = active ? idx + 1 : null;
  const multiLevel = sortKeys.length > 1;

  return (
    <th
      onClick={() => onSort(field)}
      title="Click to add/toggle sort · click ×3 to remove"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      <span style={{ marginLeft: 5, fontSize: 11, opacity: active ? 1 : 0.25 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
      {active && multiLevel && (
        <sup style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', marginLeft: 1, verticalAlign: 'super' }}>
          {priority}
        </sup>
      )}
    </th>
  );
}

export default function ContactsPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedBA, setSelectedBA] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedDomicile, setSelectedDomicile] = useState('');
  const [relevantOnly, setRelevantOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  useEffect(() => {
    api.get('/contacts/filters').then((r) => setFilters(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [page, search, selectedTier, selectedSector, selectedDomain, selectedBA, selectedTeam, selectedDomicile, relevantOnly]);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: 50 };
      if (search) params.search = search;
      if (selectedTier) params.client_tier = selectedTier;
      if (selectedSector) params.sector = selectedSector;
      if (selectedDomain) params.responsibility_domain = selectedDomain;
      if (selectedBA) params.owner_business_area = selectedBA;
      if (selectedTeam) params.owner_team = selectedTeam;
      if (selectedDomicile) params.group_domicile = selectedDomicile;
      if (relevantOnly) params.relevant_search = true;

      const res = await api.get('/contacts/', { params });
      setContacts(res.data.contacts);
      setTotal(res.data.total);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  const handlePin = async (contactId: number) => {
    await api.post(`/contacts/${contactId}/pin`);
    fetchContacts();
  };

  const handleSort = (field: SortField) => {
    setSortKeys(prev => {
      const idx = prev.findIndex(k => k.field === field);
      if (idx < 0) {
        // Not yet in stack: add as first level, default asc (desc for dates)
        const defaultDir: SortDir = DATE_FIELDS.includes(field) ? 'desc' : 'asc';
        return [...prev, { field, dir: defaultDir }];
      }
      const current = prev[idx].dir;
      if (current === 'asc') {
        // Toggle to desc
        return prev.map(k => k.field === field ? { ...k, dir: 'desc' as SortDir } : k);
      }
      // Remove from stack
      return prev.filter(k => k.field !== field);
    });
  };

  const sortedContacts = useMemo(() => sortContacts(contacts, sortKeys), [contacts, sortKeys]);

  const tierBadge = (tier?: string) => {
    if (!tier) return null;
    const cls = tier.toLowerCase().replace(/\s/g, '');
    return <span className={`badge badge-${cls}`}>{tier}</span>;
  };

  const pageCount = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header">
        <h2>Contacts</h2>
        <p>{total} contacts found</p>
      </div>

      <div className="card">
        <div className="filters-panel">
          <input
            className="form-control"
            placeholder="Search name, email, company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select
            className="form-control"
            value={selectedTier}
            onChange={(e) => { setSelectedTier(e.target.value); setPage(1); }}
          >
            <option value="">All Tiers</option>
            {filters?.client_tiers.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            className="form-control"
            value={selectedSector}
            onChange={(e) => { setSelectedSector(e.target.value); setPage(1); }}
          >
            <option value="">All Sectors</option>
            {filters?.sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="form-control"
            value={selectedDomain}
            onChange={(e) => { setSelectedDomain(e.target.value); setPage(1); }}
          >
            <option value="">All Domains</option>
            {filters?.responsibility_domains.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className="form-control"
            value={selectedBA}
            onChange={(e) => { setSelectedBA(e.target.value); setPage(1); }}
          >
            <option value="">All Business Areas</option>
            {filters?.business_areas.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            className="form-control"
            value={selectedTeam}
            onChange={(e) => { setSelectedTeam(e.target.value); setPage(1); }}
          >
            <option value="">All Teams</option>
            {filters?.teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            className="form-control"
            value={selectedDomicile}
            onChange={(e) => { setSelectedDomicile(e.target.value); setPage(1); }}
          >
            <option value="">All Domiciles</option>
            {filters?.group_domiciles.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            className={`btn btn-sm ${relevantOnly ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setRelevantOnly(v => !v); setPage(1); }}
            title="Show only contacts pre-classified as relevant for Global Risk"
          >
            {relevantOnly ? '✓ Relevant Search' : 'Relevant Search'}
          </button>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th></th>
                <SortableTh label="Name" field="full_name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Company" field="company_name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Title" field="job_title" sortKeys={sortKeys} onSort={handleSort} />
                <th>Tier</th>
                <SortableTh label="Domain" field="responsibility_domain" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Domicile" field="group_domicile" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Last Activity" field="last_activity_date" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Days Since" field="days_since_interaction" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Revenue" field="revenue" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Score" field="priority_score" sortKeys={sortKeys} onSort={handleSort} />
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="empty-state">Loading...</td></tr>
              ) : sortedContacts.length === 0 ? (
                <tr><td colSpan={12} className="empty-state">No contacts found. Upload a contacts file to get started.</td></tr>
              ) : (
                sortedContacts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {['team_manager', 'ba_manager', 'admin'].includes(user?.role || '') && (
                        <button
                          className="btn-icon"
                          onClick={() => handlePin(c.id)}
                          title={c.is_pinned ? 'Unpin' : 'Pin to top'}
                        >
                          {c.is_pinned ? '📌' : '📍'}
                        </button>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.full_name || `${c.first_name} ${c.last_name}`}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>{c.email}</div>
                    </td>
                    <td>
                      <div>{c.company_name}</div>
                      {c.client_name && c.client_name !== c.company_name && (
                        <div style={{ fontSize: 12, color: '#718096' }}>{c.client_name}</div>
                      )}
                    </td>
                    <td>{c.job_title}</td>
                    <td>{tierBadge(c.client_tier)}</td>
                    <td>{c.responsibility_domain}</td>
                    <td>{c.group_domicile}</td>
                    <td>
                      {c.last_activity_date ? new Date(c.last_activity_date).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      {c.days_since_interaction != null ? `${c.days_since_interaction}d` : '—'}
                    </td>
                    <td>
                      {c.revenue != null
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(c.revenue)
                        : c.has_historical_revenue ? 'Yes' : '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {c.priority_score != null ? c.priority_score.toFixed(2) : '—'}
                    </td>
                    <td>{c.owner_name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="pagination">
            <span>Page {page} of {pageCount} ({total} contacts)</span>
            <div className="pagination-buttons">
              <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn btn-sm btn-outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
