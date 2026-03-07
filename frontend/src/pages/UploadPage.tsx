import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { FileUploadRecord } from '../types';
import { formatDateTime } from '../utils/dateFormat';

type UploadTab = 'contacts' | 'meetings' | 'classification' | 'jobtitle_domain' | 'consultants';

const TAB_CONFIG: Record<UploadTab, { label: string; endpoint: string; accept: string; description: string }> = {
  contacts: {
    label: 'Contacts',
    endpoint: '/uploads/contacts',
    accept: '.xlsx,.xls,.csv',
    description: 'Import contacts from CSV or Excel',
  },
  meetings: {
    label: 'Meetings',
    endpoint: '/uploads/meetings',
    accept: '.xlsx,.xls,.csv',
    description: 'Import meetings from CSV or Excel',
  },
  classification: {
    label: 'Classification',
    endpoint: '/uploads/classification',
    accept: '.xlsx,.xls,.csv',
    description: 'Import classification lookup data (CSV)',
  },
  jobtitle_domain: {
    label: 'JobTitle Domain',
    endpoint: '/uploads/jobtitle-domain',
    accept: '.xlsx,.xls',
    description: 'Import job title to domain mappings (Excel)',
  },
  consultants: {
    label: 'Consultants',
    endpoint: '/uploads/consultants',
    accept: '.xlsx,.xls,.csv',
    description: 'Batch import consultants (pending approval)',
  },
};

export default function UploadPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as UploadTab) || 'contacts';
  const [activeTab, setActiveTab] = useState<UploadTab>(initialTab);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<FileUploadRecord[]>([]);

  const canUpload = user?.role === 'admin' || user?.role === 'ba_manager';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (canUpload) {
      api.get('/uploads/history').then((r) => setHistory(r.data)).catch(() => {});
    }
  }, [canUpload]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const cfg = TAB_CONFIG[activeTab];
      const res = await api.post(cfg.endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      const histRes = await api.get('/uploads/history');
      setHistory(histRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteUpload = async (id: number) => {
    if (!window.confirm('Delete this upload record?')) return;
    try {
      await api.delete(`/uploads/history/${id}`);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const handleResetMappings = async (fileType: string) => {
    try {
      await api.post(`/admin/column-mappings/reset?file_type=${fileType}`);
      setError('');
      setResult({ _reset: true, file_type: fileType });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Reset failed');
    }
  };

  const cfg = TAB_CONFIG[activeTab];

  return (
    <div>
      <div className="page-header">
        <h2>Data Upload</h2>
        <p>Import contacts, meetings, classification, and domain mappings</p>
      </div>

      {!canUpload ? (
        <div className="card">
          <div className="card-body">
            <div style={{ padding: 24, textAlign: 'center', color: '#718096' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Access Restricted</div>
              <div style={{ fontSize: 13 }}>
                Only Admins and BA Managers can upload files. You are logged in as <strong>{user?.role}</strong>.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="tabs">
            {(Object.keys(TAB_CONFIG) as UploadTab[]).map((tab) => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab); setResult(null); setError(''); }}
              >
                {TAB_CONFIG[tab].label}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <div className="upload-zone" style={{ position: 'relative', opacity: uploading ? 0.7 : 1 }}>
                {uploading ? (
                  <>
                    <div
                      style={{
                        width: 40, height: 40, margin: '0 auto 12px',
                        border: '4px solid #e2e8f0', borderTopColor: 'var(--primary, #3182ce)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                    <div style={{ fontWeight: 500 }}>Uploading and processing...</div>
                    <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
                      Large files may take a minute or two. Please don't close this page.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📤</div>
                    <div style={{ fontWeight: 500 }}>Click to upload {cfg.label} file</div>
                    <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
                      {cfg.description}
                    </div>
                  </>
                )}
                <input
                  type="file"
                  accept={cfg.accept}
                  onChange={handleUpload}
                  disabled={uploading}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: uploading ? 'not-allowed' : 'pointer',
                  }}
                />
              </div>

              {(activeTab === 'contacts' || activeTab === 'meetings') && (
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button
                    className="btn btn-sm"
                    style={{ fontSize: 12, padding: '4px 10px', background: '#e2e8f0', color: '#4a5568', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                    onClick={() => handleResetMappings(activeTab)}
                  >
                    Reset Column Mappings
                  </button>
                </div>
              )}

              {error && (
                <div style={{ marginTop: 16, padding: 12, background: '#fff5f5', borderRadius: 6, color: '#c53030' }}>
                  {error}
                </div>
              )}

              {result && !result._reset && activeTab !== 'consultants' && (
                <div style={{ marginTop: 16, padding: 16, background: '#f0fff4', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#276749' }}>Upload Complete</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#276749' }}>{result.added}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Added</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#975a16' }}>{result.updated}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Updated</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#c53030' }}>{result.removed}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Removed</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{result.total_rows}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Total Rows</div>
                    </div>
                  </div>
                  {result.errors?.length > 0 && (
                    <div style={{ marginTop: 12, color: '#c53030', fontSize: 13 }}>
                      Warnings: {result.errors.join('; ')}
                    </div>
                  )}
                </div>
              )}

              {result && !result._reset && activeTab === 'consultants' && (
                <div style={{ marginTop: 16, padding: 16, background: '#f0fff4', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#276749' }}>Upload Complete</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#276749' }}>{result.added}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Added (Pending Approval)</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#975a16' }}>{result.skipped_duplicate}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Skipped (Duplicate)</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{result.total_rows}</div>
                      <div style={{ fontSize: 12, color: '#718096' }}>Total Rows</div>
                    </div>
                  </div>
                  {result.warnings?.length > 0 && (
                    <div style={{ marginTop: 12, color: '#975a16', fontSize: 13, maxHeight: 120, overflowY: 'auto' }}>
                      {result.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
                    </div>
                  )}
                </div>
              )}

              {result?._reset && (
                <div style={{ marginTop: 16, padding: 12, background: '#ebf8ff', borderRadius: 6, color: '#2b6cb0' }}>
                  Column mappings for <strong>{result.file_type}</strong> have been reset. New defaults will be applied on next upload.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">Upload History</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Rows</th>
                    <th>Added</th>
                    <th>Updated</th>
                    <th>Removed</th>
                    <th>Date</th>
                    {isAdmin && <th style={{ width: 1 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={isAdmin ? 8 : 7} className="empty-state">No uploads yet</td></tr>
                  ) : (
                    history.map((h) => (
                      <tr key={h.id}>
                        <td>{h.filename}</td>
                        <td style={{ textTransform: 'capitalize' }}>{h.file_type.replace('_', ' ')}</td>
                        <td>{h.row_count || '—'}</td>
                        <td style={{ color: '#276749' }}>+{h.added_count}</td>
                        <td style={{ color: '#975a16' }}>~{h.updated_count}</td>
                        <td style={{ color: '#c53030' }}>-{h.removed_count}</td>
                        <td>{formatDateTime(h.uploaded_at)}</td>
                        {isAdmin && (
                          <td>
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)', padding: '2px 8px', fontSize: 12 }}
                              onClick={() => handleDeleteUpload(h.id)}
                              title="Delete record"
                            >
                              Delete
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
        </>
      )}
    </div>
  );
}
