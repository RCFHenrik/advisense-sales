import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { FileUploadRecord } from '../types';

export default function UploadPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'contacts' | 'meetings'>('contacts');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<FileUploadRecord[]>([]);

  const canUpload = user?.role === 'admin' || user?.role === 'ba_manager';

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
      const endpoint = activeTab === 'contacts' ? '/uploads/contacts' : '/uploads/meetings';
      const res = await api.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      const histRes = await api.get('/uploads/history');
      setHistory(histRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-uploaded if needed
      e.target.value = '';
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Data Upload</h2>
        <p>Import contacts and meetings from HubSpot Excel exports</p>
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
            <button
              className={`tab ${activeTab === 'contacts' ? 'active' : ''}`}
              onClick={() => { setActiveTab('contacts'); setResult(null); setError(''); }}
            >
              Contacts Upload
            </button>
            <button
              className={`tab ${activeTab === 'meetings' ? 'active' : ''}`}
              onClick={() => { setActiveTab('meetings'); setResult(null); setError(''); }}
            >
              Meetings Upload
            </button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              {/* Invisible full-size input overlaid on the zone — works in all browsers */}
              <div className="upload-zone" style={{ position: 'relative' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📤</div>
                <div style={{ fontWeight: 500 }}>
                  {uploading
                    ? 'Uploading and processing...'
                    : `Click to upload ${activeTab === 'contacts' ? 'Contacts' : 'Meetings'} file`}
                </div>
                <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
                  Accepts .xlsx and .xls files
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
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

              {error && (
                <div style={{ marginTop: 16, padding: 12, background: '#fff5f5', borderRadius: 6, color: '#c53030' }}>
                  ⚠️ {error}
                </div>
              )}

              {result && (
                <div style={{ marginTop: 16, padding: 16, background: '#f0fff4', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#276749' }}>✅ Upload Complete</div>
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
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={7} className="empty-state">No uploads yet</td></tr>
                  ) : (
                    history.map((h) => (
                      <tr key={h.id}>
                        <td>{h.filename}</td>
                        <td style={{ textTransform: 'capitalize' }}>{h.file_type}</td>
                        <td>{h.row_count || '—'}</td>
                        <td style={{ color: '#276749' }}>+{h.added_count}</td>
                        <td style={{ color: '#975a16' }}>~{h.updated_count}</td>
                        <td style={{ color: '#c53030' }}>-{h.removed_count}</td>
                        <td>{new Date(h.uploaded_at).toLocaleString()}</td>
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
