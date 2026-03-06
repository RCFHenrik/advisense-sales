import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { OutreachRecord, Employee } from '../types';

interface ConsultantSummary {
  employee_id: number;
  employee_name: string;
  team_name: string;
  business_area_name: string;
  outreach_target_per_week: number;
  outreach_target_per_month: number | null;
  total: number;
  proposed: number;
  accepted: number;
  sent: number;
  negated: number;
  sent_7d: number;
  sent_30d: number;
}

function objBadge(sent: number, target: number | null): JSX.Element {
  if (!target) return <span style={{ color: '#a0aec0' }}>—</span>;
  const pct = sent / target;
  const color = pct >= 1 ? '#38a169' : pct >= 0.5 ? '#dd6b20' : '#e53e3e';
  return <span style={{ color, fontWeight: 600 }}>{sent}/{target}</span>;
}

type SortDir = 'asc' | 'desc';
type SortKey = string;

function SortableTh({
  label, sortKey, sort, onSort, style,
}: {
  label: string;
  sortKey: SortKey;
  sort: [SortKey, SortDir][];
  onSort: (key: SortKey) => void;
  style?: React.CSSProperties;
}) {
  const entry = sort.find(([k]) => k === sortKey);
  const dir = entry?.[1];
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none', ...style }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: 0.5 }}>{dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}</span>
    </th>
  );
}

const STATUS_OPTIONS = [
  'proposed', 'accepted', 'draft', 'prepared', 'sent', 'replied',
  'meeting_booked', 'negated', 'closed_met', 'closed_no_response',
  'closed_not_relevant', 'closed_bounced',
];

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'overview' | 'detail'>('overview');

  // Shared reference data
  const [summary, setSummary] = useState<ConsultantSummary[]>([]);
  const [consultants, setConsultants] = useState<Employee[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Overview filters (client-side)
  const [ovBA, setOvBA] = useState('');
  const [ovTeam, setOvTeam] = useState('');
  const [ovSort, setOvSort] = useState<[SortKey, SortDir][]>([]);

  // Detail tab filters (server-side)
  const [records, setRecords] = useState<OutreachRecord[]>([]);
  const [detPage, setDetPage] = useState(1);
  const [detStatus, setDetStatus] = useState('');
  const [detEmployee, setDetEmployee] = useState<number | ''>('');
  const [detTeam, setDetTeam] = useState<number | ''>('');
  const [detBA, setDetBA] = useState<number | ''>('');
  const [detSort, setDetSort] = useState<[SortKey, SortDir][]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load consultant summary and employee list on mount
  useEffect(() => {
    setLoadingSummary(true);
    Promise.all([
      api.get('/dashboard/consultant-summary'),
      api.get('/employees/'),
    ]).then(([r1, r2]) => {
      setSummary(r1.data);
      setConsultants(r2.data);
    }).catch(() => {}).finally(() => setLoadingSummary(false));
  }, []);

  // Derive unique teams and BAs from employees list
  const teamOptions = useMemo(() => {
    const seen = new Map<number, string>();
    consultants.forEach(e => { if (e.team_id && e.team_name) seen.set(e.team_id, e.team_name); });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [consultants]);

  const baOptions = useMemo(() => {
    const seen = new Map<number, string>();
    consultants.forEach(e => { if (e.business_area_id && e.business_area_name) seen.set(e.business_area_id, e.business_area_name); });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [consultants]);

  // Filter summary client-side
  const filteredSummary = useMemo(() => {
    let rows = summary;
    if (ovBA) rows = rows.filter(r => r.business_area_name === ovBA);
    if (ovTeam) rows = rows.filter(r => r.team_name === ovTeam);
    if (ovSort.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const [key, dir] of ovSort) {
          const av = (a as any)[key] ?? '';
          const bv = (b as any)[key] ?? '';
          const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }
    return rows;
  }, [summary, ovBA, ovTeam, ovSort]);

  const totals = useMemo(() => ({
    total: filteredSummary.reduce((s, r) => s + r.total, 0),
    proposed: filteredSummary.reduce((s, r) => s + r.proposed, 0),
    accepted: filteredSummary.reduce((s, r) => s + r.accepted, 0),
    sent: filteredSummary.reduce((s, r) => s + r.sent, 0),
    negated: filteredSummary.reduce((s, r) => s + r.negated, 0),
    sent_7d: filteredSummary.reduce((s, r) => s + r.sent_7d, 0),
    sent_30d: filteredSummary.reduce((s, r) => s + r.sent_30d, 0),
  }), [filteredSummary]);

  // Fetch detail records when detail tab is active (fetch up to 200 at once, paginate client-side)
  useEffect(() => {
    if (activeTab !== 'detail') return;
    setLoadingDetail(true);
    setDetPage(1);
    const params: any = { page: 1, page_size: 200 };
    if (detStatus) params.status = detStatus;
    if (detEmployee !== '') params.employee_id = detEmployee;
    if (detTeam !== '') params.team_id = detTeam;
    if (detBA !== '') params.business_area_id = detBA;
    api.get('/outreach/', { params })
      .then(r => { setRecords(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, [activeTab, detStatus, detEmployee, detTeam, detBA]);

  // Sort + paginate detail records client-side
  const sortedRecords = useMemo(() => {
    if (detSort.length === 0) return records;
    return [...records].sort((a, b) => {
      for (const [key, dir] of detSort) {
        const av = (a as any)[key] ?? '';
        const bv = (b as any)[key] ?? '';
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [records, detSort]);

  const pagedRecords = useMemo(
    () => sortedRecords.slice((detPage - 1) * 50, detPage * 50),
    [sortedRecords, detPage],
  );

  const handleOvSort = (key: SortKey) => {
    setOvSort(prev => {
      const existing = prev.find(([k]) => k === key);
      if (!existing) return [[key, 'asc']];
      if (existing[1] === 'asc') return prev.map(([k, d]) => k === key ? [k, 'desc'] : [k, d]) as [SortKey, SortDir][];
      return prev.filter(([k]) => k !== key);
    });
  };

  const handleDetSort = (key: SortKey) => {
    setDetSort(prev => {
      const existing = prev.find(([k]) => k === key);
      if (!existing) return [[key, 'asc']];
      if (existing[1] === 'asc') return prev.map(([k, d]) => k === key ? [k, 'desc'] : [k, d]) as [SortKey, SortDir][];
      return prev.filter(([k]) => k !== key);
    });
  };

  const drillToDetail = (employeeId: number) => {
    setDetEmployee(employeeId);
    setDetPage(1);
    setDetStatus('');
    setDetTeam('');
    setDetBA('');
    setActiveTab('detail');
  };

  const detPageCount = Math.ceil(sortedRecords.length / 50);

  const subtitle =
    user?.role === 'consultant' ? 'Your personal sales activity' :
    user?.role === 'team_manager' ? 'Your team\'s sales activity' :
    user?.role === 'ba_manager' ? 'Business area overview' :
    'Full sales coordination overview';

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>{subtitle}</p>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          Overview
        </button>
        <button className={`tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
          Detail
        </button>
      </div>

      {/* ─── Overview Tab ─────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="card">
          <div className="filters-panel" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, max-content))' }}>
            <select
              className="form-control"
              value={ovBA}
              onChange={e => { setOvBA(e.target.value); setOvTeam(''); }}
            >
              <option value="">All Business Areas</option>
              {baOptions.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
            <select
              className="form-control"
              value={ovTeam}
              onChange={e => setOvTeam(e.target.value)}
            >
              <option value="">All Teams</option>
              {teamOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>

          <div className="table-wrapper">
            {loadingSummary ? (
              <div className="empty-state">Loading...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Consultant" sortKey="employee_name" sort={ovSort} onSort={handleOvSort} />
                    <SortableTh label="Business Area" sortKey="business_area_name" sort={ovSort} onSort={handleOvSort} />
                    <SortableTh label="Team" sortKey="team_name" sort={ovSort} onSort={handleOvSort} />
                    <SortableTh label="Proposed" sortKey="proposed" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Accepted" sortKey="accepted" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Sent" sortKey="sent" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Week Obj ↑" sortKey="sent_7d" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Month Obj ↑" sortKey="sent_30d" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Negated" sortKey="negated" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                    <SortableTh label="Total" sortKey="total" sort={ovSort} onSort={handleOvSort} style={{ textAlign: 'right' }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.length === 0 ? (
                    <tr><td colSpan={10} className="empty-state">No data found.</td></tr>
                  ) : (
                    filteredSummary.map(r => (
                      <tr key={r.employee_id}>
                        <td>
                          <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-light)', fontWeight: 500, padding: 0, fontSize: 13 }}
                            onClick={() => drillToDetail(r.employee_id)}
                            title="View outreach detail for this consultant"
                          >
                            {r.employee_name}
                          </button>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.business_area_name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.team_name || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.proposed > 0 ? <span className="badge badge-proposed">{r.proposed}</span> : <span style={{ color: '#a0aec0' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.accepted > 0 ? <span className="badge badge-accepted">{r.accepted}</span> : <span style={{ color: '#a0aec0' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.sent > 0 ? <span className="badge badge-sent">{r.sent}</span> : <span style={{ color: '#a0aec0' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {objBadge(r.sent_7d, r.outreach_target_per_week)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {objBadge(r.sent_30d, r.outreach_target_per_month)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.negated > 0 ? <span className="badge badge-negated">{r.negated}</span> : <span style={{ color: '#a0aec0' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.total || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredSummary.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: '#f8fafc', fontWeight: 600 }}>
                      <td colSpan={3} style={{ fontSize: 13 }}>Totals — {filteredSummary.length} consultant{filteredSummary.length !== 1 ? 's' : ''}</td>
                      <td style={{ textAlign: 'right' }}>{totals.proposed}</td>
                      <td style={{ textAlign: 'right' }}>{totals.accepted}</td>
                      <td style={{ textAlign: 'right' }}>{totals.sent}</td>
                      <td style={{ textAlign: 'right', color: '#a0aec0' }}>{totals.sent_7d}</td>
                      <td style={{ textAlign: 'right', color: '#a0aec0' }}>{totals.sent_30d}</td>
                      <td style={{ textAlign: 'right' }}>{totals.negated}</td>
                      <td style={{ textAlign: 'right' }}>{totals.total}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* ─── Detail Tab ───────────────────────────────────────── */}
      {activeTab === 'detail' && (
        <div className="card">
          <div className="filters-panel">
            <select
              className="form-control"
              value={detStatus}
              onChange={e => { setDetStatus(e.target.value); setDetPage(1); }}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              className="form-control"
              value={detEmployee}
              onChange={e => { setDetEmployee(e.target.value === '' ? '' : Number(e.target.value)); setDetPage(1); }}
            >
              <option value="">All Consultants</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="form-control"
              value={detBA}
              onChange={e => { setDetBA(e.target.value === '' ? '' : Number(e.target.value)); setDetPage(1); }}
            >
              <option value="">All Business Areas</option>
              {baOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              className="form-control"
              value={detTeam}
              onChange={e => { setDetTeam(e.target.value === '' ? '' : Number(e.target.value)); setDetPage(1); }}
            >
              <option value="">All Teams</option>
              {teamOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="table-wrapper">
            {loadingDetail ? (
              <div className="empty-state">Loading...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <SortableTh label="Consultant" sortKey="employee_name" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Business Area" sortKey="business_area_name" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Team" sortKey="team_name" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Contact" sortKey="contact_name" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Company" sortKey="contact_company" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Status" sortKey="status" sort={detSort} onSort={handleDetSort} />
                    <SortableTh label="Created" sortKey="created_at" sort={detSort} onSort={handleDetSort} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRecords.length === 0 ? (
                    <tr><td colSpan={8} className="empty-state">No records found.</td></tr>
                  ) : (
                    pagedRecords.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/outreach/${r.id}`)}>
                        <td style={{ fontSize: 13 }}>{r.employee_name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.business_area_name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.team_name || '—'}</td>
                        <td style={{ fontWeight: 500, fontSize: 13 }}>{r.contact_name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.contact_company || '—'}</td>
                        <td>
                          <span className={`badge badge-${r.status}`}>{r.status.replace(/_/g, ' ')}</span>
                        </td>
                        <td style={{ fontSize: 13 }}>{new Date(r.created_at).toLocaleDateString()}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/outreach/${r.id}`)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {detPageCount > 1 && (
            <div className="pagination">
              <span>Page {detPage} of {detPageCount} ({sortedRecords.length} records)</span>
              <div className="pagination-buttons">
                <button className="btn btn-sm btn-outline" disabled={detPage <= 1} onClick={() => setDetPage(detPage - 1)}>
                  Previous
                </button>
                <button className="btn btn-sm btn-outline" disabled={detPage >= detPageCount} onClick={() => setDetPage(detPage + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
