import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Contact, FilterOptions, ContactHistory } from '../types';
import { formatDate } from '../utils/dateFormat';
import { getCurrencyForCountry, formatRevenue } from '../utils/currency';
import { Ban, Target, Mail, Clock, Trash2, AlertTriangle, X, Download } from 'lucide-react';
import MultiSelectFilter from '../components/MultiSelectFilter';
import ActiveFiltersBar from '../components/ActiveFiltersBar';

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
  style?: React.CSSProperties;
}

function SortableTh({ label, field, sortKeys, onSort, style }: SortableThProps) {
  const idx = sortKeys.findIndex(k => k.field === field);
  const active = idx >= 0;
  const dir = active ? sortKeys[idx].dir : null;
  const priority = active ? idx + 1 : null;
  const multiLevel = sortKeys.length > 1;

  return (
    <th
      onClick={() => onSort(field)}
      title="Click to add/toggle sort · click ×3 to remove"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
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

function ContactStatusIcon({ flags, onClick }: { flags?: string[]; onClick?: (e?: React.MouseEvent) => void }) {
  if (!flags || flags.length === 0) return null;

  if (flags.includes('stop'))
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}
        title="Do not contact — click to clear (managers only)"
      >
        <Ban size={16} color="var(--danger)" />
      </span>
    );
  if (flags.includes('bounced'))
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}
        title="Email bounced — update contact in HubSpot. Click to clear (managers only)"
      >
        <AlertTriangle size={16} color="#dd6b20" />
      </span>
    );
  if (flags.includes('mail_recent'))
    return (
      <span style={{ display: 'flex', alignItems: 'center' }} title="Mail sent within 7 days">
        <Mail size={16} color="#3182ce" />
      </span>
    );
  if (flags.includes('cooldown'))
    return (
      <span style={{ display: 'flex', alignItems: 'center' }} title="In cooldown period">
        <Clock size={16} color="#d69e2e" />
      </span>
    );
  // available = target
  return (
    <span style={{ display: 'flex', alignItems: 'center' }} title="Available for outreach">
      <Target size={16} color="var(--accent)" />
    </span>
  );
}

export default function ContactsPage() {
  const { user, fxRates } = useAuth();
  const currency = useMemo(() => getCurrencyForCountry(user?.site_country_code), [user?.site_country_code]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [selectedTier, setSelectedTier] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string[]>([]);
  const [selectedBA, setSelectedBA] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [selectedDomicile, setSelectedDomicile] = useState<string[]>([]);
  const [selectedRelevanceTag, setSelectedRelevanceTag] = useState<string[]>([]);
  const [decisionMakerOnly, setDecisionMakerOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  // Edit modal state
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const [editIsDecisionMaker, setEditIsDecisionMaker] = useState(false);
  const [editJobTitle, setEditJobTitle] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [hoveredEditCell, setHoveredEditCell] = useState<string | null>(null);

  // Contact card tooltip state (shown on Name hover)
  const [cardContactId, setCardContactId] = useState<number | null>(null);
  const [cardContact, setCardContact] = useState<Contact | null>(null);
  const [cardHistory, setCardHistory] = useState<ContactHistory | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const cardCache = useRef<Map<number, ContactHistory>>(new Map());
  const cardTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Activity tooltip state (shown on Last Activity hover)
  const [actContactId, setActContactId] = useState<number | null>(null);
  const [actHistory, setActHistory] = useState<ContactHistory | null>(null);

  // Owner hover card state
  const [ownerHoverContact, setOwnerHoverContact] = useState<Contact | null>(null);
  const [ownerHoverPos, setOwnerHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const ownerHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actPos, setActPos] = useState<{ x: number; y: number; flipUp: boolean }>({ x: 0, y: 0, flipUp: false });
  const actCache = useRef<Map<number, ContactHistory>>(new Map());
  const actTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get('/contacts/filters').then((r) => setFilters(r.data)).catch((err) => console.error('Failed to load filters:', err));
    // Cleanup timeouts on unmount
    return () => {
      if (cardTimeout.current) clearTimeout(cardTimeout.current);
      if (actTimeout.current) clearTimeout(actTimeout.current);
    };
  }, []);

  const filterKey = useMemo(() => JSON.stringify({
    selectedTier, selectedSector, selectedDomain, selectedBA,
    selectedTeam, selectedDomicile, selectedRelevanceTag, decisionMakerOnly,
  }), [selectedTier, selectedSector, selectedDomain, selectedBA,
       selectedTeam, selectedDomicile, selectedRelevanceTag, decisionMakerOnly]);

  useEffect(() => {
    fetchContacts();
  }, [page, search, filterKey]);

  const fetchContacts = async () => {
    setLoading(true);
    cardCache.current.clear();
    actCache.current.clear();
    try {
      const params: any = { page, page_size: 50 };
      if (search) params.search = search;
      if (selectedTier.length) params.client_tier = selectedTier.join(',');
      if (selectedSector.length) params.sector = selectedSector.join(',');
      if (selectedDomain.length) params.responsibility_domain = selectedDomain.join(',');
      if (selectedBA.length) params.owner_business_area = selectedBA.join(',');
      if (selectedTeam.length) params.owner_team = selectedTeam.join(',');
      if (selectedDomicile.length) params.group_domicile = selectedDomicile.join(',');
      if (selectedRelevanceTag.length) params.relevance_tag = selectedRelevanceTag.join(',');
      if (decisionMakerOnly) params.is_decision_maker = true;

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
    try {
      await api.post(`/contacts/${contactId}/pin`);
      await fetchContacts();
    } catch (err) {
      console.error('Failed to pin contact:', err);
    }
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

  const handleClearStop = async (contactId: number, contactName: string) => {
    if (!window.confirm(`Remove stop flag for "${contactName}"? This will make the contact available for outreach again.`)) {
      return;
    }
    try {
      await api.post(`/contacts/${contactId}/clear-stop`);
      fetchContacts();
    } catch {
      // handled by interceptor
    }
  };

  const handleClearBounce = async (contactId: number, contactName: string) => {
    if (!window.confirm(`Clear bounce flag for "${contactName}"? This will reactivate the contact.`)) return;
    try {
      await api.post(`/contacts/${contactId}/clear-bounce`);
      fetchContacts();
    } catch {
      // handled by interceptor
    }
  };

  const handleDeleteContact = async (contactId: number, contactName: string) => {
    if (!window.confirm(
      `Delete "${contactName}"?\n\nThis will suppress the contact and remove them from the active list. This action cannot be easily undone.`
    )) {
      return;
    }
    try {
      await api.delete(`/contacts/${contactId}`);
      fetchContacts();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete the contact.');
    }
  };

  // Contact card hover handlers (Name column)
  const handleCardMouseEnter = useCallback((e: React.MouseEvent, contact: Contact) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right + 8, window.innerWidth - 420);
    // Estimate card height (~400px) and clamp so it stays within viewport
    const estimatedCardHeight = 400;
    const spaceBelow = window.innerHeight - rect.top;
    const spaceAbove = rect.bottom;
    let y: number;
    if (spaceBelow >= estimatedCardHeight + 8) {
      // Enough room below — align top of card with row
      y = Math.max(rect.top - 20, 8);
    } else if (spaceAbove >= estimatedCardHeight + 8) {
      // Not enough below — show above, anchor bottom near the row
      y = Math.max(rect.bottom - estimatedCardHeight + 20, 8);
    } else {
      // Neither fits fully — push to top of viewport
      y = 8;
    }
    setCardPos({ x, y });

    if (cardTimeout.current) clearTimeout(cardTimeout.current);

    cardTimeout.current = setTimeout(async () => {
      setCardContact(contact);
      const cached = cardCache.current.get(contact.id);
      if (cached) {
        setCardHistory(cached);
        setCardContactId(contact.id);
        return;
      }
      try {
        setCardContactId(contact.id);
        const res = await api.get(`/contacts/${contact.id}/history`, { params: { limit: 3 } });
        cardCache.current.set(contact.id, res.data);
        setCardHistory(res.data);
      } catch {
        // non-critical
      }
    }, 300);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (cardTimeout.current) clearTimeout(cardTimeout.current);
    setCardContactId(null);
    setCardContact(null);
    setCardHistory(null);
  }, []);

  // Owner hover handlers
  const handleOwnerMouseEnter = useCallback((e: React.MouseEvent, contact: Contact) => {
    if (!contact.owner_name) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 320);
    const spaceBelow = window.innerHeight - rect.bottom;
    const y = spaceBelow >= 200 ? rect.bottom + 4 : rect.top - 200;
    setOwnerHoverPos({ x: Math.max(x, 8), y: Math.max(y, 8) });
    if (ownerHoverTimeout.current) clearTimeout(ownerHoverTimeout.current);
    ownerHoverTimeout.current = setTimeout(() => {
      setOwnerHoverContact(contact);
    }, 250);
  }, []);

  const handleOwnerMouseLeave = useCallback(() => {
    if (ownerHoverTimeout.current) clearTimeout(ownerHoverTimeout.current);
    setOwnerHoverContact(null);
  }, []);

  // Activity tooltip hover handlers (Last Activity column)
  const handleActMouseEnter = useCallback((e: React.MouseEvent, contactId: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 380);
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < 200;
    // When flipping up: store bottom offset (from viewport bottom to cell top)
    // When normal: store top offset (cell bottom + gap)
    const y = flipUp
      ? (window.innerHeight - rect.top + 4)
      : (rect.bottom + 4);
    setActPos({ x, y, flipUp });

    if (actTimeout.current) clearTimeout(actTimeout.current);

    actTimeout.current = setTimeout(async () => {
      const cached = actCache.current.get(contactId);
      if (cached) {
        setActHistory(cached);
        setActContactId(contactId);
        return;
      }
      try {
        setActContactId(contactId);
        const res = await api.get(`/contacts/${contactId}/history`, { params: { limit: 5 } });
        actCache.current.set(contactId, res.data);
        setActHistory(res.data);
      } catch {
        // non-critical
      }
    }, 250);
  }, []);

  const handleActMouseLeave = useCallback(() => {
    if (actTimeout.current) clearTimeout(actTimeout.current);
    setActContactId(null);
    setActHistory(null);
  }, []);

  // Edit modal helpers
  const openEditModal = (c: Contact) => {
    setEditContact(c);
    setEditFirstName(c.first_name || '');
    setEditLastName(c.last_name || '');
    setEditEmail(c.email || '');
    setEditIsDecisionMaker(!!c.is_decision_maker);
    setEditJobTitle(c.job_title || '');
  };

  const handleSaveEdit = async () => {
    if (!editContact) return;
    setEditSaving(true);
    try {
      const payload: any = {
        is_decision_maker: editIsDecisionMaker,
      };
      if (editFirstName !== (editContact.first_name || '')) {
        payload.first_name = editFirstName;
      }
      if (editLastName !== (editContact.last_name || '')) {
        payload.last_name = editLastName;
      }
      if (editEmail !== (editContact.email || '')) {
        payload.email = editEmail;
      }
      if (editJobTitle !== (editContact.job_title || '')) {
        payload.job_title = editJobTitle;
      }
      await api.patch(`/contacts/${editContact.id}`, payload);
      setEditContact(null);
      fetchContacts();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
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
          <MultiSelectFilter options={filters?.client_tiers || []} selected={selectedTier} onChange={(v) => { setSelectedTier(v); setPage(1); }} placeholder="All Tiers" />
          <MultiSelectFilter options={filters?.sectors || []} selected={selectedSector} onChange={(v) => { setSelectedSector(v); setPage(1); }} placeholder="All Sectors" />
          <MultiSelectFilter options={filters?.responsibility_domains || []} selected={selectedDomain} onChange={(v) => { setSelectedDomain(v); setPage(1); }} placeholder="All Domains" />
          <MultiSelectFilter options={filters?.business_areas || []} selected={selectedBA} onChange={(v) => { setSelectedBA(v); setPage(1); }} placeholder="All Business Areas" />
          <MultiSelectFilter options={filters?.teams || []} selected={selectedTeam} onChange={(v) => { setSelectedTeam(v); setPage(1); }} placeholder="All Teams" />
          <MultiSelectFilter options={filters?.group_domiciles || []} selected={selectedDomicile} onChange={(v) => { setSelectedDomicile(v); setPage(1); }} placeholder="All Domiciles" />
          <MultiSelectFilter options={filters?.relevance_tags || []} selected={selectedRelevanceTag} onChange={(v) => { setSelectedRelevanceTag(v); setPage(1); }} placeholder="All Relevance Tags" />
          <button
            className={`btn btn-sm ${decisionMakerOnly ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setDecisionMakerOnly(v => !v); setPage(1); }}
            title="Show only decision makers"
          >
            {decisionMakerOnly ? '✓ Decision Makers' : 'Decision Makers'}
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={async () => {
              try {
                const params: any = {};
                if (selectedTier.length) params.client_tier = selectedTier.join(',');
                if (selectedSector.length) params.sector = selectedSector.join(',');
                if (selectedDomain.length) params.responsibility_domain = selectedDomain.join(',');
                if (selectedBA.length) params.owner_business_area = selectedBA.join(',');
                if (selectedTeam.length) params.owner_team = selectedTeam.join(',');
                if (selectedDomicile.length) params.group_domicile = selectedDomicile.join(',');
                const res = await api.get('/contacts/export-contact-edits', { params, responseType: 'blob' });
                const url = window.URL.createObjectURL(res.data);
                const a = document.createElement('a');
                a.href = url;
                const cd = res.headers['content-disposition'] || '';
                const match = cd.match(/filename="?([^"]+)"?/);
                a.download = match ? match[1] : 'contact_edits.xlsx';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
              } catch {
                alert('No contact edits to export, or export failed.');
              }
            }}
            title="Export contacts with manual edits (name, email, title, etc.)"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Download size={14} /> Export Edits
          </button>
        </div>

        <ActiveFiltersBar
          chips={[
            ...selectedTier.map(v => ({ category: 'Tier', value: v, onRemove: () => setSelectedTier(prev => prev.filter(x => x !== v)) })),
            ...selectedSector.map(v => ({ category: 'Sector', value: v, onRemove: () => setSelectedSector(prev => prev.filter(x => x !== v)) })),
            ...selectedDomain.map(v => ({ category: 'Domain', value: v, onRemove: () => setSelectedDomain(prev => prev.filter(x => x !== v)) })),
            ...selectedBA.map(v => ({ category: 'BA', value: v, onRemove: () => setSelectedBA(prev => prev.filter(x => x !== v)) })),
            ...selectedTeam.map(v => ({ category: 'Team', value: v, onRemove: () => setSelectedTeam(prev => prev.filter(x => x !== v)) })),
            ...selectedDomicile.map(v => ({ category: 'Country', value: v, onRemove: () => setSelectedDomicile(prev => prev.filter(x => x !== v)) })),
            ...selectedRelevanceTag.map(v => ({ category: 'Tag', value: v, onRemove: () => setSelectedRelevanceTag(prev => prev.filter(x => x !== v)) })),
            ...(decisionMakerOnly ? [{ category: '', value: 'Decision Makers', onRemove: () => setDecisionMakerOnly(false) }] : []),
          ]}
          onClearAll={() => {
            setSelectedTier([]); setSelectedSector([]); setSelectedDomain([]);
            setSelectedBA([]); setSelectedTeam([]); setSelectedDomicile([]);
            setSelectedRelevanceTag([]); setDecisionMakerOnly(false); setPage(1);
          }}
        />

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <SortableTh label="Name" field="full_name" sortKeys={sortKeys} onSort={handleSort} style={{ minWidth: 160 }} />
                <SortableTh label="Company" field="company_name" sortKeys={sortKeys} onSort={handleSort} style={{ minWidth: 140 }} />
                <SortableTh label="Title" field="job_title" sortKeys={sortKeys} onSort={handleSort} style={{ minWidth: 120 }} />
                <th style={{ width: 60 }}>Tier</th>
                <SortableTh label="Domain" field="responsibility_domain" sortKeys={sortKeys} onSort={handleSort} style={{ minWidth: 100 }} />
                <SortableTh label="Domicile" field="group_domicile" sortKeys={sortKeys} onSort={handleSort} style={{ width: 80 }} />
                <SortableTh label="Last Activity" field="last_activity_date" sortKeys={sortKeys} onSort={handleSort} style={{ width: 110 }} />
                <SortableTh label="Days Since" field="days_since_interaction" sortKeys={sortKeys} onSort={handleSort} style={{ width: 90 }} />
                <SortableTh label="Revenue" field="revenue" sortKeys={sortKeys} onSort={handleSort} style={{ width: 100 }} />
                <SortableTh label="Score" field="priority_score" sortKeys={sortKeys} onSort={handleSort} style={{ width: 70 }} />
                <th style={{ minWidth: 100 }}>Owner</th>
                {['team_manager', 'ba_manager', 'admin'].includes(user?.role || '') && (
                  <th style={{ width: 50 }}></th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="empty-state">Loading...</td></tr>
              ) : sortedContacts.length === 0 ? (
                <tr><td colSpan={13} className="empty-state">No contacts found. Upload a contacts file to get started.</td></tr>
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
                    <td
                      onMouseEnter={(e) => handleCardMouseEnter(e, c)}
                      onMouseLeave={handleCardMouseLeave}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ContactStatusIcon
                          flags={c.contact_flags}
                          onClick={
                            c.contact_flags?.includes('stop') &&
                            ['team_manager', 'ba_manager', 'admin'].includes(user?.role || '')
                              ? () => handleClearStop(c.id, c.full_name || `${c.first_name} ${c.last_name}`)
                              : c.contact_flags?.includes('bounced') &&
                                ['team_manager', 'ba_manager', 'admin'].includes(user?.role || '')
                                ? () => handleClearBounce(c.id, c.full_name || `${c.first_name} ${c.last_name}`)
                                : undefined
                          }
                        />
                        <div>
                          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span
                              onClick={(e) => { e.stopPropagation(); openEditModal(c); }}
                              onMouseEnter={() => setHoveredEditCell(`name-${c.id}`)}
                              onMouseLeave={() => setHoveredEditCell(null)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '0px 4px',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                              title="Click to edit"
                            >
                              {c.full_name || `${c.first_name} ${c.last_name}`}
                              <span style={{ fontSize: 11, opacity: hoveredEditCell === `name-${c.id}` ? 0.5 : 0, transition: 'opacity 0.15s', color: '#718096', flexShrink: 0 }}>✎</span>
                            </span>
                            {c.is_decision_maker && (
                              <span
                                title="Decision Maker"
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: '#ecc94b',
                                  color: '#744210',
                                  borderRadius: 3,
                                  padding: '1px 4px',
                                  lineHeight: 1.3,
                                }}
                              >
                                DM
                              </span>
                            )}
                            {c.opt_out_one_on_one && (
                              <span
                                title="Opted out of one-on-one emails"
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: '#fed7d7',
                                  color: '#9b2c2c',
                                  borderRadius: 3,
                                  padding: '1px 4px',
                                  lineHeight: 1.3,
                                }}
                              >
                                OPT-OUT
                              </span>
                            )}
                            {c.opt_out_marketing_info && !c.opt_out_one_on_one && (
                              <span
                                title="Opted out of marketing emails"
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: '#fefcbf',
                                  color: '#975a16',
                                  borderRadius: 3,
                                  padding: '1px 4px',
                                  lineHeight: 1.3,
                                }}
                              >
                                NO-MKT
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#718096' }}>
                            <span
                              onClick={(e) => { e.stopPropagation(); openEditModal(c); }}
                              onMouseEnter={() => setHoveredEditCell(`email-${c.id}`)}
                              onMouseLeave={() => setHoveredEditCell(null)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '0px 4px',
                                borderRadius: 3,
                                cursor: 'pointer',
                              }}
                              title="Click to edit"
                            >
                              {c.email}
                              <span style={{ fontSize: 11, opacity: hoveredEditCell === `email-${c.id}` ? 0.5 : 0, transition: 'opacity 0.15s', color: '#718096', flexShrink: 0 }}>✎</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{c.company_name}</div>
                      {c.client_name && c.client_name !== c.company_name && (
                        <div style={{ fontSize: 12, color: '#718096' }}>{c.client_name}</div>
                      )}
                      {(c.coverage_gap_critical ?? 0) > 0 && (
                        <div style={{ marginTop: 2 }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: 10,
                            fontWeight: 600,
                            background: '#fed7d7',
                            color: 'var(--danger)',
                            borderRadius: 4,
                            padding: '0 5px',
                            lineHeight: '16px',
                          }}>
                            {c.coverage_gap_critical} critical gap{c.coverage_gap_critical !== 1 ? 's' : ''}
                          </span>
                          {(c.coverage_gap_potential ?? 0) > 0 && (
                            <span style={{
                              display: 'inline-block',
                              fontSize: 10,
                              fontWeight: 600,
                              background: '#fefcbf',
                              color: '#b7791f',
                              borderRadius: 4,
                              padding: '0 5px',
                              lineHeight: '16px',
                              marginLeft: 4,
                            }}>
                              +{c.coverage_gap_potential} potential
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          onClick={(e) => { e.stopPropagation(); openEditModal(c); }}
                          onMouseEnter={() => setHoveredEditCell(`title-${c.id}`)}
                          onMouseLeave={() => setHoveredEditCell(null)}
                          style={{
                            flex: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0px 4px',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                          title="Click to edit"
                        >
                          {c.job_title}
                          <span style={{ fontSize: 11, opacity: hoveredEditCell === `title-${c.id}` ? 0.5 : 0, transition: 'opacity 0.15s', color: '#718096', flexShrink: 0 }}>✎</span>
                        </span>
                        {c.original_job_title && c.original_job_title !== c.job_title && (
                          <span
                            title={'Original: ' + c.original_job_title}
                            style={{ cursor: 'help', fontSize: 11, color: '#805ad5' }}
                          >
                            ✎
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{tierBadge(c.client_tier)}</td>
                    <td>{c.responsibility_domain}</td>
                    <td>{c.group_domicile}</td>
                    <td
                      style={{ cursor: 'default' }}
                      onMouseEnter={(e) => handleActMouseEnter(e, c.id)}
                      onMouseLeave={handleActMouseLeave}
                    >
                      {formatDate(c.last_activity_date)}
                    </td>
                    <td>
                      {c.days_since_interaction != null ? `${c.days_since_interaction}d` : '—'}
                    </td>
                    <td>
                      {c.revenue != null
                        ? formatRevenue(c.revenue, currency, fxRates)
                        : c.has_historical_revenue ? 'Yes' : '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {c.priority_score != null ? c.priority_score.toFixed(2) : '—'}
                    </td>
                    <td
                      onMouseEnter={(e) => handleOwnerMouseEnter(e, c)}
                      onMouseLeave={handleOwnerMouseLeave}
                      style={{ cursor: c.owner_name ? 'pointer' : 'default' }}
                    >{c.owner_name}</td>
                    {['team_manager', 'ba_manager', 'admin'].includes(user?.role || '') && (
                      <td>
                        <button
                          className="btn-icon"
                          onClick={() => handleDeleteContact(c.id, c.full_name || `${c.first_name} ${c.last_name}`)}
                          title="Delete contact"
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
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

      {/* Contact Card — shown on hover over Name cell */}
      {cardContactId && cardContact && (
        <div
          style={{
            position: 'fixed',
            left: cardPos.x,
            top: cardPos.y,
            zIndex: 9999,
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            padding: 0,
            width: 380,
            maxHeight: `calc(100vh - ${cardPos.y + 16}px)`,
            overflowY: 'auto',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a202c', marginBottom: 2 }}>
              {cardContact.full_name || `${cardContact.first_name} ${cardContact.last_name}`}
            </div>
            <div style={{ color: '#718096' }}>{cardContact.job_title}</div>
            <div style={{ color: '#4a5568', fontWeight: 500 }}>{cardContact.company_name}</div>
            {cardContact.email && (
              <div style={{ color: '#3182ce', marginTop: 2 }}>{cardContact.email}</div>
            )}
          </div>

          {/* Details grid */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
            {cardContact.sector && (<><span style={{ color: '#a0aec0' }}>Sector</span><span>{cardContact.sector}</span></>)}
            {cardContact.responsibility_domain && (<><span style={{ color: '#a0aec0' }}>Domain</span><span>{cardContact.responsibility_domain}</span></>)}
            {cardContact.client_tier && (<><span style={{ color: '#a0aec0' }}>Tier</span><span>{cardContact.client_tier}</span></>)}
            {cardContact.group_domicile && (<><span style={{ color: '#a0aec0' }}>Domicile</span><span>{cardContact.group_domicile}</span></>)}
            {cardContact.owner_name && (<><span style={{ color: '#a0aec0' }}>Owner</span><span>{cardContact.owner_name}</span></>)}
            {cardContact.days_since_interaction != null && (<><span style={{ color: '#a0aec0' }}>Last contact</span><span>{cardContact.days_since_interaction}d ago</span></>)}
          </div>

          {/* Tags */}
          {(() => {
            const rtags: string[] = [];
            if (cardContact.relevance_tags) {
              try { const rt = JSON.parse(cardContact.relevance_tags); if (Array.isArray(rt)) rtags.push(...rt); } catch { /* ignore */ }
            }
            if (rtags.length === 0) return null;
            return (
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ color: '#a0aec0', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Relevance Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {rtags.map((t: string, i: number) => (
                    <span key={i} style={{ background: '#e6fffa', color: '#285e61', padding: '1px 7px', borderRadius: 8, fontSize: 11 }}>{t}</span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Coverage Gaps section */}
          {cardHistory?.coverage_gap && (cardHistory.coverage_gap.critical_gap_count > 0 || cardHistory.coverage_gap.potential_gap_count > 0) && (
            <div style={{ padding: '6px 16px 10px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ color: 'var(--danger)', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                Coverage Gaps
              </div>
              {cardHistory.coverage_gap.missing_domains_critical.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#718096', marginBottom: 3 }}>Missing Domains (Critical)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {cardHistory.coverage_gap.missing_domains_critical.map((d: string, i: number) => (
                      <span key={i} style={{ background: '#fed7d7', color: 'var(--danger)', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 500 }}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {cardHistory.coverage_gap.missing_titles_critical.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#718096', marginBottom: 3 }}>Missing Titles (Critical)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {cardHistory.coverage_gap.missing_titles_critical.map((t: string, i: number) => (
                      <span key={i} style={{ background: '#fed7d7', color: 'var(--danger)', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 500 }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {cardHistory.coverage_gap.missing_domains_potential.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#718096', marginBottom: 3 }}>Missing Domains (Potential)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {cardHistory.coverage_gap.missing_domains_potential.map((d: string, i: number) => (
                      <span key={i} style={{ background: '#fefcbf', color: '#b7791f', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 500 }}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {cardHistory.coverage_gap.missing_titles_potential.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#718096', marginBottom: 3 }}>Missing Titles (Potential)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {cardHistory.coverage_gap.missing_titles_potential.map((t: string, i: number) => (
                      <span key={i} style={{ background: '#fefcbf', color: '#b7791f', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 500 }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Activity history */}
          <div style={{ padding: '10px 16px 14px' }}>
            {!cardHistory ? (
              <div style={{ color: '#a0aec0', textAlign: 'center', padding: 4 }}>Loading activity...</div>
            ) : cardHistory.meetings.length === 0 && cardHistory.outreach.length === 0 && (!cardHistory.campaigns || cardHistory.campaigns.length === 0) ? (
              <div style={{ color: '#a0aec0', textAlign: 'center', padding: 4 }}>No activity recorded</div>
            ) : (
              <>
                {cardHistory.meetings.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 3, color: '#48bb78', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Meetings</div>
                    {cardHistory.meetings.slice(0, 3).map((m) => (
                      <div key={m.id} style={{ marginBottom: 5, paddingLeft: 8, borderLeft: '2px solid #48bb78' }}>
                        <div>
                          <span>{formatDate(m.activity_date)}</span>
                          <span style={{ color: '#718096' }}>{' \u2014 '}{m.employee_name || 'Unknown'}</span>
                        </div>
                        {m.details && (
                          <div style={{ color: '#4a5568', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{m.details}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {cardHistory.outreach.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 3, color: '#3182ce', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Outreach</div>
                    {cardHistory.outreach.slice(0, 3).map((o) => (
                      <div key={o.id} style={{ marginBottom: 5, paddingLeft: 8, borderLeft: '2px solid #3182ce' }}>
                        <div>
                          <span>{formatDate(o.sent_at || o.created_at)}</span>
                          <span style={{ color: '#718096' }}>{' \u2014 '}{o.employee_name || 'Unknown'}</span>
                          {o.status && <span style={{ marginLeft: 6, fontSize: 10, background: '#ebf8ff', color: '#2b6cb0', borderRadius: 4, padding: '0 4px' }}>{o.status}</span>}
                        </div>
                        {o.email_subject && (
                          <div style={{ color: '#4a5568', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{o.email_subject}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {cardHistory.campaigns && cardHistory.campaigns.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 3, color: '#805ad5', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Campaigns</div>
                    {cardHistory.campaigns.slice(0, 2).map((cp) => (
                      <div key={cp.id} style={{ marginBottom: 3, paddingLeft: 8, borderLeft: '2px solid #805ad5' }}>
                        <span>{formatDate(cp.sent_at)}</span>
                        <span style={{ color: '#718096' }}>{' \u2014 '}{cp.campaign_name || 'Unnamed'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Activity Tooltip — shown on hover over Last Activity */}
      {actContactId && (
        <div
          style={{
            position: 'fixed',
            left: actPos.x,
            ...(actPos.flipUp
              ? { bottom: actPos.y, maxHeight: `calc(100vh - ${actPos.y + 16}px)` }
              : { top: actPos.y, maxHeight: `calc(100vh - ${actPos.y + 16}px)` }
            ),
            zIndex: 9999,
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            padding: 0,
            width: 360,
            overflowY: 'auto',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 12, color: '#2d3748' }}>
            Recent Activity
          </div>
          <div style={{ padding: '8px 14px 12px' }}>
            {!actHistory ? (
              <div style={{ color: '#a0aec0', textAlign: 'center', padding: 6 }}>Loading...</div>
            ) : (() => {
              // Merge meetings + outreach + campaigns into a single timeline sorted by date
              const items: { date: string; type: string; color: string; line1: string; line2?: string }[] = [];
              actHistory.meetings.forEach((m) => {
                items.push({
                  date: m.activity_date || '',
                  type: 'Meeting',
                  color: '#48bb78',
                  line1: `${formatDate(m.activity_date)} — ${m.employee_name || 'Unknown'}`,
                  line2: m.details || m.outcome || undefined,
                });
              });
              actHistory.outreach.forEach((o) => {
                items.push({
                  date: o.sent_at || o.created_at || '',
                  type: o.status || 'Outreach',
                  color: '#3182ce',
                  line1: `${formatDate(o.sent_at || o.created_at)} — ${o.employee_name || 'Unknown'}`,
                  line2: o.email_subject || undefined,
                });
              });
              (actHistory.campaigns || []).forEach((cp) => {
                items.push({
                  date: cp.sent_at || '',
                  type: 'Campaign',
                  color: '#805ad5',
                  line1: `${formatDate(cp.sent_at)} — ${cp.campaign_name || 'Unnamed'}`,
                  line2: cp.email_subject || undefined,
                });
              });
              items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
              const top5 = items.slice(0, 5);
              if (top5.length === 0) {
                return <div style={{ color: '#a0aec0', textAlign: 'center', padding: 6 }}>No activity recorded</div>;
              }
              return top5.map((item, i) => (
                <div key={i} style={{ marginBottom: i < top5.length - 1 ? 8 : 0, paddingLeft: 8, borderLeft: `2px solid ${item.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, background: `${item.color}18`, color: item.color, borderRadius: 4, padding: '0 5px', textTransform: 'capitalize' }}>{item.type}</span>
                    <span style={{ color: '#4a5568' }}>{item.line1}</span>
                  </div>
                  {item.line2 && (
                    <div style={{ color: '#718096', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 310 }}>{item.line2}</div>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Owner Hover Card */}
      {ownerHoverContact && ownerHoverContact.owner_name && (
        <div
          style={{
            position: 'fixed',
            left: ownerHoverPos.x,
            top: ownerHoverPos.y,
            zIndex: 9998,
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            border: '1px solid #e2e8f0',
            padding: '14px 18px',
            width: 300,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#2d3748' }}>
            {ownerHoverContact.owner_name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '5px 8px', fontSize: 12 }}>
            {ownerHoverContact.owner_email && (
              <>
                <span style={{ color: '#a0aec0' }}>Email</span>
                <span style={{ color: '#4a5568' }}>{ownerHoverContact.owner_email}</span>
              </>
            )}
            {ownerHoverContact.owner_seniority && (
              <>
                <span style={{ color: '#a0aec0' }}>Seniority</span>
                <span style={{ color: '#4a5568' }}>{ownerHoverContact.owner_seniority}</span>
              </>
            )}
            {ownerHoverContact.owner_business_area && (
              <>
                <span style={{ color: '#a0aec0' }}>Business Area</span>
                <span style={{ color: '#4a5568' }}>{ownerHoverContact.owner_business_area}</span>
              </>
            )}
            {ownerHoverContact.owner_team && (
              <>
                <span style={{ color: '#a0aec0' }}>Team</span>
                <span style={{ color: '#4a5568' }}>{ownerHoverContact.owner_team}</span>
              </>
            )}
            {ownerHoverContact.owner_org_site && (
              <>
                <span style={{ color: '#a0aec0' }}>Site</span>
                <span style={{ color: '#4a5568' }}>{ownerHoverContact.owner_org_site}</span>
              </>
            )}
          </div>
        </div>
      )}

            {/* Edit Contact Modal */}
      {editContact && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditContact(null); }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              padding: 24,
              width: 'min(460px, 90vw)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                Edit Contact
              </h3>
              <button className="btn-icon" onClick={() => setEditContact(null)} title="Close">
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
              {editContact.company_name || 'No company'}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  First Name
                </label>
                <input
                  className="form-control"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First name"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Last Name
                </label>
                <input
                  className="form-control"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last name"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Email
              </label>
              <input
                className="form-control"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Job Title
              </label>
              <input
                className="form-control"
                value={editJobTitle}
                onChange={(e) => setEditJobTitle(e.target.value)}
                placeholder="e.g. Chief Risk Officer"
                style={{ width: '100%' }}
              />
              {editContact.original_job_title && editContact.original_job_title !== editJobTitle && (
                <div style={{ fontSize: 11, color: '#a0aec0', marginTop: 3 }}>
                  Original: {editContact.original_job_title}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editIsDecisionMaker}
                  onChange={(e) => setEditIsDecisionMaker(e.target.checked)}
                />
                Decision Maker
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={() => setEditContact(null)}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
