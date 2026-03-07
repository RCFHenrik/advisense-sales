import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { OutreachRecord, OutreachStatus } from '../types';
import { formatDate } from '../utils/dateFormat';

const STATUS_OPTIONS: { value: OutreachStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'draft', label: 'Draft' },
  { value: 'prepared', label: 'Prepared' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
  { value: 'meeting_booked', label: 'Meeting Booked' },
  { value: 'negated', label: 'Negated' },
  { value: 'closed_no_response', label: 'Closed - No Response' },
];

type SortField = keyof Pick<
  OutreachRecord,
  'contact_name' | 'contact_job_title' | 'contact_company' | 'employee_name' | 'status' |
  'recommendation_score' | 'sent_at' | 'outcome' | 'updated_at'
>;
type SortDir = 'asc' | 'desc';
type SortKey = { field: SortField; dir: SortDir };

// Date fields default to descending (newest first)
const DATE_FIELDS: SortField[] = ['sent_at', 'updated_at'];

function getValue(r: OutreachRecord, field: SortField): string | number | null {
  const v = r[field];
  if (v === null || v === undefined) return null;
  if (field === 'recommendation_score') return v as number;
  return String(v);
}

function sortRecords(records: OutreachRecord[], keys: SortKey[]): OutreachRecord[] {
  if (keys.length === 0) return records;
  return [...records].sort((a, b) => {
    for (const { field, dir } of keys) {
      const av = getValue(a, field);
      const bv = getValue(b, field);
      if (av === null && bv === null) continue;
      if (av === null) return 1;   // nulls always last
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

// ── Sortable header ───────────────────────────────────────────────────────────
// Click once  → add this column as the next sort level (asc / desc for dates)
// Click again → toggle direction
// Click again → remove from sort stack
// Priority badge (1, 2, …) shows when multiple levels are active
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
        <sup style={{
          fontSize: 9,
          fontWeight: 700,
          color: '#4a5568',
          marginLeft: 1,
          verticalAlign: 'super',
        }}>
          {priority}
        </sup>
      )}
    </th>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function OutreachPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<OutreachRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: 'updated_at', dir: 'desc' }]);

  useEffect(() => { fetchRecords(); }, [statusFilter]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params: any = { page_size: 100 };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/outreach/', { params });
      setRecords(res.data);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.post('/outreach/generate-proposals', { limit: 20 });
      fetchRecords();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to generate proposals');
    } finally {
      setGenerating(false);
    }
  };

  const handleSort = (field: SortField) => {
    setSortKeys(prev => {
      const idx = prev.findIndex(k => k.field === field);
      const defaultDir: SortDir = DATE_FIELDS.includes(field) ? 'desc' : 'asc';
      const altDir: SortDir = defaultDir === 'asc' ? 'desc' : 'asc';

      if (idx === -1) {
        // Not in stack → append with default direction
        return [...prev, { field, dir: defaultDir }];
      }
      if (prev[idx].dir === defaultDir) {
        // First click on active column → flip to alternate direction
        return prev.map((k, i) => i === idx ? { ...k, dir: altDir } : k);
      }
      // Second click on active column → remove from stack
      return prev.filter((_, i) => i !== idx);
    });
  };

  const sortedRecords = useMemo(() => sortRecords(records, sortKeys), [records, sortKeys]);

  const thProps = (label: string, field: SortField) => ({ label, field, sortKeys, onSort: handleSort });

  return (
    <div>
      <div className="page-header">
        <h2>Outreach</h2>
        <p>Manage outreach proposals and communications</p>
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sortKeys.length > 0 && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setSortKeys([])}
              title="Clear all sorting"
            >
              Clear sort
            </button>
          )}
          {['admin', 'ba_manager'].includes(user?.role || '') && (
            <button className="btn btn-accent" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Proposals'}
            </button>
          )}
        </div>
      </div>

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
              ) : sortedRecords.length === 0 ? (
                <tr><td colSpan={10} className="empty-state">No outreach records found. Generate proposals to get started.</td></tr>
              ) : (
                sortedRecords.map((r) => (
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
      </div>
    </div>
  );
}
