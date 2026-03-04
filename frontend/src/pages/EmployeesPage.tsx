import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Employee } from '../types';

export default function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [targetModal, setTargetModal] = useState<{ employee: Employee; weekValue: number; monthValue: number | null } | null>(null);
  const [targetSaving, setTargetSaving] = useState(false);

  useEffect(() => {
    api.get('/employees/').then((r) => setEmployees(r.data)).catch(() => {});
  }, []);

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

  // Determine whether the current user may edit this employee's target.
  // The server already scopes the employee list to the caller's BA/team,
  // so we only need to check the target employee's role here.
  const canEditTarget = (emp: Employee): boolean => {
    if (user?.role === 'admin') return true;
    if (user?.role === 'ba_manager') {
      // BA managers set targets for team managers and consultants (not other ba_managers/admins)
      return ['consultant', 'team_manager'].includes(emp.role);
    }
    if (user?.role === 'team_manager') {
      // Team managers set targets for consultants only (not peer team managers)
      return emp.role === 'consultant';
    }
    return false;
  };

  const handleSaveTarget = async () => {
    if (!targetModal || isNaN(targetModal.weekValue) || targetModal.weekValue < 1) return;
    setTargetSaving(true);
    try {
      const payload: { outreach_target_per_week?: number; outreach_target_per_month?: number | null } = {
        outreach_target_per_week: targetModal.weekValue,
      };
      // Send month target: null clears it, a number sets it
      payload.outreach_target_per_month = targetModal.monthValue;
      const res = await api.patch(`/employees/${targetModal.employee.id}/target`, payload);
      setEmployees((prev) => prev.map((e) => (e.id === res.data.id ? res.data : e)));
      setTargetModal(null);
    } catch {
      // leave modal open — user will see no change and can retry or cancel
    } finally {
      setTargetSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Consultants</h2>
        <p>{scopeLabel()}</p>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Seniority</th>
                <th>Team</th>
                <th>Business Area</th>
                <th>Site</th>
                <th>Language</th>
                <th>Target/Week</th>
                <th>Target/Month</th>
                <th>Profile Description</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 500 }}>{e.name}</td>
                  <td style={{ fontSize: 13 }}>{e.email}</td>
                  <td>
                    <span className={`badge badge-${e.role === 'admin' ? 'tier1' : 'tier2'}`}>
                      {roleLabel(e.role)}
                    </span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{e.seniority || '—'}</td>
                  <td>{e.team_name || '—'}</td>
                  <td>{e.business_area_name || '—'}</td>
                  <td>{e.site_name || '—'}</td>
                  <td>{e.primary_language?.toUpperCase()}</td>
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
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {e.outreach_target_per_month ?? <span style={{ color: '#a0aec0' }}>—</span>}
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {targetModal && (
        <div className="modal-overlay" onClick={() => setTargetModal(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}
