import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import MultiSelectFilter from '../components/MultiSelectFilter';
import ActiveFiltersBar from '../components/ActiveFiltersBar';
import { formatDateTime } from '../utils/dateFormat';
import type { Employee, Role } from '../types';

const SENIORITY_OPTIONS = [
  'Junior Associate', 'Associate', 'Senior Associate',
  'Manager', 'Senior Manager', 'Director', 'Managing Director',
];

const SENIORITY_ORDER: Record<string, number> = {
  'junior associate': 1,
  'associate': 2,
  'senior associate': 3,
  'manager': 4,
  'senior manager': 5,
  'director': 6,
  'managing director': 7,
};

const LANGUAGE_OPTIONS = [
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fi', label: 'Finnish' },
];

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'team_manager', label: 'Team Manager' },
  { value: 'ba_manager', label: 'BA Manager' },
  { value: 'admin', label: 'Admin' },
];

interface BatchResult {
  added: number;
  updated: number;
  skipped_duplicate: number;
  warnings: string[];
  total_rows: number;
}

interface BatchUploadFile {
  id: number;
  filename: string;
  row_count: number | null;
  added_count: number;
  updated_count: number;
  uploaded_at: string;
  batch_id: string;
}

interface BulkOperationResult {
  success_count: number;
  skipped_count: number;
  skipped_details: string[];
}

interface CsvOptions {
  business_areas: string[];
  teams_by_ba: Record<string, string[]>;
  sites: string[];
  source_file: string | null;
}

// ── Sorting ─────────────────────────────────────────────────────────

type EmployeeSortField =
  | 'name' | 'email' | 'seniority' | 'business_area_name'
  | 'team_name' | 'site_name' | 'primary_language' | 'outreach_target_per_week';

type SortDir = 'asc' | 'desc';
type SortKey = { field: EmployeeSortField; dir: SortDir };

function getEmployeeValue(e: Employee, field: EmployeeSortField): string | number | null {
  if (field === 'seniority') {
    const s = e.seniority;
    if (!s) return null;
    return SENIORITY_ORDER[s.toLowerCase()] ?? 999;
  }
  if (field === 'outreach_target_per_week') return e.outreach_target_per_week;
  const v = e[field];
  if (v === null || v === undefined) return null;
  return String(v);
}

function sortEmployees(list: Employee[], keys: SortKey[]): Employee[] {
  if (keys.length === 0) return list;
  return [...list].sort((a, b) => {
    for (const { field, dir } of keys) {
      const av = getEmployeeValue(a, field);
      const bv = getEmployeeValue(b, field);
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
  field: EmployeeSortField;
  sortKeys: SortKey[];
  onSort: (field: EmployeeSortField) => void;
  style?: React.CSSProperties;
}

function SortableTh({ label, field, sortKeys, onSort, style }: SortableThProps) {
  const idx = sortKeys.findIndex((k) => k.field === field);
  const active = idx >= 0;
  const dir = active ? sortKeys[idx].dir : null;
  const priority = active ? idx + 1 : null;
  const multiLevel = sortKeys.length > 1;

  return (
    <th
      onClick={() => onSort(field)}
      title="Click to add/toggle sort"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
    >
      {label}
      <span style={{ marginLeft: 5, fontSize: 11, opacity: active ? 1 : 0.25 }}>
        {active ? (dir === 'asc' ? '\u25B2' : '\u25BC') : '\u21C5'}
      </span>
      {active && multiLevel && (
        <sup style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', marginLeft: 1, verticalAlign: 'super' }}>
          {priority}
        </sup>
      )}
    </th>
  );
}

// ── Searchable consultant filter with portal dropdown ───────────────

function ConsultantSearch({
  employees,
  search,
  onSearchChange,
}: {
  employees: Employee[];
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!search.trim() || search.trim().length < 1) return [];
    const s = search.toLowerCase();
    return employees
      .filter(
        (e) =>
          e.name.toLowerCase().includes(s) ||
          e.email.toLowerCase().includes(s) ||
          (e.business_area_name || '').toLowerCase().includes(s) ||
          (e.team_name || '').toLowerCase().includes(s) ||
          (e.site_name || '').toLowerCase().includes(s)
      )
      .slice(0, 12);
  }, [employees, search]);

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 2,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 350),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => { setHighlightIdx(0); }, [search]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.children;
    if (items[highlightIdx]) {
      (items[highlightIdx] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx, open]);

  const handleSelect = (emp: Employee) => {
    onSearchChange(emp.name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (suggestions[highlightIdx]) handleSelect(suggestions[highlightIdx]);
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  const showDropdown = open && search.trim().length >= 1 && suggestions.length > 0;

  return (
    <div ref={wrapperRef} style={{ marginBottom: 12, position: 'relative', maxWidth: 400 }}>
      <input
        ref={inputRef}
        className="form-control"
        placeholder="Search name, email, business area, team, site..."
        value={search}
        onChange={(e) => {
          onSearchChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => { if (search.trim().length >= 1) setOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      {search && (
        <button
          onClick={() => { onSearchChange(''); setOpen(false); }}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16,
            padding: '0 4px', lineHeight: 1,
          }}
          title="Clear search"
        >
          &times;
        </button>
      )}
      {showDropdown &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              maxHeight: 280,
              overflowY: 'auto',
              zIndex: 9999,
            }}
          >
            {suggestions.map((emp, idx) => (
              <div
                key={emp.id}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 13,
                  background: idx === highlightIdx ? '#edf2f7' : '#fff',
                  borderBottom: '1px solid #f7fafc',
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(emp);
                }}
              >
                <strong>{emp.name}</strong>
                {emp.email ? <span style={{ color: '#718096', marginLeft: 8, fontSize: 12 }}>{emp.email}</span> : null}
                <div style={{ color: '#a0aec0', fontSize: 11 }}>
                  {[emp.business_area_name, emp.team_name, emp.site_name].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<string>('approved');
  const [pendingCount, setPendingCount] = useState(0);

  // Search
  const [search, setSearch] = useState('');

  // Category filters
  const [filterSeniority, setFilterSeniority] = useState<string[]>([]);
  const [filterBA, setFilterBA] = useState<string[]>([]);
  const [filterTeam, setFilterTeam] = useState<string[]>([]);
  const [filterSite, setFilterSite] = useState<string[]>([]);

  // Sorting
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Target modal
  const [targetModal, setTargetModal] = useState<{ employee: Employee; weekValue: number; monthValue: number | null } | null>(null);
  const [targetSaving, setTargetSaving] = useState(false);

  // Add consultant modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [newConsultant, setNewConsultant] = useState({
    name: '', email: '', seniority: '', business_area_id: '', team_id: '', site_id: '', primary_language: 'en',
  });

  // Batch apply modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchFiles, setBatchFiles] = useState<BatchUploadFile[]>([]);
  const [batchFilesLoading, setBatchFilesLoading] = useState(false);
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [batchApplying, setBatchApplying] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchError, setBatchError] = useState('');

  // Bulk deactivate modal
  const [showBulkDeactivateModal, setShowBulkDeactivateModal] = useState(false);
  const [bulkDeactivating, setBulkDeactivating] = useState(false);
  const [bulkDeactivateResult, setBulkDeactivateResult] = useState<BulkOperationResult | null>(null);

  // Bulk edit modal
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkEditResult, setBulkEditResult] = useState<BulkOperationResult | null>(null);
  const [csvOptions, setCsvOptions] = useState<CsvOptions | null>(null);

  // Inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editFields, setEditFields] = useState({
    name: '', email: '', seniority: '', business_area: '', team: '', site: '', primary_language: '', profile_description: '', domain_expertise_tags: '', relevance_tags: '',
  });
  const [csvOptionsLoading, setCsvOptionsLoading] = useState(false);
  const [bulkEditFields, setBulkEditFields] = useState({
    name: '', email: '', seniority: '', business_area: '', team: '', site: '', primary_language: '', profile_description: '',
  });

  // Dropdown data for add modal
  const [businessAreas, setBusinessAreas] = useState<{ id: number; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: number; name: string; business_area_id: number }[]>([]);
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);

  // Role management
  const [roleSaving, setRoleSaving] = useState<number | null>(null);
  const isAdmin = user?.role === 'admin';

  // Reset password modal
  const [resetPwModal, setResetPwModal] = useState<{ employee: Employee; tempPassword: string } | null>(null);
  const [resetPwLoading, setResetPwLoading] = useState<number | null>(null);

  const canAddConsultant = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');
  const canApprove = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');
  const canBatchUpload = ['admin', 'ba_manager'].includes(user?.role || '');
  const canBulkManage = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');

  // Filtered + sorted employees
  // Derive unique filter options from employees
  const filterOpts = useMemo(() => {
    const seniorities = new Set<string>();
    const bas = new Set<string>();
    const teams = new Set<string>();
    const sites = new Set<string>();
    employees.forEach(e => {
      if (e.seniority) seniorities.add(e.seniority);
      if (e.business_area_name) bas.add(e.business_area_name);
      if (e.team_name) teams.add(e.team_name);
      if (e.site_name) sites.add(e.site_name);
    });
    return {
      seniorities: [...seniorities].sort(),
      bas: [...bas].sort(),
      teams: [...teams].sort(),
      sites: [...sites].sort(),
    };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    let result = employees;
    if (filterSeniority.length) result = result.filter(e => filterSeniority.includes(e.seniority || ''));
    if (filterBA.length) result = result.filter(e => filterBA.includes(e.business_area_name || ''));
    if (filterTeam.length) result = result.filter(e => filterTeam.includes(e.team_name || ''));
    if (filterSite.length) result = result.filter(e => filterSite.includes(e.site_name || ''));
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(e =>
        e.name.toLowerCase().includes(s) ||
        e.email.toLowerCase().includes(s) ||
        (e.business_area_name || '').toLowerCase().includes(s) ||
        (e.team_name || '').toLowerCase().includes(s) ||
        (e.site_name || '').toLowerCase().includes(s) ||
        (e.seniority || '').toLowerCase().includes(s)
      );
    }
    return result;
  }, [employees, search, filterSeniority, filterBA, filterTeam, filterSite]);

  const sortedEmployees = useMemo(() => sortEmployees(filteredEmployees, sortKeys), [filteredEmployees, sortKeys]);

  const handleSort = (field: EmployeeSortField) => {
    setSortKeys((prev) => {
      const idx = prev.findIndex((k) => k.field === field);
      if (idx < 0) {
        return [...prev, { field, dir: 'asc' as SortDir }];
      }
      const current = prev[idx].dir;
      if (current === 'asc') {
        return prev.map((k) => (k.field === field ? { ...k, dir: 'desc' as SortDir } : k));
      }
      return prev.filter((k) => k.field !== field);
    });
  };

  // Fetch employees based on approval filter
  const fetchEmployees = () => {
    const params: Record<string, string> = {};
    if (approvalFilter) params.approval_status = approvalFilter;
    api.get('/employees/', { params }).then((r) => setEmployees(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchEmployees();
    setSelectedIds(new Set());
    setEditingId(null);
  }, [approvalFilter]);

  // Fetch pending count
  useEffect(() => {
    if (canApprove) {
      api.get('/employees/', { params: { approval_status: 'pending' } })
        .then((r) => setPendingCount(r.data.length))
        .catch(() => {});
    }
  }, [canApprove]);

  // Load CSV options on mount (for inline edit dropdowns)
  useEffect(() => {
    if (canBulkManage) {
      api.get('/employees/csv-options').then((r) => setCsvOptions(r.data)).catch(() => {});
    }
  }, [canBulkManage]);

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Admin';
      case 'ba_manager': return 'BA Manager';
      case 'team_manager': return 'Team Manager';
      default: return 'Consultant';
    }
  };

  const scopeLabel = () => {
    if (user?.role === 'admin') return 'All employees across the organisation';
    if (user?.role === 'ba_manager') return `Employees in your business area (${user?.business_area_name || 'your BA'})`;
    if (user?.role === 'team_manager') return `Employees in your team (${user?.team_name || 'your team'})`;
    return 'Your profile';
  };

  const canEditTarget = (emp: Employee): boolean => {
    if (user?.role === 'admin') return true;
    if (user?.role === 'ba_manager') return ['consultant', 'team_manager'].includes(emp.role);
    if (user?.role === 'team_manager') return emp.role === 'consultant';
    return false;
  };

  const canRemove = (emp: Employee): boolean => {
    if (emp.id === user?.id) return false;
    if (user?.role === 'admin') return true;
    if (user?.role === 'ba_manager') return ['consultant', 'team_manager'].includes(emp.role);
    if (user?.role === 'team_manager') return emp.role === 'consultant';
    return false;
  };

  // ── Selection helpers ────────────────────────────────────────────
  const selectableEmployees = useMemo(
    () => sortedEmployees.filter((e) => canRemove(e)),
    [sortedEmployees, user],
  );

  const allSelected = selectableEmployees.length > 0 && selectableEmployees.every((e) => selectedIds.has(e.id));
  const someSelected = selectableEmployees.some((e) => selectedIds.has(e.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableEmployees.map((e) => e.id)));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectByBA = (baName: string) => {
    const ids = selectableEmployees.filter((e) => e.business_area_name === baName).map((e) => e.id);
    setSelectedIds(new Set([...selectedIds, ...ids]));
  };

  const selectByTeam = (teamName: string) => {
    const ids = selectableEmployees.filter((e) => e.team_name === teamName).map((e) => e.id);
    setSelectedIds(new Set([...selectedIds, ...ids]));
  };

  // Get distinct BAs and Teams from visible employees
  const distinctBAs = useMemo(() => {
    const bas = new Set<string>();
    selectableEmployees.forEach((e) => { if (e.business_area_name) bas.add(e.business_area_name); });
    return Array.from(bas).sort();
  }, [selectableEmployees]);

  const distinctTeams = useMemo(() => {
    const ts = new Set<string>();
    selectableEmployees.forEach((e) => { if (e.team_name) ts.add(e.team_name); });
    return Array.from(ts).sort();
  }, [selectableEmployees]);

  // Selected employees
  const selectedEmployees = useMemo(
    () => sortedEmployees.filter((e) => selectedIds.has(e.id)),
    [sortedEmployees, selectedIds],
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSaveTarget = async () => {
    if (!targetModal || isNaN(targetModal.weekValue) || targetModal.weekValue < 1) return;
    setTargetSaving(true);
    try {
      const payload: { outreach_target_per_week?: number; outreach_target_per_month?: number | null } = {
        outreach_target_per_week: targetModal.weekValue,
      };
      payload.outreach_target_per_month = targetModal.monthValue;
      const res = await api.patch(`/employees/${targetModal.employee.id}/target`, payload);
      setEmployees((prev) => prev.map((e) => (e.id === res.data.id ? res.data : e)));
      setTargetModal(null);
    } catch {
      // leave modal open
    } finally {
      setTargetSaving(false);
    }
  };

  const handleRoleChange = async (employeeId: number, newRole: Role) => {
    setRoleSaving(employeeId);
    try {
      const res = await api.patch(`/employees/${employeeId}/role`, { role: newRole });
      setEmployees((prev) => prev.map((e) => (e.id === res.data.id ? res.data : e)));
      if (employeeId === user?.id) {
        const meRes = await api.get('/auth/me');
        localStorage.setItem('user', JSON.stringify(meRes.data));
        window.location.reload();
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to change role');
    } finally {
      setRoleSaving(null);
    }
  };

  const handleApproval = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/employees/${id}/approve`, { approval_status: status });
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      setPendingCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Action failed');
    }
  };

  const handleDeactivate = async (emp: Employee) => {
    if (!window.confirm(`Remove ${emp.name} from the active consultants list? They will be deactivated and can be re-activated later.`)) return;
    try {
      await api.patch(`/employees/${emp.id}/deactivate`);
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(emp.id); return next; });
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to deactivate consultant');
    }
  };

  // ── Reset password ──────────────────────────────────────────────
  const handleResetPassword = async (emp: Employee) => {
    if (!window.confirm(`Generate a temporary password for ${emp.name}? They will need to change it on their next login.`)) return;
    setResetPwLoading(emp.id);
    try {
      const res = await api.post(`/employees/${emp.id}/reset-password`);
      setResetPwModal({ employee: emp, tempPassword: res.data.temporary_password });
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to reset password');
    } finally {
      setResetPwLoading(null);
    }
  };

  // ── Inline edit ──────────────────────────────────────────────────
  const startEditing = (emp: Employee) => {
    setEditingId(emp.id);
    let expertTags = '';
    if (emp.domain_expertise_tags) {
      try {
        const arr = JSON.parse(emp.domain_expertise_tags);
        expertTags = Array.isArray(arr) ? arr.join(', ') : emp.domain_expertise_tags;
      } catch {
        expertTags = emp.domain_expertise_tags;
      }
    }
    setEditFields({
      name: emp.name || '',
      email: emp.email?.includes('@placeholder.local') ? '' : (emp.email || ''),
      seniority: emp.seniority || '',
      business_area: emp.business_area_name || '',
      team: emp.team_name || '',
      site: emp.site_name || '',
      primary_language: emp.primary_language || '',
      profile_description: emp.profile_description || '',
      domain_expertise_tags: expertTags,
      relevance_tags: (() => {
        if (!emp.relevance_tags) return '';
        try {
          const arr = JSON.parse(emp.relevance_tags);
          return Array.isArray(arr) ? arr.join(', ') : emp.relevance_tags;
        } catch { return emp.relevance_tags; }
      })(),
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const payload: Record<string, unknown> = { employee_ids: [editingId] };
      // Find the original employee to compare
      const orig = employees.find((e) => e.id === editingId);
      if (!orig) return;

      if (editFields.name && editFields.name !== (orig.name || '')) payload.name = editFields.name;
      const origEmail = orig.email?.includes('@placeholder.local') ? '' : (orig.email || '');
      if (editFields.email && editFields.email !== origEmail) payload.email = editFields.email;
      if (editFields.seniority && editFields.seniority !== (orig.seniority || '')) payload.seniority = editFields.seniority;
      if (editFields.business_area && editFields.business_area !== (orig.business_area_name || '')) payload.business_area = editFields.business_area;
      if (editFields.team && editFields.team !== (orig.team_name || '')) payload.team = editFields.team;
      if (editFields.site && editFields.site !== (orig.site_name || '')) payload.site = editFields.site;
      if (editFields.primary_language && editFields.primary_language !== (orig.primary_language || '')) payload.primary_language = editFields.primary_language;
      if (editFields.profile_description !== (orig.profile_description || '')) payload.profile_description = editFields.profile_description;
      // Compare expertise tags: convert current edit field to JSON array string for comparison
      const editTagsArray = editFields.domain_expertise_tags.split(',').map((t) => t.trim()).filter(Boolean);
      const editTagsJson = JSON.stringify(editTagsArray);
      const origTags = orig.domain_expertise_tags || '[]';
      if (editTagsJson !== origTags) payload.domain_expertise_tags = editTagsJson;
      // Compare relevance tags
      const editRtArray = editFields.relevance_tags.split(',').map((t) => t.trim()).filter(Boolean);
      const editRtJson = JSON.stringify(editRtArray);
      const origRt = orig.relevance_tags || '[]';
      if (editRtJson !== origRt) payload.relevance_tags = editRtJson;

      // Only call API if there are actual changes beyond employee_ids
      if (Object.keys(payload).length > 1) {
        await api.patch('/employees/bulk-update', payload);
        fetchEmployees();
      }
      setEditingId(null);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  // Teams available for current inline edit BA selection
  const inlineEditTeams = useMemo(() => {
    if (!csvOptions || !editFields.business_area) return [];
    return csvOptions.teams_by_ba[editFields.business_area] || [];
  }, [csvOptions, editFields.business_area]);

  // ── Batch apply (from previously uploaded files) ────────────
  const fetchBatchFiles = async () => {
    setBatchFilesLoading(true);
    try {
      const res = await api.get('/employees/batch-uploads');
      setBatchFiles(res.data);
    } catch {
      setBatchFiles([]);
    } finally {
      setBatchFilesLoading(false);
    }
  };

  const openBatchModal = () => {
    setShowBatchModal(true);
    setSelectedUploadId(null);
    setBatchResult(null);
    setBatchError('');
    fetchBatchFiles();
  };

  const handleBatchApply = async () => {
    if (!selectedUploadId) return;
    setBatchApplying(true);
    setBatchResult(null);
    setBatchError('');

    try {
      const res = await api.post(`/employees/batch-apply/${selectedUploadId}`);
      setBatchResult(res.data);
      fetchEmployees();
    } catch (err: any) {
      setBatchError(err.response?.data?.detail || 'Batch apply failed');
    } finally {
      setBatchApplying(false);
    }
  };

  const closeBatchModal = () => {
    setShowBatchModal(false);
    setBatchResult(null);
    setBatchError('');
    setSelectedUploadId(null);
  };

  const fetchDropdownData = () => {
    api.get('/admin/business-areas').then((r) => setBusinessAreas(r.data)).catch(() => {});
    api.get('/admin/teams').then((r) => setTeams(r.data)).catch(() => {});
    api.get('/admin/sites').then((r) => setSites(r.data)).catch(() => {});
  };

  const handleAddConsultant = async () => {
    setAddSaving(true);
    setAddError('');
    try {
      const payload: Record<string, unknown> = {
        name: newConsultant.name,
        email: newConsultant.email,
        role: 'consultant',
        primary_language: newConsultant.primary_language || 'en',
      };
      if (newConsultant.seniority) payload.seniority = newConsultant.seniority;
      if (newConsultant.business_area_id) payload.business_area_id = Number(newConsultant.business_area_id);
      if (newConsultant.team_id) payload.team_id = Number(newConsultant.team_id);
      if (newConsultant.site_id) payload.site_id = Number(newConsultant.site_id);

      const res = await api.post('/employees/', payload);
      setEmployees((prev) => [...prev, res.data]);
      setShowAddModal(false);
      setNewConsultant({ name: '', email: '', seniority: '', business_area_id: '', team_id: '', site_id: '', primary_language: 'en' });
    } catch (err: any) {
      setAddError(err.response?.data?.detail || 'Failed to add consultant');
    } finally {
      setAddSaving(false);
    }
  };

  // ── Bulk deactivate ────────────────────────────────────────────
  const openBulkDeactivateModal = () => {
    setBulkDeactivateResult(null);
    setShowBulkDeactivateModal(true);
  };

  const handleBulkDeactivate = async () => {
    setBulkDeactivating(true);
    setBulkDeactivateResult(null);
    try {
      const res = await api.post('/employees/bulk-deactivate', {
        employee_ids: Array.from(selectedIds),
      });
      setBulkDeactivateResult(res.data);
      fetchEmployees();
      setSelectedIds(new Set());
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Bulk deactivate failed');
    } finally {
      setBulkDeactivating(false);
    }
  };

  // ── Bulk edit ──────────────────────────────────────────────────
  const openBulkEditModal = async () => {
    setBulkEditResult(null);
    setBulkEditFields({
      name: '', email: '', seniority: '', business_area: '', team: '', site: '', primary_language: '', profile_description: '',
    });
    setShowBulkEditModal(true);
    setCsvOptionsLoading(true);
    try {
      const res = await api.get('/employees/csv-options');
      setCsvOptions(res.data);
    } catch {
      setCsvOptions(null);
    } finally {
      setCsvOptionsLoading(false);
    }
  };

  const handleBulkEdit = async () => {
    setBulkEditing(true);
    setBulkEditResult(null);
    try {
      const payload: Record<string, unknown> = {
        employee_ids: Array.from(selectedIds),
      };
      // Only include fields that have been changed (non-empty)
      if (bulkEditFields.name) payload.name = bulkEditFields.name;
      if (bulkEditFields.email) payload.email = bulkEditFields.email;
      if (bulkEditFields.seniority) payload.seniority = bulkEditFields.seniority;
      if (bulkEditFields.business_area) payload.business_area = bulkEditFields.business_area;
      if (bulkEditFields.team) payload.team = bulkEditFields.team;
      if (bulkEditFields.site) payload.site = bulkEditFields.site;
      if (bulkEditFields.primary_language) payload.primary_language = bulkEditFields.primary_language;
      if (bulkEditFields.profile_description) payload.profile_description = bulkEditFields.profile_description;

      const res = await api.patch('/employees/bulk-update', payload);
      setBulkEditResult(res.data);
      fetchEmployees();
      setSelectedIds(new Set());
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkEditing(false);
    }
  };

  // Available teams in bulk edit based on selected BA
  const bulkEditTeams = useMemo(() => {
    if (!csvOptions || !bulkEditFields.business_area) return [];
    return csvOptions.teams_by_ba[bulkEditFields.business_area] || [];
  }, [csvOptions, bulkEditFields.business_area]);

  // Filtered teams for add modal based on selected BA
  const filteredTeams = newConsultant.business_area_id
    ? teams.filter((t) => t.business_area_id === Number(newConsultant.business_area_id))
    : teams;

  // Group selected employees by BA for deactivate modal display
  const selectedByBA = useMemo(() => {
    const groups: Record<string, Employee[]> = {};
    selectedEmployees.forEach((e) => {
      const ba = e.business_area_name || '(No BA)';
      if (!groups[ba]) groups[ba] = [];
      groups[ba].push(e);
    });
    return groups;
  }, [selectedEmployees]);

  // Column count for empty state
  const baseColCount = approvalFilter === 'approved' ? 14 : 10;
  const colCount = (canBulkManage && approvalFilter === 'approved' ? 1 : 0) + baseColCount;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Consultants</h2>
          <p>{scopeLabel()}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canBatchUpload && (
            <button
              className="btn btn-outline"
              onClick={openBatchModal}
            >
              + Add by Batch
            </button>
          )}
          {canAddConsultant && (
            <button
              className="btn btn-primary"
              onClick={() => { fetchDropdownData(); setShowAddModal(true); }}
            >
              + Add Consultant
            </button>
          )}
        </div>
      </div>

      {/* Approval filter */}
      {canApprove && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ maxWidth: 220 }}
            value={approvalFilter}
            onChange={(e) => setApprovalFilter(e.target.value)}
          >
            <option value="approved">Approved</option>
            <option value="pending">
              Pending Approval{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </option>
            <option value="rejected">Rejected</option>
          </select>
          {approvalFilter === 'pending' && pendingCount > 0 && (
            <span style={{ fontSize: 13, color: '#975a16', fontWeight: 500 }}>
              {pendingCount} consultant{pendingCount !== 1 ? 's' : ''} awaiting approval
            </span>
          )}
        </div>
      )}

      {/* Bulk actions panel — always visible on approved tab for managers */}
      {approvalFilter === 'approved' && canBulkManage && (
        <div style={{
          padding: '12px 16px', background: '#f7fafc', borderRadius: 8,
          marginBottom: 12, border: '1px solid #e2e8f0',
        }}>
          {/* Quick actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#4a5568', minWidth: 90 }}>
              Bulk Actions
            </span>

            {/* Quick deactivate by BA */}
            <select
              className="form-control"
              style={{ maxWidth: 220, fontSize: 13, padding: '4px 8px' }}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  const ids = selectableEmployees.filter((emp) => emp.business_area_name === e.target.value).map((emp) => emp.id);
                  setSelectedIds(new Set(ids));
                  openBulkDeactivateModal();
                }
              }}
            >
              <option value="">Deactivate all in BA...</option>
              {distinctBAs.map((ba) => {
                const count = selectableEmployees.filter((emp) => emp.business_area_name === ba).length;
                return <option key={ba} value={ba}>{ba} ({count})</option>;
              })}
            </select>

            {/* Quick deactivate by Team */}
            <select
              className="form-control"
              style={{ maxWidth: 220, fontSize: 13, padding: '4px 8px' }}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  const ids = selectableEmployees.filter((emp) => emp.team_name === e.target.value).map((emp) => emp.id);
                  setSelectedIds(new Set(ids));
                  openBulkDeactivateModal();
                }
              }}
            >
              <option value="">Deactivate all in Team...</option>
              {distinctTeams.map((t) => {
                const count = selectableEmployees.filter((emp) => emp.team_name === t).length;
                return <option key={t} value={t}>{t} ({count})</option>;
              })}
            </select>

            <span style={{ color: '#cbd5e0', fontSize: 16 }}>{'\u2502'}</span>

            {/* Quick edit by BA */}
            <select
              className="form-control"
              style={{ maxWidth: 200, fontSize: 13, padding: '4px 8px' }}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  const ids = selectableEmployees.filter((emp) => emp.business_area_name === e.target.value).map((emp) => emp.id);
                  setSelectedIds(new Set(ids));
                  openBulkEditModal();
                }
              }}
            >
              <option value="">Edit all in BA...</option>
              {distinctBAs.map((ba) => {
                const count = selectableEmployees.filter((emp) => emp.business_area_name === ba).length;
                return <option key={ba} value={ba}>{ba} ({count})</option>;
              })}
            </select>

            {/* Quick edit by Team */}
            <select
              className="form-control"
              style={{ maxWidth: 200, fontSize: 13, padding: '4px 8px' }}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  const ids = selectableEmployees.filter((emp) => emp.team_name === e.target.value).map((emp) => emp.id);
                  setSelectedIds(new Set(ids));
                  openBulkEditModal();
                }
              }}
            >
              <option value="">Edit all in Team...</option>
              {distinctTeams.map((t) => {
                const count = selectableEmployees.filter((emp) => emp.team_name === t).length;
                return <option key={t} value={t}>{t} ({count})</option>;
              })}
            </select>

            {/* Deactivate ALL */}
            <button
              className="btn btn-sm btn-outline"
              style={{
                fontSize: 12, padding: '4px 10px', marginLeft: 'auto',
                color: 'var(--danger)', borderColor: 'var(--danger)',
              }}
              onClick={() => {
                setSelectedIds(new Set(selectableEmployees.map((emp) => emp.id)));
                openBulkDeactivateModal();
              }}
            >
              Deactivate All ({selectableEmployees.length})
            </button>
          </div>

          {/* Checkbox selection bar — shows when checkboxes are ticked */}
          {selectedIds.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
              paddingTop: 10, borderTop: '1px solid #e2e8f0',
            }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#2b6cb0' }}>
                {selectedIds.size} selected via checkboxes
              </span>

              {/* Add more via BA/Team */}
              {distinctBAs.length > 1 && (
                <select
                  className="form-control"
                  style={{ maxWidth: 180, fontSize: 13, padding: '3px 8px' }}
                  value=""
                  onChange={(e) => { if (e.target.value) selectByBA(e.target.value); }}
                >
                  <option value="">+ Add BA to selection...</option>
                  {distinctBAs.map((ba) => <option key={ba} value={ba}>{ba}</option>)}
                </select>
              )}
              {distinctTeams.length > 1 && (
                <select
                  className="form-control"
                  style={{ maxWidth: 180, fontSize: 13, padding: '3px 8px' }}
                  value=""
                  onChange={(e) => { if (e.target.value) selectByTeam(e.target.value); }}
                >
                  <option value="">+ Add Team to selection...</option>
                  {distinctTeams.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}

              <div style={{ flex: 1 }} />

              <button
                className="btn btn-sm btn-outline"
                style={{ fontSize: 13, padding: '4px 12px' }}
                onClick={openBulkEditModal}
              >
                Edit Selected
              </button>
              <button
                className="btn btn-sm btn-outline"
                style={{
                  fontSize: 13, padding: '4px 12px',
                  color: 'var(--danger)', borderColor: 'var(--danger)',
                }}
                onClick={openBulkDeactivateModal}
              >
                Deactivate Selected
              </button>
              <button
                className="btn btn-sm"
                style={{ fontSize: 12, padding: '2px 8px', color: '#718096', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      <ConsultantSearch
        employees={employees}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="filters-panel" style={{ marginBottom: 12 }}>
        <MultiSelectFilter options={filterOpts.seniorities} selected={filterSeniority} onChange={setFilterSeniority} placeholder="All Seniorities" />
        <MultiSelectFilter options={filterOpts.bas} selected={filterBA} onChange={setFilterBA} placeholder="All Business Areas" />
        <MultiSelectFilter options={filterOpts.teams} selected={filterTeam} onChange={setFilterTeam} placeholder="All Teams" />
        <MultiSelectFilter options={filterOpts.sites} selected={filterSite} onChange={setFilterSite} placeholder="All Sites" />
      </div>

      <ActiveFiltersBar
        chips={[
          ...filterSeniority.map(v => ({ category: 'Seniority', value: v, onRemove: () => setFilterSeniority(prev => prev.filter(x => x !== v)) })),
          ...filterBA.map(v => ({ category: 'BA', value: v, onRemove: () => setFilterBA(prev => prev.filter(x => x !== v)) })),
          ...filterTeam.map(v => ({ category: 'Team', value: v, onRemove: () => setFilterTeam(prev => prev.filter(x => x !== v)) })),
          ...filterSite.map(v => ({ category: 'Site', value: v, onRemove: () => setFilterSite(prev => prev.filter(x => x !== v)) })),
        ]}
        onClearAll={() => {
          setFilterSeniority([]); setFilterBA([]); setFilterTeam([]); setFilterSite([]);
        }}
      />

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {canBulkManage && approvalFilter === 'approved' && (
                  <th style={{ width: 36, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      title={allSelected ? 'Deselect all' : 'Select all'}
                      style={{ accentColor: 'var(--primary, #3182ce)' }}
                    />
                  </th>
                )}
                <SortableTh label="Name" field="name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Email" field="email" sortKeys={sortKeys} onSort={handleSort} />
                <th style={{ minWidth: 140 }}>Role</th>
                <SortableTh label="Seniority" field="seniority" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Business Area" field="business_area_name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Team" field="team_name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Site" field="site_name" sortKeys={sortKeys} onSort={handleSort} />
                <SortableTh label="Language" field="primary_language" sortKeys={sortKeys} onSort={handleSort} />
                <th>Site Languages</th>
                {approvalFilter === 'approved' && (
                  <SortableTh label="Target/Week" field="outreach_target_per_week" sortKeys={sortKeys} onSort={handleSort} />
                )}
                {approvalFilter === 'approved' && <th>Target/Month</th>}
                {approvalFilter === 'approved' && <th>Profile Description</th>}
                {approvalFilter === 'approved' && <th>Expert Areas</th>}
                {approvalFilter === 'approved' && <th>Relevance Tags</th>}
                {approvalFilter === 'approved' && canApprove && (
                  <th style={{ width: 1, position: 'sticky', right: 0, background: '#f7fafc', zIndex: 2, boxShadow: '-2px 0 4px rgba(0,0,0,0.06)' }}>Actions</th>
                )}
                {approvalFilter === 'pending' && canApprove && (
                  <th style={{ position: 'sticky', right: 0, background: '#f7fafc', zIndex: 2, boxShadow: '-2px 0 4px rgba(0,0,0,0.06)' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="empty-state">
                    {approvalFilter === 'pending' ? 'No pending consultants' : 'No employees found'}
                  </td>
                </tr>
              ) : (
                sortedEmployees.map((e) => {
                  const isEditing = editingId === e.id && approvalFilter === 'approved';
                  const editable = canRemove(e);
                  const iStyle: React.CSSProperties = { fontSize: 13, padding: '2px 6px', width: '100%' };
                  return (
                  <tr
                    key={e.id}
                    style={isEditing ? { background: '#fffff0' } : selectedIds.has(e.id) ? { background: '#ebf8ff' } : undefined}
                  >
                    {canBulkManage && approvalFilter === 'approved' && (
                      <td style={{ textAlign: 'center' }}>
                        {editable && !isEditing && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(e.id)}
                            onChange={() => toggleSelect(e.id)}
                            style={{ accentColor: 'var(--primary, #3182ce)' }}
                          />
                        )}
                      </td>
                    )}
                    {/* Name */}
                    <td style={{ fontWeight: 500 }}>
                      {isEditing ? (
                        <input className="form-control" style={iStyle} value={editFields.name}
                          onChange={(ev) => setEditFields({ ...editFields, name: ev.target.value })} />
                      ) : e.name}
                    </td>
                    {/* Email */}
                    <td style={{ fontSize: 13 }}>
                      {isEditing ? (
                        <input className="form-control" style={iStyle} value={editFields.email}
                          onChange={(ev) => setEditFields({ ...editFields, email: ev.target.value })} />
                      ) : (e.email?.includes('@placeholder.local') ? '\u2014' : e.email)}
                    </td>
                    {/* Role */}
                    <td>
                      {isAdmin && approvalFilter === 'approved' ? (
                        <select
                          className="form-control"
                          style={{ fontSize: 13, padding: '2px 6px', minWidth: 130, opacity: roleSaving === e.id ? 0.6 : 1 }}
                          value={e.role}
                          disabled={roleSaving === e.id || isEditing}
                          onChange={(ev) => handleRoleChange(e.id, ev.target.value as Role)}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge badge-${e.role === 'admin' ? 'tier1' : 'tier2'}`}>
                          {roleLabel(e.role)}
                        </span>
                      )}
                    </td>
                    {/* Seniority */}
                    <td>
                      {isEditing ? (
                        <select className="form-control" style={iStyle} value={editFields.seniority}
                          onChange={(ev) => setEditFields({ ...editFields, seniority: ev.target.value })}>
                          <option value="">{'\u2014'}</option>
                          {SENIORITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span style={{ textTransform: 'capitalize' }}>{e.seniority || '\u2014'}</span>
                      )}
                    </td>
                    {/* Business Area */}
                    <td>
                      {isEditing ? (
                        <select className="form-control" style={iStyle} value={editFields.business_area}
                          onChange={(ev) => setEditFields({ ...editFields, business_area: ev.target.value, team: '' })}>
                          <option value="">{'\u2014'}</option>
                          {(csvOptions?.business_areas || []).map((ba) => <option key={ba} value={ba}>{ba}</option>)}
                        </select>
                      ) : (e.business_area_name || '\u2014')}
                    </td>
                    {/* Team — filtered by BA */}
                    <td>
                      {isEditing ? (
                        <select className="form-control" style={iStyle} value={editFields.team}
                          onChange={(ev) => setEditFields({ ...editFields, team: ev.target.value })}>
                          <option value="">{'\u2014'}</option>
                          {inlineEditTeams.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : (e.team_name || '\u2014')}
                    </td>
                    {/* Site */}
                    <td>
                      {isEditing ? (
                        <select className="form-control" style={iStyle} value={editFields.site}
                          onChange={(ev) => setEditFields({ ...editFields, site: ev.target.value })}>
                          <option value="">{'\u2014'}</option>
                          {(csvOptions?.sites || []).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (e.site_name || '\u2014')}
                    </td>
                    {/* Language */}
                    <td>
                      {isEditing ? (
                        <select className="form-control" style={iStyle} value={editFields.primary_language}
                          onChange={(ev) => setEditFields({ ...editFields, primary_language: ev.target.value })}>
                          {LANGUAGE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                      ) : e.primary_language?.toUpperCase()}
                    </td>
                    {/* Site Languages */}
                    <td style={{ fontSize: 12 }}>
                      {e.site_languages && e.site_languages.length > 0
                        ? e.site_languages.map((l) => l.name).join(', ')
                        : <span style={{ color: '#a0aec0' }}>{'\u2014'}</span>
                      }
                    </td>
                    {approvalFilter === 'approved' && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {e.outreach_target_per_week}
                        {canEditTarget(e) && !isEditing && (
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ marginLeft: 6, padding: '1px 6px', fontSize: 12 }}
                            title={`Set targets for ${e.name}`}
                            onClick={() => setTargetModal({ employee: e, weekValue: e.outreach_target_per_week, monthValue: e.outreach_target_per_month ?? null })}
                          >
                            {'\u270F'}
                          </button>
                        )}
                      </td>
                    )}
                    {approvalFilter === 'approved' && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {e.outreach_target_per_month ?? <span style={{ color: '#a0aec0' }}>{'\u2014'}</span>}
                      </td>
                    )}
                    {/* Profile Description */}
                    {approvalFilter === 'approved' && (
                      <td style={{ fontSize: 12, color: '#4a5568', maxWidth: 260 }}>
                        {isEditing ? (
                          <input className="form-control" style={iStyle} value={editFields.profile_description}
                            placeholder="Description..."
                            onChange={(ev) => setEditFields({ ...editFields, profile_description: ev.target.value })} />
                        ) : (
                          <span title={e.profile_description || undefined}>
                            {e.profile_description
                              ? e.profile_description.length > 100
                                ? e.profile_description.slice(0, 100) + '...'
                                : e.profile_description
                              : <span style={{ color: '#a0aec0' }}>No description</span>}
                          </span>
                        )}
                      </td>
                    )}
                    {/* Expert Areas */}
                    {approvalFilter === 'approved' && (
                      <td style={{ fontSize: 12, color: '#4a5568', maxWidth: 200 }}>
                        {isEditing ? (
                          <input className="form-control" style={iStyle} value={editFields.domain_expertise_tags}
                            placeholder="e.g. Risk, IFRS 9..."
                            onChange={(ev) => setEditFields({ ...editFields, domain_expertise_tags: ev.target.value })} />
                        ) : (
                          (() => {
                            if (!e.domain_expertise_tags) return <span style={{ color: '#a0aec0' }}>—</span>;
                            try {
                              const arr = JSON.parse(e.domain_expertise_tags);
                              if (Array.isArray(arr) && arr.length > 0) {
                                const display = arr.join(', ');
                                return <span title={display}>{display.length > 80 ? display.slice(0, 80) + '...' : display}</span>;
                              }
                              return <span style={{ color: '#a0aec0' }}>—</span>;
                            } catch {
                              return <span title={e.domain_expertise_tags}>{e.domain_expertise_tags}</span>;
                            }
                          })()
                        )}
                      </td>
                    )}
                    {/* Relevance Tags */}
                    {approvalFilter === 'approved' && (
                      <td style={{ fontSize: 12, color: '#285e61', maxWidth: 200 }}>
                        {isEditing ? (
                          <input className="form-control" style={iStyle} value={editFields.relevance_tags}
                            placeholder="e.g. Public Sector, Audit..."
                            onChange={(ev) => setEditFields({ ...editFields, relevance_tags: ev.target.value })} />
                        ) : (
                          (() => {
                            if (!e.relevance_tags) return <span style={{ color: '#a0aec0' }}>—</span>;
                            try {
                              const arr = JSON.parse(e.relevance_tags);
                              if (Array.isArray(arr) && arr.length > 0) {
                                const display = arr.join(', ');
                                return <span title={display}>{display.length > 80 ? display.slice(0, 80) + '...' : display}</span>;
                              }
                              return <span style={{ color: '#a0aec0' }}>—</span>;
                            } catch {
                              return <span title={e.relevance_tags}>{e.relevance_tags}</span>;
                            }
                          })()
                        )}
                      </td>
                    )}
                    {/* Actions column — sticky right */}
                    {approvalFilter === 'approved' && canApprove && (
                      <td style={{ whiteSpace: 'nowrap', position: 'sticky', right: 0, background: isEditing ? '#fffff0' : selectedIds.has(e.id) ? '#ebf8ff' : '#fff', zIndex: 1, boxShadow: '-2px 0 4px rgba(0,0,0,0.06)' }}>
                        {isEditing ? (
                          <>
                            <button
                              className="btn btn-sm btn-primary"
                              style={{ padding: '2px 10px', fontSize: 12, marginRight: 4 }}
                              onClick={saveEditing}
                              disabled={editSaving}
                            >
                              {editSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={cancelEditing}
                              disabled={editSaving}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {editable && (
                              <button
                                className="btn btn-sm btn-outline"
                                style={{ padding: '2px 8px', fontSize: 12 }}
                                onClick={() => startEditing(e)}
                                title={`Edit ${e.name}`}
                              >
                                Edit
                              </button>
                            )}
                            {editable && (
                              <button
                                className="btn btn-sm btn-outline"
                                style={{ padding: '2px 8px', fontSize: 12 }}
                                onClick={() => handleResetPassword(e)}
                                disabled={resetPwLoading === e.id}
                                title={`Reset password for ${e.name}`}
                              >
                                {resetPwLoading === e.id ? '...' : 'Reset PW'}
                              </button>
                            )}
                            {editable && (
                              <button
                                className="btn btn-sm btn-outline"
                                style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '2px 8px', fontSize: 12 }}
                                onClick={() => handleDeactivate(e)}
                                title={`Remove ${e.name}`}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {approvalFilter === 'pending' && canApprove && (
                      <td style={{ whiteSpace: 'nowrap', position: 'sticky', right: 0, background: '#fff', zIndex: 1, boxShadow: '-2px 0 4px rgba(0,0,0,0.06)' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ marginRight: 6, padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleApproval(e.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleApproval(e.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </td>
                    )}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Target Modal */}
      {targetModal && (
        <div className="modal-overlay" onClick={() => setTargetModal(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">Set Outreach Targets</div>
            <div className="modal-body">
              <p style={{ marginBottom: 16, color: '#4a5568' }}>
                Outreach targets for <strong>{targetModal.employee.name}</strong>
              </p>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Contacts per week</label>
                <input
                  type="number"
                  className="form-control"
                  min={1}
                  style={{ maxWidth: 120 }}
                  value={targetModal.weekValue}
                  onChange={(ev) =>
                    setTargetModal({ ...targetModal, weekValue: parseInt(ev.target.value) || 1 })
                  }
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Contacts per month <span style={{ color: '#a0aec0', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number"
                  className="form-control"
                  min={1}
                  style={{ maxWidth: 120 }}
                  value={targetModal.monthValue ?? ''}
                  placeholder="\u2014"
                  onChange={(ev) => {
                    const val = ev.target.value === '' ? null : parseInt(ev.target.value) || null;
                    setTargetModal({ ...targetModal, monthValue: val });
                  }}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') handleSaveTarget(); }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setTargetModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveTarget}
                disabled={targetSaving}
              >
                {targetSaving ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Apply Modal */}
      {showBatchModal && (
        <div className="modal-overlay" onClick={closeBatchModal}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">Add Consultants by Batch</div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
                Select a previously uploaded Consultants file from the Data Upload page.
                New consultants will be added and existing ones (matched by email) will be updated.
              </div>

              {!batchResult && (
                <>
                  {batchFilesLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: '#718096' }}>
                      Loading uploaded files...
                    </div>
                  ) : batchFiles.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 24, color: '#718096', background: '#f7fafc', borderRadius: 6 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>No consultant files found</div>
                      <div style={{ fontSize: 13 }}>
                        Upload a Consultants file first via the <strong>Data Upload</strong> page.
                      </div>
                    </div>
                  ) : (
                    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                      {batchFiles.map((f) => (
                        <label
                          key={f.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 12px',
                            borderRadius: 6,
                            border: selectedUploadId === f.id ? '2px solid var(--primary, #3182ce)' : '1px solid #e2e8f0',
                            background: selectedUploadId === f.id ? '#ebf8ff' : '#fff',
                            marginBottom: 8,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          <input
                            type="radio"
                            name="batch-file"
                            checked={selectedUploadId === f.id}
                            onChange={() => setSelectedUploadId(f.id)}
                            style={{ accentColor: 'var(--primary, #3182ce)' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {f.filename}
                            </div>
                            <div style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
                              Uploaded: {formatDateTime(f.uploaded_at)} {'\u00B7'} {f.row_count ?? '?'} rows
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}

              {batchError && (
                <div style={{ marginTop: 12, padding: 12, background: '#fff5f5', borderRadius: 6, color: 'var(--danger)' }}>
                  {batchError}
                </div>
              )}

              {batchResult && (
                <div style={{ padding: 16, background: '#f0fff4', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12, color: '#276749' }}>Batch Run Complete</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#276749' }}>{batchResult.added}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Added</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#2b6cb0' }}>{batchResult.updated}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Updated</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{batchResult.total_rows}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Total Rows</div>
                    </div>
                  </div>
                  {batchResult.warnings.length > 0 && (
                    <div style={{ marginTop: 12, maxHeight: 120, overflowY: 'auto', fontSize: 13, color: '#975a16' }}>
                      {batchResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              {batchResult ? (
                <button className="btn btn-primary" onClick={closeBatchModal}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={closeBatchModal} disabled={batchApplying}>
                    Cancel
                  </button>
                  {batchFiles.length > 0 && (
                    <button
                      className="btn btn-primary"
                      onClick={handleBatchApply}
                      disabled={!selectedUploadId || batchApplying}
                    >
                      {batchApplying ? 'Running...' : 'Execute Batch Run'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Consultant Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">Add Consultant</div>
            <div className="modal-body">
              {addError && (
                <div style={{ marginBottom: 12, padding: 8, background: '#fff5f5', borderRadius: 4, color: 'var(--danger)', fontSize: 13 }}>
                  {addError}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Name *</label>
                <input
                  className="form-control"
                  value={newConsultant.name}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, name: ev.target.value })}
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Email *</label>
                <input
                  className="form-control"
                  type="email"
                  value={newConsultant.email}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, email: ev.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Seniority</label>
                <select
                  className="form-control"
                  value={newConsultant.seniority}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, seniority: ev.target.value })}
                >
                  <option value="">{'\u2014'} Select {'\u2014'}</option>
                  {SENIORITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Business Area</label>
                <select
                  className="form-control"
                  value={newConsultant.business_area_id}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, business_area_id: ev.target.value, team_id: '' })}
                >
                  <option value="">{'\u2014'} Select {'\u2014'}</option>
                  {businessAreas.map((ba) => <option key={ba.id} value={ba.id}>{ba.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Team</label>
                <select
                  className="form-control"
                  value={newConsultant.team_id}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, team_id: ev.target.value })}
                >
                  <option value="">{'\u2014'} Select {'\u2014'}</option>
                  {filteredTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Site</label>
                <select
                  className="form-control"
                  value={newConsultant.site_id}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, site_id: ev.target.value })}
                >
                  <option value="">{'\u2014'} Select {'\u2014'}</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Language</label>
                <select
                  className="form-control"
                  value={newConsultant.primary_language}
                  onChange={(ev) => setNewConsultant({ ...newConsultant, primary_language: ev.target.value })}
                >
                  {LANGUAGE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddConsultant}
                disabled={addSaving || !newConsultant.name || !newConsultant.email}
              >
                {addSaving ? 'Adding\u2026' : 'Add Consultant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Deactivate Modal */}
      {showBulkDeactivateModal && (
        <div className="modal-overlay" onClick={() => { if (!bulkDeactivating) setShowBulkDeactivateModal(false); }}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header" style={{ color: 'var(--danger)' }}>
              Deactivate Consultants
            </div>
            <div className="modal-body">
              {!bulkDeactivateResult ? (
                <>
                  <p style={{ marginBottom: 16, color: '#4a5568' }}>
                    You are about to deactivate <strong>{selectedIds.size}</strong> consultant{selectedIds.size !== 1 ? 's' : ''}.
                    They will be removed from the active list but can be re-activated later.
                  </p>
                  <div style={{ maxHeight: 240, overflowY: 'auto', fontSize: 13 }}>
                    {Object.entries(selectedByBA).sort(([a], [b]) => a.localeCompare(b)).map(([ba, emps]) => (
                      <div key={ba} style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, color: '#4a5568', marginBottom: 4, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {ba}
                        </div>
                        {emps.map((e) => (
                          <div key={e.id} style={{ padding: '3px 0', paddingLeft: 12, color: '#2d3748' }}>
                            {e.name}
                            {e.team_name && <span style={{ color: '#a0aec0', marginLeft: 8, fontSize: 12 }}>{e.team_name}</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ padding: 16, background: bulkDeactivateResult.success_count > 0 ? '#f0fff4' : '#fff5f5', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12, color: bulkDeactivateResult.success_count > 0 ? '#276749' : 'var(--danger)' }}>
                    Deactivation Complete
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#276749' }}>{bulkDeactivateResult.success_count}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Deactivated</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#975a16' }}>{bulkDeactivateResult.skipped_count}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Skipped</div>
                    </div>
                  </div>
                  {bulkDeactivateResult.skipped_details.length > 0 && (
                    <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 13, color: '#975a16' }}>
                      {bulkDeactivateResult.skipped_details.map((d, i) => <div key={i}>{d}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              {bulkDeactivateResult ? (
                <button className="btn btn-primary" onClick={() => setShowBulkDeactivateModal(false)}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={() => setShowBulkDeactivateModal(false)} disabled={bulkDeactivating}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={handleBulkDeactivate}
                    disabled={bulkDeactivating}
                  >
                    {bulkDeactivating ? 'Deactivating\u2026' : `Deactivate ${selectedIds.size} Consultant${selectedIds.size !== 1 ? 's' : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="modal-overlay" onClick={() => { if (!bulkEditing) setShowBulkEditModal(false); }}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">
              Edit {selectedIds.size} Consultant{selectedIds.size !== 1 ? 's' : ''}
            </div>
            <div className="modal-body">
              {!bulkEditResult ? (
                <>
                  {csvOptionsLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: '#718096' }}>
                      Loading options...
                    </div>
                  ) : (
                    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                      <p style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
                        Only fields you change will be updated. Leave fields as "No change" to keep current values.
                        {csvOptions?.source_file && (
                          <span style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                            BA/Team/Site options from: <strong>{csvOptions.source_file}</strong>
                          </span>
                        )}
                      </p>

                      {/* Name — only for single selection */}
                      {selectedIds.size === 1 && (
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label>Name</label>
                          <input
                            className="form-control"
                            value={bulkEditFields.name}
                            placeholder="No change"
                            onChange={(ev) => setBulkEditFields({ ...bulkEditFields, name: ev.target.value })}
                          />
                        </div>
                      )}

                      {/* Email — only for single selection */}
                      {selectedIds.size === 1 && (
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label>Email</label>
                          <input
                            className="form-control"
                            type="email"
                            value={bulkEditFields.email}
                            placeholder="No change"
                            onChange={(ev) => setBulkEditFields({ ...bulkEditFields, email: ev.target.value })}
                          />
                        </div>
                      )}

                      {/* Seniority */}
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Seniority</label>
                        <select
                          className="form-control"
                          value={bulkEditFields.seniority}
                          onChange={(ev) => setBulkEditFields({ ...bulkEditFields, seniority: ev.target.value })}
                        >
                          <option value="">{'\u2014'} No change {'\u2014'}</option>
                          {SENIORITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      {/* Business Area */}
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Business Area</label>
                        <select
                          className="form-control"
                          value={bulkEditFields.business_area}
                          onChange={(ev) => setBulkEditFields({ ...bulkEditFields, business_area: ev.target.value, team: '' })}
                        >
                          <option value="">{'\u2014'} No change {'\u2014'}</option>
                          {(csvOptions?.business_areas || []).map((ba) => (
                            <option key={ba} value={ba}>{ba}</option>
                          ))}
                        </select>
                      </div>

                      {/* Team — filtered by BA */}
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Team {bulkEditFields.business_area ? `(${bulkEditFields.business_area})` : ''}</label>
                        <select
                          className="form-control"
                          value={bulkEditFields.team}
                          onChange={(ev) => setBulkEditFields({ ...bulkEditFields, team: ev.target.value })}
                          disabled={!bulkEditFields.business_area && (csvOptions?.business_areas?.length || 0) > 0}
                        >
                          <option value="">{'\u2014'} No change {'\u2014'}</option>
                          {bulkEditTeams.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        {!bulkEditFields.business_area && (csvOptions?.business_areas?.length || 0) > 0 && (
                          <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 2 }}>
                            Select a Business Area first to see teams
                          </div>
                        )}
                      </div>

                      {/* Site */}
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Site</label>
                        <select
                          className="form-control"
                          value={bulkEditFields.site}
                          onChange={(ev) => setBulkEditFields({ ...bulkEditFields, site: ev.target.value })}
                        >
                          <option value="">{'\u2014'} No change {'\u2014'}</option>
                          {(csvOptions?.sites || []).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>

                      {/* Language */}
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Language</label>
                        <select
                          className="form-control"
                          value={bulkEditFields.primary_language}
                          onChange={(ev) => setBulkEditFields({ ...bulkEditFields, primary_language: ev.target.value })}
                        >
                          <option value="">{'\u2014'} No change {'\u2014'}</option>
                          {LANGUAGE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                      </div>

                      {/* Profile Description — only for single selection */}
                      {selectedIds.size === 1 && (
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label>Profile Description</label>
                          <textarea
                            className="form-control"
                            rows={3}
                            value={bulkEditFields.profile_description}
                            placeholder="No change"
                            onChange={(ev) => setBulkEditFields({ ...bulkEditFields, profile_description: ev.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding: 16, background: bulkEditResult.success_count > 0 ? '#f0fff4' : '#fff5f5', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12, color: bulkEditResult.success_count > 0 ? '#276749' : 'var(--danger)' }}>
                    Update Complete
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#276749' }}>{bulkEditResult.success_count}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Updated</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#975a16' }}>{bulkEditResult.skipped_count}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Skipped</div>
                    </div>
                  </div>
                  {bulkEditResult.skipped_details.length > 0 && (
                    <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 13, color: '#975a16' }}>
                      {bulkEditResult.skipped_details.map((d, i) => <div key={i}>{d}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              {bulkEditResult ? (
                <button className="btn btn-primary" onClick={() => setShowBulkEditModal(false)}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={() => setShowBulkEditModal(false)} disabled={bulkEditing}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleBulkEdit}
                    disabled={bulkEditing || csvOptionsLoading}
                  >
                    {bulkEditing ? 'Updating\u2026' : 'Apply Changes'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPwModal && (
        <div className="modal-overlay" onClick={() => setResetPwModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header">Temporary Password Generated</div>
            <div className="modal-body">
              <p style={{ marginBottom: 12, color: '#4a5568' }}>
                A temporary password has been generated for <strong>{resetPwModal.employee.name}</strong>.
              </p>
              <p style={{ fontSize: 13, color: '#718096', marginBottom: 12 }}>
                Share this password securely with the consultant. They will be required to change it on their next login.
              </p>
              <div
                style={{
                  background: '#f7fafc',
                  border: '2px dashed #cbd5e0',
                  borderRadius: 8,
                  padding: '14px 16px',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#2d3748',
                  letterSpacing: 1.5,
                  userSelect: 'all',
                  cursor: 'text',
                }}
              >
                {resetPwModal.tempPassword}
              </div>
              <p style={{ fontSize: 12, color: '#a0aec0', marginTop: 8, textAlign: 'center' }}>
                Click above to select, then copy.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(resetPwModal.tempPassword).catch(() => {});
                  setResetPwModal(null);
                }}
              >
                Copy & Close
              </button>
              <button className="btn btn-outline" onClick={() => setResetPwModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
