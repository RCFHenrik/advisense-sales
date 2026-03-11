import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { OutreachRecord, Employee, FilterOptions, AnalyticsData } from '../types';
import { formatDate } from '../utils/dateFormat';
import MultiSelectFilter from '../components/MultiSelectFilter';
import ActiveFiltersBar from '../components/ActiveFiltersBar';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
  ResponsiveContainer,
} from 'recharts';

// ── Chart color palette — Advisense brand ───────────────────────────
const CHART_COLORS = [
  '#69D4AE', // teal (brand accent)
  '#e07c24', // warm orange
  '#5b7fb5', // soft blue
  '#a78bdb', // soft purple
  '#e5534b', // warm red
  '#3ba5a8', // dark teal
  '#d4915e', // amber
  '#7ec47e', // green
  '#c77dba', // rose
  '#8b9dc3', // slate blue
  '#d4a85c', // gold
  '#6baed6', // sky blue
];

// Merge tiny pie slices (< threshold%) into "Other"
function mergeSmallSlices(
  data: { label: string; value: number }[],
  thresholdPct: number = 3,
): { label: string; value: number }[] {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return data;
  const big: typeof data = [];
  let otherSum = 0;
  for (const d of data) {
    if ((d.value / total) * 100 >= thresholdPct) {
      big.push(d);
    } else {
      otherSum += d.value;
    }
  }
  if (otherSum > 0) big.push({ label: 'Other', value: otherSum });
  return big;
}

// Custom pie label — only show for slices above a threshold
function makePieLabel(minPct: number) {
  return ({ label, percent, cx, x, y }: any) => {
    if (percent < minPct / 100) return null;
    const textAnchor = x > cx ? 'start' : 'end';
    return (
      <text
        x={x} y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        style={{ fontSize: 11, fill: '#4a4a4a', fontWeight: 500 }}
      >
        {label} ({(percent * 100).toFixed(0)}%)
      </text>
    );
  };
}

const TIME_PERIOD_OPTIONS = [
  { value: 'last_week', label: 'Last Week' },
  { value: 'last_2_weeks', label: 'Last 2 Weeks' },
  { value: 'last_3_weeks', label: 'Last 3 Weeks' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'last_3_years', label: 'Last 3 Years' },
  { value: 'last_5_years', label: 'Last 5 Years' },
  { value: 'ever', label: 'Ever' },
];

// ── Consultant Summary ───────────────────────────────────────────────
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
  if (!target) return <span style={{ color: '#9a9a9a' }}>—</span>;
  const pct = sent / target;
  const color = pct >= 1 ? '#48bb78' : pct >= 0.5 ? '#e07c24' : '#e5534b';
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

// Custom tooltip for status bar chart
function StatusBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'white', border: '1px solid var(--border, #e5e4e1)', borderRadius: 8,
      padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: '#1c1c1c' }}>
        {String(label).replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: 13, color: '#69D4AE', fontWeight: 600 }}>
        Count: {payload[0].value}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'analytics' | 'team' | 'detail'>('analytics');

  // Shared reference data
  const [summary, setSummary] = useState<ConsultantSummary[]>([]);
  const [consultants, setConsultants] = useState<Employee[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // ── Analytics state ──
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [timePeriod, setTimePeriod] = useState('last_month');
  const [filterDomain, setFilterDomain] = useState<string[]>([]);
  const [filterCountry, setFilterCountry] = useState<string[]>([]);
  const [filterTier, setFilterTier] = useState<string[]>([]);
  const [filterSector, setFilterSector] = useState<string[]>([]);
  const [filterBA, setFilterBA] = useState<string[]>([]);
  const [filterTeam, setFilterTeam] = useState<string[]>([]);
  const [filterConsultant, setFilterConsultant] = useState<number | ''>('');
  const [filterDecisionMaker, setFilterDecisionMaker] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  // Team tab filters (client-side)
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

  // Load consultant summary, employee list, and filter options on mount
  useEffect(() => {
    setLoadingSummary(true);
    Promise.all([
      api.get('/dashboard/consultant-summary'),
      api.get('/employees/'),
      api.get('/contacts/filters'),
    ]).then(([r1, r2, r3]) => {
      setSummary(r1.data);
      setConsultants(r2.data);
      setFilterOptions(r3.data);
    }).catch((err) => console.error("Failed to load dashboard data:", err)).finally(() => setLoadingSummary(false));
  }, []);

  // ── Fetch analytics with debounce ──
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Stable key that only changes when actual filter values change (avoids array reference issues)
  const analyticsFilterKey = useMemo(() => JSON.stringify({
    timePeriod, filterDomain, filterCountry, filterTier, filterSector,
    filterBA, filterTeam, filterConsultant, filterDecisionMaker,
  }), [timePeriod, filterDomain, filterCountry, filterTier, filterSector,
       filterBA, filterTeam, filterConsultant, filterDecisionMaker]);

  useEffect(() => {
    if (activeTab !== 'analytics') return;
    setLoadingAnalytics(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params: Record<string, string | number | boolean> = { time_period: timePeriod };
      if (filterDomain.length) params.responsibility_domain = filterDomain.join(',');
      if (filterCountry.length) params.group_domicile = filterCountry.join(',');
      if (filterTier.length) params.client_tier = filterTier.join(',');
      if (filterSector.length) params.sector = filterSector.join(',');
      if (filterBA.length) params.owner_business_area = filterBA.join(',');
      if (filterTeam.length) params.owner_team = filterTeam.join(',');
      if (filterConsultant !== '') params.employee_id = filterConsultant;
      if (filterDecisionMaker) params.is_decision_maker = true;

      api.get('/dashboard/analytics', { params })
        .then(r => setAnalyticsData(r.data))
        .catch((err) => console.error('Failed to load analytics:', err))
        .finally(() => setLoadingAnalytics(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, analyticsFilterKey]);

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

  // Filter summary client-side (team tab)
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

  // Fetch detail records when detail tab is active
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
      .catch((err) => console.error('Failed to load detail records:', err))
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

  // Format numbers with locale separators
  const fmtNum = (n: number) => n.toLocaleString();

  // Percentage helper for KPI sub-text
  const interactionPct = analyticsData && analyticsData.kpis.total_contacts > 0
    ? Math.round((analyticsData.kpis.interacted_contacts / analyticsData.kpis.total_contacts) * 100)
    : 0;

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>{subtitle}</p>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
          Analytics
        </button>
        <button className={`tab ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>
          Team Performance
        </button>
        <button className={`tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
          Detail
        </button>
      </div>

      {/* ─── Analytics Tab ──────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div>
          {/* Filters bar */}
          <div className="analytics-filters">
            <div>
              <label>Time Period</label>
              <select value={timePeriod} onChange={e => setTimePeriod(e.target.value)}>
                {TIME_PERIOD_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Domain</label>
              <MultiSelectFilter options={filterOptions?.responsibility_domains || []} selected={filterDomain} onChange={setFilterDomain} placeholder="All Domains" />
            </div>
            <div>
              <label>Country</label>
              <MultiSelectFilter options={filterOptions?.group_domiciles || []} selected={filterCountry} onChange={setFilterCountry} placeholder="All Countries" />
            </div>
            <div>
              <label>Client Tier</label>
              <MultiSelectFilter options={filterOptions?.client_tiers || []} selected={filterTier} onChange={setFilterTier} placeholder="All Tiers" />
            </div>
            <div>
              <label>Sector</label>
              <MultiSelectFilter options={filterOptions?.sectors || []} selected={filterSector} onChange={setFilterSector} placeholder="All Sectors" />
            </div>
            <div>
              <label>Business Area</label>
              <MultiSelectFilter options={filterOptions?.business_areas || []} selected={filterBA} onChange={setFilterBA} placeholder="All BAs" />
            </div>
            <div>
              <label>Team</label>
              <MultiSelectFilter options={filterOptions?.teams || []} selected={filterTeam} onChange={setFilterTeam} placeholder="All Teams" />
            </div>
            <div>
              <label>Consultant</label>
              <select
                value={filterConsultant}
                onChange={e => setFilterConsultant(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">All Consultants</option>
                {consultants.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label>Decision Maker</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 400, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={filterDecisionMaker}
                  onChange={e => setFilterDecisionMaker(e.target.checked)}
                />
                DM only
              </label>
            </div>
          </div>

          <ActiveFiltersBar
            chips={[
              ...filterTier.map(v => ({ category: 'Tier', value: v, onRemove: () => setFilterTier(prev => prev.filter(x => x !== v)) })),
              ...filterSector.map(v => ({ category: 'Sector', value: v, onRemove: () => setFilterSector(prev => prev.filter(x => x !== v)) })),
              ...filterDomain.map(v => ({ category: 'Domain', value: v, onRemove: () => setFilterDomain(prev => prev.filter(x => x !== v)) })),
              ...filterCountry.map(v => ({ category: 'Country', value: v, onRemove: () => setFilterCountry(prev => prev.filter(x => x !== v)) })),
              ...filterBA.map(v => ({ category: 'BA', value: v, onRemove: () => setFilterBA(prev => prev.filter(x => x !== v)) })),
              ...filterTeam.map(v => ({ category: 'Team', value: v, onRemove: () => setFilterTeam(prev => prev.filter(x => x !== v)) })),
              ...(filterDecisionMaker ? [{ category: '', value: 'Decision Makers', onRemove: () => setFilterDecisionMaker(false) }] : []),
            ]}
            onClearAll={() => {
              setFilterDomain([]); setFilterCountry([]); setFilterTier([]);
              setFilterSector([]); setFilterBA([]); setFilterTeam([]);
              setFilterConsultant(''); setFilterDecisionMaker(false);
            }}
          />

          {loadingAnalytics && !analyticsData ? (
            <div className="empty-state">Loading analytics...</div>
          ) : analyticsData ? (
            <div className="analytics-layout">
              {/* Left column: KPI cards */}
              <div className="analytics-kpis">
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Total Contacts</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.total_contacts)}</div>
                  <div className="kpi-sub">Matching filters (all time)</div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Interacted Contacts</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.interacted_contacts)}</div>
                  <div className="kpi-sub">{interactionPct}% interaction rate</div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Outreach Total</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.outreach_total)}</div>
                  <div className="kpi-sub">All outreach records</div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Outreach Sent</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.outreach_sent)}</div>
                  <div className="kpi-sub">Sent / prepared / replied</div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Meetings Booked</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.meetings_booked)}</div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="kpi-label">Campaigns Sent</div>
                  <div className="kpi-value">{fmtNum(analyticsData.kpis.campaigns_sent)}</div>
                  <div className="kpi-sub">Individual campaign sends</div>
                </div>
                <div className="analytics-kpi-card" style={{ borderLeft: '3px solid #e5534b' }}>
                  <div className="kpi-label">Coverage Gaps</div>
                  <div className="kpi-value" style={{ color: 'var(--danger)' }}>{fmtNum(analyticsData.kpis.coverage_gaps_critical)}</div>
                  <div className="kpi-sub">
                    {analyticsData.kpis.companies_with_gaps} companies with critical gaps
                    {analyticsData.gap_kpi.closed_gaps > 0 && (
                      <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
                        ({analyticsData.gap_kpi.closed_gaps} closed via meetings)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right column: Charts */}
              <div className="analytics-charts">
                {/* Bar Chart — Outreach by Status */}
                <div className="analytics-chart-card">
                  <div className="chart-title">Outreach by Status</div>
                  <div className="chart-body">
                    {analyticsData.outreach_by_status.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                          data={analyticsData.outreach_by_status.map(d => ({
                            ...d,
                            displayStatus: d.status.replace(/_/g, ' '),
                          }))}
                          margin={{ top: 5, right: 20, bottom: 60, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e1" vertical={false} />
                          <XAxis
                            dataKey="displayStatus"
                            tick={{ fontSize: 11, fill: '#6b6b6b' }}
                            angle={-35}
                            textAnchor="end"
                            interval={0}
                            axisLine={{ stroke: '#e5e4e1' }}
                            tickLine={false}
                          />
                          <YAxis tick={{ fontSize: 12, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
                          <Tooltip content={<StatusBarTooltip />} />
                          <Bar dataKey="count" fill="#69D4AE" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state" style={{ padding: 20 }}>No outreach data for this period</div>
                    )}
                  </div>
                </div>

                {/* Pie Charts — Distribution by Tier & Sector side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div className="analytics-chart-card">
                    <div className="chart-title">Distribution by Tier</div>
                    <div className="chart-body">
                      {analyticsData.distribution_by_tier.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={analyticsData.distribution_by_tier}
                              dataKey="value"
                              nameKey="label"
                              cx="50%"
                              cy="45%"
                              innerRadius={50}
                              outerRadius={85}
                              paddingAngle={2}
                              label={makePieLabel(5)}
                              labelLine={{ strokeWidth: 1, stroke: '#ccc' }}
                            >
                              {analyticsData.distribution_by_tier.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: number, name: string) => [value, name]}
                              contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e1', fontSize: 13 }}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                              iconSize={8}
                              iconType="circle"
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="empty-state" style={{ padding: 20 }}>No tier data</div>
                      )}
                    </div>
                  </div>

                  <div className="analytics-chart-card">
                    <div className="chart-title">Distribution by Sector</div>
                    <div className="chart-body">
                      {analyticsData.distribution_by_sector.length > 0 ? (() => {
                        const merged = mergeSmallSlices(analyticsData.distribution_by_sector, 3);
                        return (
                          <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                              <Pie
                                data={merged}
                                dataKey="value"
                                nameKey="label"
                                cx="50%"
                                cy="45%"
                                innerRadius={50}
                                outerRadius={85}
                                paddingAngle={2}
                                label={makePieLabel(8)}
                                labelLine={{ strokeWidth: 1, stroke: '#ccc' }}
                              >
                                {merged.map((_, i) => (
                                  <Cell key={i} fill={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(value: number, name: string) => [value, name]}
                                contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e1', fontSize: 13 }}
                              />
                              <Legend
                                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                                iconSize={8}
                                iconType="circle"
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        );
                      })() : (
                        <div className="empty-state" style={{ padding: 20 }}>No sector data</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Chart — Activity Over Time */}
                <div className="analytics-chart-card">
                  <div className="chart-title">
                    Activity Over Time
                    <span style={{ fontWeight: 400, fontSize: 12, color: '#9a9a9a', marginLeft: 8 }}>
                      ({analyticsData.time_bucket} buckets)
                    </span>
                  </div>
                  <div className="chart-body">
                    {analyticsData.activity_over_time.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart
                          data={analyticsData.activity_over_time}
                          margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e1" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={{ stroke: '#e5e4e1' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 12, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e4e1', fontSize: 13 }} />
                          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                          <Line
                            type="monotone"
                            dataKey="outreach"
                            name="Outreach Sent"
                            stroke="#69D4AE"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#69D4AE' }}
                            activeDot={{ r: 6, fill: '#69D4AE', stroke: '#fff', strokeWidth: 2 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="meetings"
                            name="Meetings Booked"
                            stroke="#e07c24"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#e07c24' }}
                            activeDot={{ r: 6, fill: '#e07c24', stroke: '#fff', strokeWidth: 2 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state" style={{ padding: 20 }}>No activity data for this period</div>
                    )}
                  </div>
                </div>

                {/* Stacked Bar Chart — Coverage Gaps by Industry */}
                <div className="analytics-chart-card">
                  <div className="chart-title">Coverage Gaps by Industry</div>
                  <div className="chart-body">
                    {analyticsData.gap_by_industry && analyticsData.gap_by_industry.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                          data={analyticsData.gap_by_industry}
                          margin={{ top: 5, right: 20, bottom: 60, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e1" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: '#6b6b6b' }}
                            angle={-35}
                            textAnchor="end"
                            interval={0}
                            axisLine={{ stroke: '#e5e4e1' }}
                            tickLine={false}
                          />
                          <YAxis tick={{ fontSize: 12, fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                            formatter={(value: number, name: string) => [value, name === 'critical' ? 'Critical Gaps' : name === 'potential' ? 'Potential Gaps' : 'Closed (verified meetings)']}
                          />
                          <Legend
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: 11 }}
                            formatter={(val: string) => val === 'critical' ? 'Critical' : val === 'potential' ? 'Potential' : 'Closed (via meetings)'}
                          />
                          <Bar dataKey="closed" stackId="gaps" fill="#7ec47e" radius={[0, 0, 0, 0]} name="closed" />
                          <Bar dataKey="critical" stackId="gaps" fill="#e5534b" radius={[0, 0, 0, 0]} name="critical" />
                          <Bar dataKey="potential" stackId="gaps" fill="#d4915e" radius={[4, 4, 0, 0]} name="potential" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state" style={{ padding: 20 }}>No coverage gap data available</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Team Performance Tab ──────────────────────────────── */}
      {activeTab === 'team' && (
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
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontWeight: 500, padding: 0, fontSize: 13 }}
                            onClick={() => drillToDetail(r.employee_id)}
                            title="View outreach detail for this consultant"
                          >
                            {r.employee_name}
                          </button>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.business_area_name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.team_name || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.proposed > 0 ? <span className="badge badge-proposed">{r.proposed}</span> : <span style={{ color: '#9a9a9a' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.accepted > 0 ? <span className="badge badge-accepted">{r.accepted}</span> : <span style={{ color: '#9a9a9a' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.sent > 0 ? <span className="badge badge-sent">{r.sent}</span> : <span style={{ color: '#9a9a9a' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {objBadge(r.sent_7d, r.outreach_target_per_week)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {objBadge(r.sent_30d, r.outreach_target_per_month)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.negated > 0 ? <span className="badge badge-negated">{r.negated}</span> : <span style={{ color: '#9a9a9a' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.total || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredSummary.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-subtle)', fontWeight: 600 }}>
                      <td colSpan={3} style={{ fontSize: 13 }}>Totals — {filteredSummary.length} consultant{filteredSummary.length !== 1 ? 's' : ''}</td>
                      <td style={{ textAlign: 'right' }}>{totals.proposed}</td>
                      <td style={{ textAlign: 'right' }}>{totals.accepted}</td>
                      <td style={{ textAlign: 'right' }}>{totals.sent}</td>
                      <td style={{ textAlign: 'right', color: '#9a9a9a' }}>{totals.sent_7d}</td>
                      <td style={{ textAlign: 'right', color: '#9a9a9a' }}>{totals.sent_30d}</td>
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
                        <td style={{ fontSize: 13 }}>{formatDate(r.created_at)}</td>
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
