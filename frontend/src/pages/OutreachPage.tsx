import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { OutreachRecord, OutreachStatus } from '../types';
import { formatDate } from '../utils/dateFormat';
import MultiSelectFilter from '../components/MultiSelectFilter';
import ActiveFiltersBar from '../components/ActiveFiltersBar';

const STATUS_OPTIONS: OutreachStatus[] = [
  'proposed', 'accepted', 'draft', 'prepared', 'sent',
  'replied', 'meeting_booked', 'negated', 'closed_no_response',
];

const STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  draft: 'Draft',
  prepared: 'Prepared',
  sent: 'Sent',
  replied: 'Replied',
  meeting_booked: 'Meeting Booked',
  negated: 'Negated',
  closed_no_response: 'Closed - No Response',
};

type SortField =
  | 'contact_name'
  | 'contact_job_title'
  | 'contact_company'
  | 'employee_name'
  | 'status'
  | 'recommendation_score'
  | 'sent_at'
  | 'outcome'
  | 'updated_at';
type SortDir = 'asc' | 'desc';

// Date and score fields default to descending
const DESC_FIELDS: SortField[] = ['sent_at', 'updated_at', 'recommendation_score'];

// ── Sortable header ───────────────────────────────────────────────────────────
interface SortableThProps {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
}

function SortableTh({ label, field, currentField, currentDir, onSort }: SortableThProps) {
  const active = field === currentField;
  return (
    <th
      onClick={() => onSort(field)}
      title="Click to sort by this column"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      <span style={{ marginLeft: 5, fontSize: 11, opacity: active ? 1 : 0.25 }}>
        {active ? (currentDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}

// ── Page size options ─────────────────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [50, 100, 200];

// ── Filter options from API ───────────────────────────────────────────────────
interface FilterOptions {
  statuses: string[];
  consultants: Array<{ id: number; name: string }>;
  companies: string[];
  business_areas: Array<{ id: number; name: string }>;
  teams: Array<{ id: number; name: string }>;
  outcomes: string[];
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function OutreachPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<OutreachRecord[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{
    created: number; consultants_used: number; contacts_evaluated: number;
    contacts_skipped_cooldown: number; contacts_skipped_no_match: number;
    per_consultant_cap: number;
  } | null>(null);

  // Filter options from API
  const [filterOpts, setFilterOpts] = useState<FilterOptions | null>(null);

  // Multi-select filter state
  const [selStatuses, setSelStatuses] = useState<string[]>([]);
  const [selConsultants, setSelConsultants] = useState<string[]>([]);
  const [selCompanies, setSelCompanies] = useState<string[]>([]);
  const [selBAs, setSelBAs] = useState<string[]>([]);
  const [selTeams, setSelTeams] = useState<string[]>([]);
  const [selOutcomes, setSelOutcomes] = useState<string[]>([]);

  // Server-side sorting
  const [sortField, setSortField] = useState<SortField>('recommendation_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Load filter options once
  useEffect(() => {
    api.get('/outreach/filters').then((res) => setFilterOpts(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [selStatuses, selConsultants, selCompanies, selBAs, selTeams, selOutcomes, searchQuery, sortField, sortDir, page, pageSize]);

  // Debounced search
  const handleSearchInput = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 400);
  }, []);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        page_size: pageSize,
        sort_by: sortField,
        sort_dir: sortDir,
      };
      if (selStatuses.length > 0) params.statuses = selStatuses.join(',');
      if (selConsultants.length > 0) {
        // Map consultant names to IDs
        const ids = selConsultants
          .map((name) => filterOpts?.consultants.find((c) => c.name === name)?.id)
          .filter(Boolean);
        if (ids.length) params.employee_ids = ids.join(',');
      }
      if (selCompanies.length > 0) params.companies = selCompanies.join(',');
      if (selBAs.length > 0) {
        const ids = selBAs
          .map((name) => filterOpts?.business_areas.find((b) => b.name === name)?.id)
          .filter(Boolean);
        if (ids.length) params.ba_ids = ids.join(',');
      }
      if (selTeams.length > 0) {
        const ids = selTeams
          .map((name) => filterOpts?.teams.find((t) => t.name === name)?.id)
          .filter(Boolean);
        if (ids.length) params.team_ids = ids.join(',');
      }
      if (selOutcomes.length > 0) params.outcomes = selOutcomes.join(',');
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.get('/outreach/', { params });
      const data = res.data;
      setRecords(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateResult(null);
    try {
      const res = await api.post('/outreach/generate-proposals', {});
      setGenerateResult(res.data);
      setPage(1);
      fetchRecords();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to generate proposals');
    } finally {
      setGenerating(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      const defaultDir: SortDir = DESC_FIELDS.includes(field) ? 'desc' : 'asc';
      setSortField(field);
      setSortDir(defaultDir);
    }
    setPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  // Reset page on filter change
  const updateFilter = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) => (val: T) => {
    setter(val);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSelStatuses([]);
    setSelConsultants([]);
    setSelCompanies([]);
    setSelBAs([]);
    setSelTeams([]);
    setSelOutcomes([]);
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
  };

  const hasAnyFilter = selStatuses.length > 0 || selConsultants.length > 0 || selCompanies.length > 0 ||
    selBAs.length > 0 || selTeams.length > 0 || selOutcomes.length > 0 || searchInput;

  // Build filter chips for ActiveFiltersBar
  const filterChips = [
    ...selStatuses.map((v) => ({
      category: 'Status',
      value: STATUS_LABELS[v] || v,
      onRemove: () => setSelStatuses((prev) => prev.filter((x) => x !== v)),
    })),
    ...selConsultants.map((v) => ({
      category: 'Consultant',
      value: v,
      onRemove: () => setSelConsultants((prev) => prev.filter((x) => x !== v)),
    })),
    ...selCompanies.map((v) => ({
      category: 'Company',
      value: v,
      onRemove: () => setSelCompanies((prev) => prev.filter((x) => x !== v)),
    })),
    ...selBAs.map((v) => ({
      category: 'Business Area',
      value: v,
      onRemove: () => setSelBAs((prev) => prev.filter((x) => x !== v)),
    })),
    ...selTeams.map((v) => ({
      category: 'Team',
      value: v,
      onRemove: () => setSelTeams((prev) => prev.filter((x) => x !== v)),
    })),
    ...selOutcomes.map((v) => ({
      category: 'Outcome',
      value: v,
      onRemove: () => setSelOutcomes((prev) => prev.filter((x) => x !== v)),
    })),
  ];

  const thProps = (label: string, field: SortField) => ({
    label,
    field,
    currentField: sortField,
    currentDir: sortDir,
    onSort: handleSort,
  });

  // Pagination range display
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div>
      <div className="page-header">
        <h2>Outreach</h2>
        <p>Manage outreach proposals and communications</p>
      </div>

      <div className="toolbar">
        <div className="search-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search contact, title, company or consultant..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            style={{ minWidth: 220, maxWidth: 300 }}
          />
          {filterOpts && (
            <>
              <MultiSelectFilter
                options={STATUS_OPTIONS.map((s) => STATUS_LABELS[s] || s)}
                selected={selStatuses.map((s) => STATUS_LABELS[s] || s)}
                onChange={(labels) => {
                  const values = labels.map((l) => {
                    const entry = Object.entries(STATUS_LABELS).find(([, v]) => v === l);
                    return entry ? entry[0] : l;
                  });
                  updateFilter(setSelStatuses)(values);
                }}
                placeholder="Status"
              />
              <MultiSelectFilter
                options={filterOpts.consultants.map((c) => c.name)}
                selected={selConsultants}
                onChange={updateFilter(setSelConsultants)}
                placeholder="Consultant"
              />
              <MultiSelectFilter
                options={filterOpts.companies}
                selected={selCompanies}
                onChange={updateFilter(setSelCompanies)}
                placeholder="Company"
              />
              <MultiSelectFilter
                options={filterOpts.business_areas.map((b) => b.name)}
                selected={selBAs}
                onChange={updateFilter(setSelBAs)}
                placeholder="Business Area"
              />
              <MultiSelectFilter
                options={filterOpts.teams.map((t) => t.name)}
                selected={selTeams}
                onChange={updateFilter(setSelTeams)}
                placeholder="Team"
              />
              {filterOpts.outcomes.length > 0 && (
                <MultiSelectFilter
                  options={filterOpts.outcomes}
                  selected={selOutcomes}
                  onChange={updateFilter(setSelOutcomes)}
                  placeholder="Outcome"
                />
              )}
            </>
          )}
          {hasAnyFilter && (
            <button
              className="btn btn-sm btn-outline"
              onClick={clearAllFilters}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {['admin', 'ba_manager'].includes(user?.role || '') && (
            <button className="btn btn-accent" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Proposals'}
            </button>
          )}
        </div>
      </div>

      <ActiveFiltersBar chips={filterChips} onClearAll={clearAllFilters} />

      {generateResult && (
        <div style={{
          marginBottom: 16, padding: '12px 16px', background: '#f0fff4',
          border: '1px solid #c6f6d5', borderRadius: 8, fontSize: 13,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: 14 }}>
                {generateResult.created} proposals created
              </strong>
              {' '}across {generateResult.consultants_used} consultants
              <span style={{ color: '#718096', marginLeft: 8 }}>
                (cap: {generateResult.per_consultant_cap} per consultant)
              </span>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setGenerateResult(null)}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ color: '#4a5568', marginTop: 4, fontSize: 12 }}>
            {generateResult.contacts_evaluated} contacts evaluated
            {generateResult.contacts_skipped_cooldown > 0 && (
              <> · {generateResult.contacts_skipped_cooldown} skipped (cooldown)</>
            )}
            {generateResult.contacts_skipped_no_match > 0 && (
              <> · {generateResult.contacts_skipped_no_match} skipped (no matching consultant)</>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableTh {...thProps('Contact', 'contact_name')} />
                <SortableTh {...thProps('Title', 'contact_job_title')} />
                <SortableTh {...thProps('Company', 'contact_company')} />
                <SortableTh {...thProps('Consultant', 'employee_name')} />
                <SortableTh {...thProps('Status', 'status')} />
                <SortableTh {...thProps('Score', 'recommendation_score')} />
                <SortableTh {...thProps('Sent', 'sent_at')} />
                <SortableTh {...thProps('Outcome', 'outcome')} />
                <SortableTh {...thProps('Updated', 'updated_at')} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="empty-state">Loading...</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={10} className="empty-state">No outreach records found. Generate proposals to get started.</td></tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.contact_name || `Contact #${r.contact_id}`}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>{r.contact_email}</div>
                    </td>
                    <td style={{ fontSize: 13, color: '#4a5568' }}>{r.contact_job_title || '—'}</td>
                    <td style={{ fontSize: 13 }}>{r.contact_company}</td>
                    <td>{r.employee_name}</td>
                    <td>
                      <span className={`badge badge-${r.status}`}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>{r.recommendation_score?.toFixed(0) || '—'}</td>
                    <td style={{ fontSize: 13 }}>
                      {formatDate(r.sent_at)}
                    </td>
                    <td style={{ fontSize: 13 }}>{r.outcome || '—'}</td>
                    <td style={{ fontSize: 12, color: '#718096' }}>
                      {formatDate(r.updated_at)}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => navigate(`/outreach/${r.id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {total > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid #e2e8f0',
            fontSize: 13,
            color: '#4a5568',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}</span>
              <span style={{ color: '#a0aec0' }}>·</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                style={{
                  fontSize: 13,
                  padding: '2px 6px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 4,
                  background: '#fff',
                }}
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s} per page</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setPage(1)}
                disabled={page <= 1}
                style={{ padding: '4px 8px', fontSize: 12 }}
                title="First page"
              >
                «
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ padding: '4px 8px', fontSize: 12 }}
              >
                ‹ Prev
              </button>

              {/* Page number buttons */}
              {(() => {
                const pages: number[] = [];
                const maxButtons = 7;
                let start = Math.max(1, page - Math.floor(maxButtons / 2));
                let end = Math.min(totalPages, start + maxButtons - 1);
                if (end - start + 1 < maxButtons) {
                  start = Math.max(1, end - maxButtons + 1);
                }
                for (let i = start; i <= end; i++) pages.push(i);
                return pages.map((p) => (
                  <button
                    key={p}
                    className={`btn btn-sm ${p === page ? 'btn-accent' : 'btn-outline'}`}
                    onClick={() => setPage(p)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      minWidth: 32,
                      fontWeight: p === page ? 600 : 400,
                    }}
                  >
                    {p}
                  </button>
                ));
              })()}

              <button
                className="btn btn-sm btn-outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ padding: '4px 8px', fontSize: 12 }}
              >
                Next ›
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                style={{ padding: '4px 8px', fontSize: 12 }}
                title="Last page"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
