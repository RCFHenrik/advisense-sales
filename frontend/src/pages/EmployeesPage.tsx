import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Employee, Role } from '../types';

const SENIORITY_OPTIONS = [
  'Junior Associate', 'Associate', 'Senior Associate',
  'Manager', 'Senior Manager', 'Director', 'Managing Director',
];

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

export default function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<string>('approved');
  const [pendingCount, setPendingCount] = useState(0);

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

  // Dropdown data for add modal
  const [businessAreas, setBusinessAreas] = useState<{ id: number; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: number; name: string; business_area_id: number }[]>([]);
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);

  // Role management
  const [roleSaving, setRoleSaving] = useState<number | null>(null);
  const isAdmin = user?.role === 'admin';

  const canAddConsultant = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');
  const canApprove = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');

  // Fetch employees based on approval filter
  useEffect(() => {
    const params: Record<string, string> = {};
    if (approvalFilter) params.approval_status = approvalFilter;
    api.get('/employees/', { params }).then((r) => setEmployees(r.data)).catch(() => {});
  }, [approvalFilter]);

  // Fetch pending count
  useEffect(() => {
    if (canApprove) {
      api.get('/employees/', { params: { approval_status: 'pending' } })
        .then((r) => setPendingCount(r.data.length))
        .catch(() => {});
    }
  }, [canApprove]);

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
      // If admin changed their own role, refresh to update nav visibility
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

  // Filtered teams based on selected BA in add modal
  const filteredTeams = newConsultant.business_area_id
    ? teams.filter((t) => t.business_area_id === Number(newConsultant.business_area_id))
    : teams;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Consultants</h2>
          <p>{scopeLabel()}</p>
        </div>
        {canAddConsultant && (
          <button
            className="btn btn-primary"
            onClick={() => { fetchDropdownData(); setShowAddModal(true); }}
          >
            + Add Consultant
          </button>
        )}
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

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Seniority</th>
                <th>Business Area</th>
                <th>Team</th>
                <th>Site</th>
                <th>Language</th>
                <th>Site Languages</th>
                {approvalFilter === 'approved' && <th>Target/Week</th>}
                {approvalFilter === 'approved' && <th>Target/Month</th>}
                {approvalFilter === 'approved' && <th>Profile Description</th>}
                {approvalFilter === 'pending' && canApprove && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={approvalFilter === 'approved' ? 12 : 10} className="empty-state">
                    {approvalFilter === 'pending' ? 'No pending consultants' : 'No employees found'}
                  </td>
                </tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td style={{ fontSize: 13 }}>{e.email?.includes('@placeholder.local') ? '—' : e.email}</td>
                    <td>
                      {isAdmin && approvalFilter === 'approved' ? (
                        <select
                          className="form-control"
                          style={{
                            fontSize: 13,
                            padding: '2px 6px',
                            maxWidth: 150,
                            opacity: roleSaving === e.id ? 0.6 : 1,
                          }}
                          value={e.role}
                          disabled={roleSaving === e.id}
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
                    <td style={{ textTransform: 'capitalize' }}>{e.seniority || '—'}</td>
                    <td>{e.business_area_name || '—'}</td>
                    <td>{e.team_name || '—'}</td>
                    <td>{e.site_name || '—'}</td>
                    <td>{e.primary_language?.toUpperCase()}</td>
                    <td style={{ fontSize: 12 }}>
                      {e.site_languages && e.site_languages.length > 0
                        ? e.site_languages.map((l) => l.name).join(', ')
                        : <span style={{ color: '#a0aec0' }}>—</span>
                      }
                    </td>
                    {approvalFilter === 'approved' && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {e.outreach_target_per_week}
                        {canEditTarget(e) && (
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ marginLeft: 6, padding: '1px 6px', fontSize: 12 }}
                            title={`Set targets for ${e.name}`}
                            onClick={() => setTargetModal({ employee: e, weekValue: e.outreach_target_per_week, monthValue: e.outreach_target_per_month ?? null })}
                          >
                            ✏
                          </button>
                        )}
                      </td>
                    )}
                    {approvalFilter === 'approved' && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {e.outreach_target_per_month ?? <span style={{ color: '#a0aec0' }}>—</span>}
                      </td>
                    )}
                    {approvalFilter === 'approved' && (
                      <td
                        style={{ fontSize: 12, color: '#4a5568', maxWidth: 260 }}
                        title={e.profile_description || undefined}
                      >
                        {e.profile_description
                          ? e.profile_description.length > 100
                            ? e.profile_description.slice(0, 100) + '...'
                            : e.profile_description
                          : <span style={{ color: '#a0aec0' }}>No description</span>}
                      </td>
                    )}
                    {approvalFilter === 'pending' && canApprove && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ marginRight: 6, padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleApproval(e.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)', padding: '3px 10px', fontSize: 12 }}
                          onClick={() => handleApproval(e.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </td>
                    )}
                  </tr>
                ))
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
                  placeholder="—"
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
                {targetSaving ? 'Saving…' : 'Save'}
              </button>
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
                <div style={{ marginBottom: 12, padding: 8, background: '#fff5f5', borderRadius: 4, color: '#c53030', fontSize: 13 }}>
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
                  <option value="">— Select —</option>
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
                  <option value="">— Select —</option>
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
                  <option value="">— Select —</option>
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
                  <option value="">— Select —</option>
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
                {addSaving ? 'Adding…' : 'Add Consultant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
