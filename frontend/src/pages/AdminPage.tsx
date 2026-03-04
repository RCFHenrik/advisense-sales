import { useState, useEffect } from 'react';
import api from '../api/client';
import type { SystemConfigItem, ColumnMapping } from '../types';

export default function AdminPage() {
  const [tab, setTab] = useState<'config' | 'mappings' | 'suppression' | 'audit'>('config');
  const [configs, setConfigs] = useState<SystemConfigItem[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [suppression, setSuppression] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (tab === 'config') api.get('/admin/config').then((r) => setConfigs(r.data)).catch(() => {});
    if (tab === 'mappings') api.get('/admin/column-mappings').then((r) => setMappings(r.data)).catch(() => {});
    if (tab === 'suppression') api.get('/admin/suppression-list').then((r) => setSuppression(r.data)).catch(() => {});
    if (tab === 'audit') api.get('/admin/audit-log').then((r) => setAuditLog(r.data)).catch(() => {});
  }, [tab]);

  const handleSaveConfig = async (key: string) => {
    setConfigError('');
    try {
      await api.put(`/admin/config/${key}`, { value: editValue });
      setEditingConfig(null);
      const res = await api.get('/admin/config');
      setConfigs(res.data);
    } catch {
      setConfigError('Failed to save setting.');
    }
  };

  const handleRemoveSuppression = async (id: number) => {
    setConfigError('');
    try {
      await api.delete(`/admin/suppression-list/${id}`);
      const res = await api.get('/admin/suppression-list');
      setSuppression(res.data);
    } catch {
      setConfigError('Failed to remove suppression entry.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Administration</h2>
        <p>System configuration, column mappings, and audit logs</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
          System Config
        </button>
        <button className={`tab ${tab === 'mappings' ? 'active' : ''}`} onClick={() => setTab('mappings')}>
          Column Mappings
        </button>
        <button className={`tab ${tab === 'suppression' ? 'active' : ''}`} onClick={() => setTab('suppression')}>
          Suppression List
        </button>
        <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>
          Audit Log
        </button>
      </div>

      {tab === 'config' && (
        <div className="card">
          {configError && (
            <div style={{ padding: '8px 20px', color: 'var(--danger)', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
              {configError}
            </div>
          )}
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.key}>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{c.key}</td>
                    <td>
                      {editingConfig === c.key ? (
                        <input
                          className="form-control"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={{ maxWidth: 200 }}
                          autoFocus
                        />
                      ) : (
                        <strong>{c.value}</strong>
                      )}
                    </td>
                    <td style={{ fontSize: 13, color: '#718096' }}>{c.description}</td>
                    <td>
                      {editingConfig === c.key ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => handleSaveConfig(c.key)}>Save</button>
                          <button className="btn btn-sm btn-outline" onClick={() => setEditingConfig(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-outline" onClick={() => { setEditingConfig(c.key); setEditValue(c.value); }}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'mappings' && (
        <div className="card">
          <div className="card-header">Column Mappings (Excel → System)</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>File Type</th>
                  <th>Logical Field</th>
                  <th>Excel Column</th>
                  <th>Required</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td style={{ textTransform: 'capitalize' }}>{m.file_type}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{m.logical_field}</td>
                    <td>{m.physical_column}</td>
                    <td>{m.is_required ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'suppression' && (
        <div className="card">
          <div className="card-header">Suppression List (Do-Not-Contact)</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Contact ID</th>
                  <th>Reason</th>
                  <th>HubSpot Update</th>
                  <th>Date Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suppression.length === 0 ? (
                  <tr><td colSpan={5} className="empty-state">No suppressed contacts</td></tr>
                ) : (
                  suppression.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.contact_id}</td>
                      <td>{s.reason}</td>
                      <td>{s.hubspot_update_required ? 'Pending' : 'Done'}</td>
                      <td>{new Date(s.created_at).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-sm btn-outline" onClick={() => handleRemoveSuppression(s.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-header">Audit Log</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr><td colSpan={5} className="empty-state">No audit log entries</td></tr>
                ) : (
                  auditLog.map((l: any) => (
                    <tr key={l.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(l.timestamp).toLocaleString()}
                      </td>
                      <td>{l.employee_id || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{l.action}</td>
                      <td style={{ fontSize: 13 }}>{l.entity_type} #{l.entity_id}</td>
                      <td style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.details || l.new_value || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
