import { useState, useEffect } from 'react';
import api from '../api/client';
import type { SystemConfigItem, ColumnMapping, SiteLanguageItem } from '../types';
import { formatDateTime, formatDate } from '../utils/dateFormat';

export default function AdminPage() {
  const [tab, setTab] = useState<'config' | 'mappings' | 'suppression' | 'audit' | 'languages' | 'reset'>('config');
  const [configs, setConfigs] = useState<SystemConfigItem[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [suppression, setSuppression] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [configError, setConfigError] = useState('');

  // Site languages state
  const [siteLanguages, setSiteLanguages] = useState<SiteLanguageItem[]>([]);
  const [newLangName, setNewLangName] = useState('');
  const [newLangCode, setNewLangCode] = useState('');
  const [langSaving, setLangSaving] = useState(false);
  const [editingLangId, setEditingLangId] = useState<number | null>(null);
  const [editLangCode, setEditLangCode] = useState('');

  // Add currency state
  const [newCurrCode, setNewCurrCode] = useState('');
  const [newCurrRate, setNewCurrRate] = useState('');
  const [currSaving, setCurrSaving] = useState(false);

  // System reset state
  const [resetStep, setResetStep] = useState<'preview' | 'confirm' | 'complete'>('preview');
  const [resetPreview, setResetPreview] = useState<any>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetResult, setResetResult] = useState<any>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);

  useEffect(() => {
    if (tab === 'config') api.get('/admin/config').then((r) => setConfigs(r.data)).catch(() => {});
    if (tab === 'mappings') api.get('/admin/column-mappings').then((r) => setMappings(r.data)).catch(() => {});
    if (tab === 'suppression') api.get('/admin/suppression-list').then((r) => setSuppression(r.data)).catch(() => {});
    if (tab === 'audit') api.get('/admin/audit-log').then((r) => setAuditLog(r.data)).catch(() => {});
    if (tab === 'languages') api.get('/admin/site-languages').then((r) => setSiteLanguages(r.data)).catch(() => {});
    if (tab === 'reset') {
      setResetStep('preview');
      setBackupDownloaded(false);
      setConfirmText('');
      setResetError('');
      setResetResult(null);
      setRestoreResult(null);
      api.get('/admin/reset-preview').then((r) => setResetPreview(r.data)).catch(() => {});
    }
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

  const handleAddLanguage = async () => {
    if (!newLangName.trim()) return;
    setLangSaving(true);
    setConfigError('');
    try {
      const res = await api.post('/admin/site-languages', {
        name: newLangName.trim(),
        code: newLangCode.trim() || null,
      });
      setSiteLanguages((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewLangName('');
      setNewLangCode('');
    } catch (err: any) {
      setConfigError(err.response?.data?.detail || 'Failed to add language');
    } finally {
      setLangSaving(false);
    }
  };

  const handleDeleteLanguage = async (id: number) => {
    setConfigError('');
    try {
      await api.delete(`/admin/site-languages/${id}`);
      setSiteLanguages((prev) => prev.filter((l) => l.id !== id));
    } catch {
      setConfigError('Failed to delete language.');
    }
  };

  const handleSaveLangCode = async (id: number) => {
    setConfigError('');
    try {
      await api.put(`/admin/site-languages/${id}`, { code: editLangCode.trim() || null });
      setSiteLanguages((prev) =>
        prev.map((l) => l.id === id ? { ...l, code: editLangCode.trim() || undefined } : l)
      );
      setEditingLangId(null);
    } catch (err: any) {
      setConfigError(err.response?.data?.detail || 'Failed to update language code');
    }
  };

  const handleAddCurrency = async () => {
    const code = newCurrCode.trim().toUpperCase();
    if (!code || !newCurrRate.trim()) return;
    setCurrSaving(true);
    setConfigError('');
    try {
      await api.put(`/admin/config/fx_rate_${code}`, { value: newCurrRate.trim() });
      const res = await api.get('/admin/config');
      setConfigs(res.data);
      setNewCurrCode('');
      setNewCurrRate('');
    } catch (err: any) {
      setConfigError(err.response?.data?.detail || 'Failed to add currency');
    } finally {
      setCurrSaving(false);
    }
  };

  const handleDeleteCurrency = async (key: string) => {
    const code = key.replace('fx_rate_', '');
    if (!confirm(`Delete FX rate for ${code}?`)) return;
    setConfigError('');
    try {
      await api.delete(`/admin/config/${key}`);
      setConfigs((prev) => prev.filter((c) => c.key !== key));
    } catch (err: any) {
      setConfigError(err.response?.data?.detail || 'Failed to delete currency');
    }
  };

  // ── System Reset handlers ────────────────────────────────
  const handleDownloadBackup = async () => {
    setResetLoading(true);
    setResetError('');
    try {
      const res = await api.post('/admin/reset-backup', {}, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers['content-disposition'];
      const match = disposition?.match(/filename="(.+?)"/);
      a.download = match ? match[1] : `salessupport_backup_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setBackupDownloaded(true);
    } catch {
      setResetError('Failed to download backup.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleExecuteReset = async () => {
    if (confirmText !== 'RESET') return;
    setResetLoading(true);
    setResetError('');
    try {
      const res = await api.post('/admin/reset-execute', {
        confirmation_text: confirmText,
        backup_downloaded: backupDownloaded,
      });
      setResetResult(res.data);
      setResetStep('complete');
    } catch (err: any) {
      setResetError(err.response?.data?.detail || 'Reset failed.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResetLoading(true);
    setResetError('');
    setRestoreResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/admin/reset-restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setRestoreResult(res.data);
    } catch (err: any) {
      setResetError(err.response?.data?.detail || 'Restore failed.');
    } finally {
      setResetLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Administration</h2>
        <p>System configuration, column mappings, site languages, and audit logs</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
          System Config
        </button>
        <button className={`tab ${tab === 'mappings' ? 'active' : ''}`} onClick={() => setTab('mappings')}>
          Column Mappings
        </button>
        <button className={`tab ${tab === 'languages' ? 'active' : ''}`} onClick={() => setTab('languages')}>
          Site Languages
        </button>
        <button className={`tab ${tab === 'suppression' ? 'active' : ''}`} onClick={() => setTab('suppression')}>
          Suppression List
        </button>
        <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>
          Audit Log
        </button>
        <button
          className={`tab ${tab === 'reset' ? 'active' : ''}`}
          onClick={() => setTab('reset')}
          style={tab === 'reset' ? { color: 'var(--danger)' } : { color: 'var(--danger)' }}
        >
          System Reset
        </button>
      </div>

      {tab === 'config' && (
        <>
          {/* FX Rates Card */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">FX Rates (Base Currency: SEK)</div>
            {configError && (
              <div style={{ padding: '8px 20px', color: 'var(--danger)', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                {configError}
              </div>
            )}
            <div className="card-body">
              <p style={{ fontSize: 13, color: '#718096', marginBottom: 12 }}>
                Revenue is stored in SEK and converted to the local currency of each consultant's site.
              </p>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Currency</th>
                      <th style={{ width: 150 }}>Rate (1 SEK =)</th>
                      <th>Description</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>SEK</strong></td>
                      <td style={{ color: '#718096' }}>1.00 (base)</td>
                      <td style={{ fontSize: 13, color: '#718096' }}>Base currency — Sweden</td>
                      <td></td>
                    </tr>
                    {configs.filter((c) => c.key.startsWith('fx_rate_')).map((c) => {
                      const currCode = c.key.replace('fx_rate_', '');
                      return (
                        <tr key={c.key}>
                          <td><strong>{currCode}</strong></td>
                          <td>
                            {editingConfig === c.key ? (
                              <input
                                className="form-control"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                style={{ maxWidth: 120 }}
                                type="number"
                                step="0.01"
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
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-outline" onClick={() => { setEditingConfig(c.key); setEditValue(c.value); }}>
                                  Edit
                                </button>
                                <button
                                  className="btn btn-sm btn-outline"
                                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '2px 8px', fontSize: 12 }}
                                  onClick={() => handleDeleteCurrency(c.key)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Add Currency Form */}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'flex-end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#4a5568', marginBottom: 4 }}>Currency Code *</label>
                  <input
                    className="form-control"
                    placeholder="e.g. CHF"
                    value={newCurrCode}
                    onChange={(e) => setNewCurrCode(e.target.value.toUpperCase())}
                    style={{ width: 100 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddCurrency(); }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#4a5568', marginBottom: 4 }}>Rate (1 SEK =) *</label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    placeholder="e.g. 0.93"
                    value={newCurrRate}
                    onChange={(e) => setNewCurrRate(e.target.value)}
                    style={{ width: 120 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddCurrency(); }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleAddCurrency}
                  disabled={currSaving || !newCurrCode.trim() || !newCurrRate.trim()}
                >
                  {currSaving ? 'Adding...' : 'Add Currency'}
                </button>
              </div>
            </div>
          </div>

          {/* General System Config */}
          <div className="card">
            <div className="card-header">System Parameters</div>
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
                  {configs.filter((c) => !c.key.startsWith('fx_rate_')).map((c) => (
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
        </>
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

      {tab === 'languages' && (
        <div className="card">
          <div className="card-header">Site Languages</div>
          <div className="card-body">
            <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
              Configure the available site languages. Consultants can select these on their profile for outreach matching.
            </div>

            {configError && (
              <div style={{ marginBottom: 12, padding: 8, background: '#fff5f5', borderRadius: 4, color: 'var(--danger)', fontSize: 13 }}>
                {configError}
              </div>
            )}

            {/* Add new language form */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#4a5568', marginBottom: 4 }}>Language Name *</label>
                <input
                  className="form-control"
                  placeholder="e.g. Swedish"
                  value={newLangName}
                  onChange={(e) => setNewLangName(e.target.value)}
                  style={{ width: 180 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddLanguage(); }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#4a5568', marginBottom: 4 }}>Code</label>
                <input
                  className="form-control"
                  placeholder="e.g. sv"
                  value={newLangCode}
                  onChange={(e) => setNewLangCode(e.target.value)}
                  style={{ width: 80 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddLanguage(); }}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleAddLanguage}
                disabled={langSaving || !newLangName.trim()}
              >
                {langSaving ? 'Adding...' : 'Add Language'}
              </button>
            </div>

            {/* Language list */}
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th style={{ width: 1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {siteLanguages.length === 0 ? (
                    <tr><td colSpan={3} className="empty-state">No site languages configured</td></tr>
                  ) : (
                    siteLanguages.map((l) => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 500 }}>{l.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#718096' }}>
                          {editingLangId === l.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input
                                className="form-control"
                                value={editLangCode}
                                onChange={(e) => setEditLangCode(e.target.value)}
                                style={{ width: 60, padding: '2px 6px', fontSize: 13, fontFamily: 'monospace' }}
                                placeholder="e.g. da"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveLangCode(l.id);
                                  if (e.key === 'Escape') setEditingLangId(null);
                                }}
                              />
                              <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleSaveLangCode(l.id)}>Save</button>
                              <button className="btn btn-sm btn-outline" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setEditingLangId(null)}>Cancel</button>
                            </div>
                          ) : (
                            <span
                              style={{ cursor: 'pointer', borderBottom: '1px dashed #a0aec0' }}
                              onClick={() => { setEditingLangId(l.id); setEditLangCode(l.code || ''); }}
                              title="Click to edit code"
                            >
                              {l.code || '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '2px 8px', fontSize: 12 }}
                            onClick={() => handleDeleteLanguage(l.id)}
                            title="Remove language"
                          >
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
                      <td>{formatDate(s.created_at)}</td>
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
                        {formatDateTime(l.timestamp)}
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

      {tab === 'reset' && (
        <div className="card">
          <div className="card-header" style={{ color: 'var(--danger)' }}>
            System Reset
          </div>
          <div className="card-body" style={{ padding: 20 }}>
            {resetError && (
              <div style={{ marginBottom: 12, padding: 8, background: '#fff5f5', borderRadius: 4, color: 'var(--danger)', fontSize: 13 }}>
                {resetError}
              </div>
            )}

            {/* STEP 1: Preview */}
            {resetStep === 'preview' && resetPreview && (
              <div>
                <div style={{
                  padding: 16, marginBottom: 16, background: '#fff5f5',
                  border: '2px solid var(--danger)', borderRadius: 8,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--danger)', marginBottom: 8 }}>
                    Warning: This will permanently delete all imported data
                  </div>
                  <div style={{ fontSize: 13, color: '#742a2a', lineHeight: 1.6 }}>
                    This action clears all contacts, meetings, outreach history, and lookup data.
                    Configuration (employees, templates, teams, etc.) will be preserved.
                    A backup of interaction data will be created first so you can restore knowledge about
                    who was previously contacted.
                  </div>
                </div>

                <h4 style={{ marginBottom: 12 }}>Data to be cleared:</h4>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr><th>Data</th><th style={{ textAlign: 'right' }}>Records</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Contacts</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.contacts_count}</td></tr>
                      <tr><td>Meetings</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.meetings_count}</td></tr>
                      <tr><td>Outreach Records</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.outreach_records_count}</td></tr>
                      <tr><td>Negations</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.negations_count}</td></tr>
                      <tr><td>Campaigns</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.campaigns_count ?? 0}</td></tr>
                      <tr><td>Campaign Recipients</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.campaign_recipients_count ?? 0}</td></tr>
                      <tr><td>Campaign Attachments</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.campaign_attachments_count ?? 0}</td></tr>
                      <tr><td>Suppression List</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.suppression_entries_count}</td></tr>
                      <tr><td>Imported Consultants</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.imported_consultants_count}</td></tr>
                      <tr><td>JobTitle Domains</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.jobtitle_domains_count}</td></tr>
                      <tr><td>Classification Lookups</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.classification_lookups_count}</td></tr>
                      <tr><td>File Uploads</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{resetPreview.file_uploads_count}</td></tr>
                      <tr>
                        <td>Files on disk</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {resetPreview.files_on_disk_count} files ({resetPreview.files_on_disk_size_mb} MB)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, padding: 12, background: '#f0fff4', borderRadius: 6, fontSize: 13, color: '#276749' }}>
                  <strong>Preserved:</strong> Admin/Manager accounts (non-imported), Business Areas, Teams, Sites,
                  Email Templates, Hot Topics, System Config, Column Mappings, Bank Holidays, Site Languages, Audit Log.
                </div>

                <div style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleDownloadBackup}
                    disabled={resetLoading}
                  >
                    {resetLoading ? 'Generating...' : 'Step 1: Download Backup'}
                  </button>
                  {backupDownloaded && (
                    <button
                      className="btn"
                      style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
                      onClick={() => setResetStep('confirm')}
                    >
                      Step 2: Proceed to Reset
                    </button>
                  )}
                </div>
                {backupDownloaded && (
                  <div style={{ marginTop: 8, fontSize: 13, color: '#276749' }}>
                    Backup downloaded successfully. You may now proceed to reset.
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Confirm */}
            {resetStep === 'confirm' && (
              <div>
                <div style={{
                  padding: 24, background: '#fff5f5',
                  border: '2px solid var(--danger)', borderRadius: 8,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>&#9888;</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--danger)', marginBottom: 12 }}>
                    Final Confirmation
                  </div>
                  <div style={{ fontSize: 14, color: '#742a2a', marginBottom: 20, lineHeight: 1.6 }}>
                    Type <strong>RESET</strong> below to confirm you want to permanently
                    delete all imported data. This action cannot be undone.
                  </div>
                  <input
                    className="form-control"
                    placeholder='Type "RESET" to confirm'
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                    style={{ maxWidth: 300, margin: '0 auto', textAlign: 'center', fontSize: 18, letterSpacing: 4 }}
                  />
                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
                    <button
                      className="btn btn-outline"
                      onClick={() => { setResetStep('preview'); setConfirmText(''); }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn"
                      style={{
                        background: confirmText === 'RESET' ? 'var(--danger)' : '#e2e8f0',
                        color: confirmText === 'RESET' ? '#fff' : '#a0aec0',
                        border: 'none',
                        cursor: confirmText === 'RESET' ? 'pointer' : 'not-allowed',
                      }}
                      disabled={confirmText !== 'RESET' || resetLoading}
                      onClick={handleExecuteReset}
                    >
                      {resetLoading ? 'Resetting...' : 'Execute System Reset'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Complete */}
            {resetStep === 'complete' && resetResult && (
              <div>
                <div style={{ padding: 16, background: '#f0fff4', borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: '#276749', marginBottom: 8, fontSize: 16 }}>
                    System Reset Complete
                  </div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr><th>Cleared</th><th style={{ textAlign: 'right' }}>Count</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(resetResult.deleted).map(([key, val]) => (
                          <tr key={key}>
                            <td style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{val as number}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#718096' }}>
                  You can now import fresh data via the Data Upload page. To restore previously known
                  interaction data (suppression list, contacted status), use the Restore section below.
                </div>
              </div>
            )}

            {/* ── Restore Section ── */}
            <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--border, #e2e8f0)' }}>
              <h4 style={{ marginBottom: 8 }}>Restore from Backup</h4>
              <div style={{ fontSize: 13, color: '#718096', marginBottom: 12 }}>
                Upload a previously downloaded backup file to restore suppression lists,
                flag contacts that were previously contacted, and recover manually curated
                data (expert areas, decision maker flags).
              </div>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button className="btn btn-outline" disabled={resetLoading}>
                  {resetLoading ? 'Restoring...' : 'Upload Backup File (.json)'}
                </button>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestore}
                  disabled={resetLoading}
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    opacity: 0, cursor: resetLoading ? 'not-allowed' : 'pointer',
                  }}
                />
              </div>

              {restoreResult && (
                <div style={{ marginTop: 12, padding: 12, background: '#f0fff4', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, color: '#276749', marginBottom: 8 }}>Restore Complete</div>
                  <div style={{ fontSize: 13 }}>
                    <div>Suppression entries restored: <strong>{restoreResult.suppression_restored}</strong></div>
                    <div>Contacts flagged as previously contacted: <strong>{restoreResult.contacts_flagged}</strong></div>
                    {restoreResult.contact_enrichments_restored > 0 && (
                      <div>Contact enrichments restored (expert areas, decision maker): <strong>{restoreResult.contact_enrichments_restored}</strong></div>
                    )}
                  </div>
                  {restoreResult.warnings?.length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto' }}>
                      <div style={{ fontWeight: 500, fontSize: 12, color: '#975a16' }}>Warnings:</div>
                      {restoreResult.warnings.map((w: string, i: number) => (
                        <div key={i} style={{ fontSize: 12, color: '#975a16' }}>{w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
