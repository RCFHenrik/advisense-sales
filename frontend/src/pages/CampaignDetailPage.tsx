import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CampaignDetail, CampaignRecipient, FilterOptions, Contact, Employee, CampaignAnalysisResult } from '../types';
import SearchableSelect from '../components/SearchableSelect';
import MultiSelectFilter from '../components/MultiSelectFilter';
import ActiveFiltersBar from '../components/ActiveFiltersBar';
import CampaignBuilder from '../components/CampaignBuilder';
import { Crown, Tag, Filter, UserPlus } from 'lucide-react';

function parseRelevanceTags(raw?: string): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'fi', label: 'Finnish' },
];

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Editable fields (draft mode)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailLanguage, setEmailLanguage] = useState('en');
  const [bccMode, setBccMode] = useState(true);

  // Recipient filter options (for CampaignBuilder)
  const [filters, setFilters] = useState<FilterOptions | null>(null);

  // Attachment upload
  const [uploading, setUploading] = useState(false);

  // AI analysis state
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] = useState<CampaignAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [addingRecipients, setAddingRecipients] = useState(false);

  // Coverage gap hints
  const [gapHints, setGapHints] = useState<{
    hints: Array<{
      company_name: string;
      critical_gap_count: number;
      potential_gap_count: number;
      missing_domains_critical: string[];
      missing_titles_critical: string[];
      missing_domains_potential: string[];
      missing_titles_potential: string[];
      contacts_in_campaign: number;
    }>;
    summary: { companies_checked: number; companies_with_gaps: number; total_critical: number; total_potential: number };
    aggregated?: {
      top_critical_domains: Array<{ name: string; count: number; companies: string[] }>;
      top_critical_titles: Array<{ name: string; count: number; companies: string[] }>;
      top_potential_domains: Array<{ name: string; count: number; companies: string[] }>;
      top_potential_titles: Array<{ name: string; count: number; companies: string[] }>;
      industries: Array<{ name: string; count: number; companies: string[] }>;
    };
  } | null>(null);
  const [gapExpanded, setGapExpanded] = useState(true);
  const [gapExporting, setGapExporting] = useState(false);

  // Consultant assignment
  const [consultants, setConsultants] = useState<{ id: number; name: string }[]>([]);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await api.get(`/campaigns/${id}`);
      const data = res.data as CampaignDetail;
      setCampaign(data);
      // Fetch gap hints if campaign has recipients
      if (data.recipients.length > 0) {
        api.get(`/campaigns/${id}/gap-hints`).then((r) => setGapHints(r.data)).catch(() => {});
      } else {
        setGapHints(null);
      }
      setName(data.name);
      setDescription(data.description || '');
      setEmailSubject(data.email_subject);
      setEmailBody(data.email_body);
      setEmailLanguage(data.email_language);
      setBccMode(data.bcc_mode);
    } catch {
      setError('Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);

  useEffect(() => {
    api.get('/contacts/filters').then((res) => setFilters(res.data)).catch(() => {});
  }, []);

  // Fetch active consultants for assignment dropdown
  useEffect(() => {
    api.get('/employees/', { params: { status: 'approved' } })
      .then((res) => {
        const emps = (res.data as Employee[]).filter((e) => e.is_active);
        setConsultants(emps.map((e) => ({ id: e.id, name: e.name })));
      })
      .catch(() => {});
  }, []);

  const isDraft = campaign?.status === 'draft';
  const isReady = campaign?.status === 'ready';
  const isSent = campaign?.status === 'sent';
  const isCancelled = campaign?.status === 'cancelled';

  const saveDraft = async () => {
    setSaving(true);
    try {
      await api.put(`/campaigns/${id}`, {
        name, description: description || null,
        email_subject: emailSubject, email_body: emailBody,
        email_language: emailLanguage, bcc_mode: bccMode,
      });
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  const clearAllRecipients = async () => {
    if (!campaign) return;
    const count = campaign.recipients?.length || 0;
    if (!window.confirm(`Are you sure you want to remove all ${count} recipients?`)) return;
    try {
      await api.delete(`/campaigns/${id}/recipients/all`);
      await fetchCampaign();
    } catch {}
  };

  const removeRecipient = async (contactId: number) => {
    try {
      await api.delete(`/campaigns/${id}/recipients`, { data: { contact_ids: [contactId] } });
      await fetchCampaign();
    } catch {}
  };

  const finalize = async () => {
    try {
      await api.post(`/campaigns/${id}/finalize`);
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Cannot finalize');
    }
  };

  const revertToDraft = async () => {
    try {
      await api.post(`/campaigns/${id}/revert-to-draft`);
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Cannot revert');
    }
  };

  const sendCampaign = async () => {
    if (!confirm(`Send this campaign to ${campaign?.recipient_count} recipients?`)) return;
    try {
      await api.post(`/campaigns/${id}/send`);
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Send failed');
    }
  };

  const cancelCampaign = async () => {
    if (!confirm('Cancel this campaign?')) return;
    try {
      await api.post(`/campaigns/${id}/cancel`);
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Cancel failed');
    }
  };

  const deleteCampaign = async () => {
    if (!confirm(`Permanently remove "${campaign?.name}"? This will delete all recipients and attachments.`)) return;
    try {
      await api.delete(`/campaigns/${id}`);
      navigate('/campaigns');
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Delete failed');
    }
  };

  const canDeleteCampaign = () => {
    if (!campaign || !user) return false;
    if (campaign.status === 'sent' || campaign.status === 'sending') return false;
    const role = user.role || '';
    if (['admin', 'ba_manager'].includes(role)) return true;
    if (user.id === campaign.created_by_id) return true;
    return false;
  };

  const assignConsultant = async (recipientId: number, consultantId: number) => {
    try {
      await api.post(`/campaigns/${id}/recipients/${recipientId}/assign`, { consultant_id: consultantId });
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to assign consultant');
    }
  };

  const unassignConsultant = async (recipientId: number) => {
    try {
      await api.post(`/campaigns/${id}/recipients/${recipientId}/unassign`);
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to unassign consultant');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/campaigns/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await fetchCampaign();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    try {
      await api.delete(`/campaigns/${id}/attachments/${attachmentId}`);
      await fetchCampaign();
    } catch {}
  };

  const analyzeAttachment = async (attachmentId: number) => {
    setAnalyzing(attachmentId);
    setAnalysisError('');
    setAnalysisResult(null);
    try {
      const res = await api.post(`/campaigns/${id}/analyze-attachment/${attachmentId}`);
      setAnalysisResult(res.data as CampaignAnalysisResult);
    } catch (err: any) {
      setAnalysisError(err.response?.data?.detail || 'AI analysis failed');
    } finally {
      setAnalyzing(null);
    }
  };

  const addSuggestedRecipients = async (contactIds: number[]) => {
    setAddingRecipients(true);
    try {
      await api.post(`/campaigns/${id}/recipients`, { contact_ids: contactIds });
      await fetchCampaign();
      setAnalysisResult(null);
    } catch (err: any) {
      setAnalysisError(err.response?.data?.detail || 'Failed to add recipients');
    } finally {
      setAddingRecipients(false);
    }
  };

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (error || !campaign) return <div style={{ padding: 32, color: 'var(--danger)' }}>{error || 'Not found'}</div>;

  const statusBadge = (s: string) => {
    const cls: Record<string, string> = {
      draft: 'badge-draft', ready: 'badge-ready', sending: 'badge-sending',
      sent: 'badge-sent', cancelled: 'badge-cancelled',
    };
    return <span className={`badge ${cls[s] || ''}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>;
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button className="btn btn-sm" onClick={() => navigate('/campaigns')}>&larr; Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isDraft ? (
              <input
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ fontSize: 20, fontWeight: 600, maxWidth: 400 }}
              />
            ) : (
              campaign.name
            )}
            {statusBadge(campaign.status)}
          </h1>
        </div>
      </div>

      {/* ── DRAFT / READY: Settings & Email ───────────────────────── */}
      {(isDraft || isReady) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Settings card */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>Settings</h3>
            <div className="form-group">
              <label>Description</label>
              <input className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!isDraft} />
            </div>
            <div className="form-group" style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Language</label>
                <select className="form-control" value={emailLanguage} onChange={(e) => setEmailLanguage(e.target.value)} disabled={!isDraft}>
                  {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'end', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={bccMode} onChange={(e) => setBccMode(e.target.checked)} disabled={!isDraft} />
                  Anonymized (BCC)
                </label>
              </div>
            </div>
          </div>

          {/* Email content card */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>Email Content</h3>
            <div className="form-group">
              <label>Subject</label>
              <input className="form-control" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} disabled={!isDraft} />
            </div>
            <div className="form-group">
              <label>Body</label>
              <textarea
                className="form-control"
                rows={8}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                disabled={!isDraft}
                style={{ fontFamily: 'inherit', resize: 'vertical' }}
              />
            </div>
            {isDraft && (
              <button className="btn btn-primary" onClick={saveDraft} disabled={saving}>
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SENT summary ──────────────────────────────────────────── */}
      {isSent && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3>Campaign Summary</h3>
          <div style={{ display: 'flex', gap: 32, marginTop: 12 }}>
            <div><strong>Subject:</strong> {campaign.email_subject}</div>
            <div><strong>Language:</strong> {campaign.email_language?.toUpperCase()}</div>
            <div><strong>BCC:</strong> {campaign.bcc_mode ? 'Yes' : 'No'}</div>
            <div><strong>Sent:</strong> {campaign.sent_at ? new Date(campaign.sent_at).toLocaleString() : '—'}</div>
            <div><strong>Recipients:</strong> {campaign.recipient_count}</div>
          </div>
          {campaign.email_body && (
            <div style={{ marginTop: 12, padding: 12, background: '#f7fafc', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {campaign.email_body}
            </div>
          )}
        </div>
      )}

      {isCancelled && (
        <div className="card" style={{ padding: 20, marginBottom: 16, borderLeft: '4px solid var(--danger)' }}>
          <h3>Campaign Cancelled</h3>
          <p style={{ color: '#999' }}>This campaign was cancelled and was not sent.</p>
        </div>
      )}

      {/* ── Attachments ─────────────────────────────────────────── */}
      {(isDraft || isReady || isSent) && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>
            Attachments ({campaign.attachments?.length || 0})
          </h3>
          {isDraft && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button className="btn btn-sm btn-outline" disabled={uploading}>
                  {uploading ? 'Uploading...' : 'Upload Attachment'}
                </button>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  accept=".pdf,.pptx,.ppt,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                />
              </div>
              <span style={{ fontSize: 12, color: '#718096', marginLeft: 8 }}>
                PDF, PowerPoint, Word, Excel, images (max 25 MB)
              </span>
            </div>
          )}
          {campaign.attachments && campaign.attachments.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th style={{ width: 1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.attachments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.display_name}</td>
                      <td style={{ fontSize: 12, color: '#718096' }}>
                        {a.content_type.split('/').pop()?.replace('vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx')
                          .replace('vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx')
                          .replace('vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx')
                          .replace('vnd.ms-powerpoint', 'ppt')
                          .replace('vnd.ms-excel', 'xls') || a.content_type}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {a.file_size_bytes < 1024 * 1024
                          ? `${(a.file_size_bytes / 1024).toFixed(0)} KB`
                          : `${(a.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => window.open(`/api/campaigns/${id}/attachments/${a.id}/download`, '_blank')}
                          >
                            Download
                          </button>
                          {(a.content_type.includes('pdf') || a.content_type.includes('presentation')) && (
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={analyzing === a.id}
                              onClick={() => analyzeAttachment(a.id)}
                              title="Analyze with AI to suggest contacts"
                            >
                              {analyzing === a.id ? 'Analyzing...' : 'AI Analyze'}
                            </button>
                          )}
                          {isDraft && (
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                              onClick={() => removeAttachment(a.id)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: '#999', fontSize: 13 }}>No attachments added</div>
          )}
        </div>
      )}


      {/* -- AI Analysis Results -- */}
      {analysisError && (
        <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>AI Analysis Error: {analysisError}</p>
        </div>
      )}
      {analysisResult && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>AI Analysis Results</h3>
            <button className="btn btn-sm btn-outline" onClick={() => setAnalysisResult(null)}>Close</button>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Extracted Themes:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {analysisResult.extracted_themes.map((theme, i) => (
                <span key={i} style={{
                  display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                  background: '#ebf8ff', color: '#2b6cb0', fontSize: 12, fontWeight: 500,
                }}>{theme}</span>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Suggested Contacts ({analysisResult.total_matches} matches):</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-sm btn-primary"
                disabled={addingRecipients}
                onClick={() => addSuggestedRecipients(analysisResult.suggested_contacts.map(c => c.contact_id))}
              >
                {addingRecipients ? 'Adding...' : `Add All ${analysisResult.suggested_contacts.length} Contacts`}
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Title</th>
                  <th>Score</th>
                  <th>Matched Tags</th>
                  <th>DM</th>
                </tr>
              </thead>
              <tbody>
                {analysisResult.suggested_contacts.map((c) => (
                  <tr key={c.contact_id}>
                    <td>{c.full_name}</td>
                    <td>{c.company_name}</td>
                    <td>{c.job_title}</td>
                    <td style={{ fontWeight: 600 }}>{c.match_score.toFixed(1)}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {c.matched_tags.map((tag, i) => (
                          <span key={i} style={{
                            display: 'inline-block', padding: '1px 6px', borderRadius: 8,
                            background: '#e6fffa', color: '#234e52', fontSize: 11,
                          }}>{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td>{c.is_decision_maker ? 'Yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Coverage Gap Insights ────────────────────────────── */}
      {gapHints && gapHints.hints.length > 0 && (
        <div style={{
          marginBottom: 16,
          border: '1px solid #fed7d7',
          borderRadius: 8,
          background: '#fff5f5',
          overflow: 'hidden',
        }}>
          <div
            style={{
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onClick={() => setGapExpanded(!gapExpanded)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span style={{ fontWeight: 600, color: 'var(--danger)', fontSize: 14 }}>
                Coverage Gap Insights
              </span>
              <span style={{ color: '#718096', fontSize: 12 }}>
                {gapHints.summary.companies_with_gaps} of {gapHints.summary.companies_checked} companies have gaps
                — {gapHints.summary.total_critical} critical, {gapHints.summary.total_potential} potential
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn btn-sm"
                disabled={gapExporting}
                onClick={(e) => {
                  e.stopPropagation();
                  setGapExporting(true);
                  api.get(`/campaigns/${id}/gap-hints/export`, { responseType: 'blob' })
                    .then((res) => {
                      const disposition = res.headers['content-disposition'] || '';
                      const match = disposition.match(/filename="?([^"]+)"?/);
                      const filename = match ? match[1] : `gap_analysis_${campaign.name}.csv`;
                      const url = window.URL.createObjectURL(new Blob([res.data]));
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename;
                      a.click();
                      window.URL.revokeObjectURL(url);
                    })
                    .catch(() => setError('Failed to export gap analysis'))
                    .finally(() => setGapExporting(false));
                }}
                style={{ fontSize: 11, padding: '2px 10px', border: '1px solid #e2e8f0', background: 'white', color: '#4a5568', borderRadius: 4 }}
              >
                {gapExporting ? 'Exporting...' : 'Export CSV'}
              </button>
              <span style={{ color: '#718096', fontSize: 18, transform: gapExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>
          </div>
          {gapExpanded && (
            <div style={{ display: 'flex', gap: 16, padding: '0 16px 12px' }}>
              {/* Left: Company-level gaps (existing) */}
              <div style={{ flex: '1 1 55%', maxHeight: 360, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, color: '#718096', marginBottom: 8 }}>
                  Companies with known coverage gaps — consider adding contacts to fill these roles.
                </div>
                {gapHints.hints.map((h, i) => (
                  <div key={i} style={{
                    padding: '8px 12px',
                    marginBottom: 6,
                    background: 'white',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 13 }}>{h.company_name}</strong>
                      <span style={{ fontSize: 10, color: '#718096' }}>({h.contacts_in_campaign} contact{h.contacts_in_campaign !== 1 ? 's' : ''} in campaign)</span>
                      {h.critical_gap_count > 0 && (
                        <span style={{ fontSize: 10, background: '#fed7d7', color: 'var(--danger)', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>
                          {h.critical_gap_count} critical
                        </span>
                      )}
                      {h.potential_gap_count > 0 && (
                        <span style={{ fontSize: 10, background: '#fefcbf', color: '#b7791f', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>
                          {h.potential_gap_count} potential
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {h.missing_domains_critical.map((d, j) => (
                        <span key={'dc'+j} style={{ fontSize: 10, background: '#fed7d7', color: 'var(--danger)', borderRadius: 8, padding: '1px 6px' }}>{d}</span>
                      ))}
                      {h.missing_titles_critical.map((t, j) => (
                        <span key={'tc'+j} style={{ fontSize: 10, background: '#fed7d7', color: '#9b2c2c', borderRadius: 8, padding: '1px 6px', fontStyle: 'italic' }}>{t}</span>
                      ))}
                      {h.missing_domains_potential.map((d, j) => (
                        <span key={'dp'+j} style={{ fontSize: 10, background: '#fefcbf', color: '#b7791f', borderRadius: 8, padding: '1px 6px' }}>{d}</span>
                      ))}
                      {h.missing_titles_potential.map((t, j) => (
                        <span key={'tp'+j} style={{ fontSize: 10, background: '#fefcbf', color: '#975a16', borderRadius: 8, padding: '1px 6px', fontStyle: 'italic' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right: Aggregated insights */}
              {gapHints.aggregated && (
                <div style={{ flex: '1 1 45%', maxHeight: 360, overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, color: '#718096', marginBottom: 8 }}>
                    Aggregated priorities across {gapHints.summary.companies_with_gaps} companies with gaps
                  </div>

                  {/* Reusable bar row renderer with hover tooltip */}
                  {(() => {
                    const BarRow = ({ item, barBg, fillBg, totalCompanies }: {
                      item: { name: string; count: number; companies?: string[] };
                      barBg: string; fillBg: string; totalCompanies: number;
                    }) => (
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, cursor: 'default', position: 'relative' }}
                        title={item.companies?.join('\n') || ''}
                      >
                        <div style={{
                          flex: '0 0 120px', fontSize: 11, color: '#2d3748', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{item.name}</div>
                        <div style={{ flex: 1, background: barBg, borderRadius: 4, height: 14 }}>
                          <div style={{
                            width: `${Math.min(100, (item.count / totalCompanies) * 100)}%`,
                            background: fillBg, borderRadius: 4, height: '100%', minWidth: 2,
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: '#718096', flex: '0 0 50px', textAlign: 'right' }}>
                          {item.count} co.
                        </span>
                      </div>
                    );

                    const total = gapHints.summary.companies_with_gaps;
                    const agg = gapHints.aggregated!;

                    return (<>
                      {/* Most missed: critical domains */}
                      {agg.top_critical_domains.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 6, border: '1px solid #e2e8f0', padding: '10px 12px', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#e53e3e', marginBottom: 6 }}>
                            Most Peers Have (Missing Domains)
                          </div>
                          {agg.top_critical_domains.map((d, i) => (
                            <BarRow key={i} item={d} barBg="#fed7d7" fillBg="#e53e3e" totalCompanies={total} />
                          ))}
                        </div>
                      )}

                      {/* Most missed: critical titles */}
                      {agg.top_critical_titles.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 6, border: '1px solid #e2e8f0', padding: '10px 12px', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#e53e3e', marginBottom: 6 }}>
                            Most Peers Have (Missing Titles)
                          </div>
                          {agg.top_critical_titles.map((t, i) => (
                            <BarRow key={i} item={t} barBg="#fed7d7" fillBg="#e53e3e" totalCompanies={total} />
                          ))}
                        </div>
                      )}

                      {/* Some peers have: potential domains */}
                      {agg.top_potential_domains.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 6, border: '1px solid #e2e8f0', padding: '10px 12px', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#b7791f', marginBottom: 6 }}>
                            Some Peers Have (Potential Domains)
                          </div>
                          {agg.top_potential_domains.map((d, i) => (
                            <BarRow key={i} item={d} barBg="#fefcbf" fillBg="#d69e2e" totalCompanies={total} />
                          ))}
                        </div>
                      )}

                      {/* Some peers have: potential titles */}
                      {agg.top_potential_titles.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 6, border: '1px solid #e2e8f0', padding: '10px 12px', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#b7791f', marginBottom: 6 }}>
                            Some Peers Have (Potential Titles)
                          </div>
                          {agg.top_potential_titles.map((t, i) => (
                            <BarRow key={i} item={t} barBg="#fefcbf" fillBg="#d69e2e" totalCompanies={total} />
                          ))}
                        </div>
                      )}

                      {/* Industry breakdown */}
                      {agg.industries.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 6, border: '1px solid #e2e8f0', padding: '10px 12px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#4a5568', marginBottom: 6 }}>
                            Gaps by Industry
                          </div>
                          {agg.industries.map((ind, i) => (
                            <BarRow key={i} item={ind} barBg="#e2e8f0" fillBg="#4299e1" totalCompanies={total} />
                          ))}
                        </div>
                      )}
                    </>);
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Recipient Builder (draft/ready) ───────────────────────── */}
      {(isDraft || isReady) && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>
            Recipients ({campaign.recipients.length})
          </h3>

          {isDraft && filters && (
            <CampaignBuilder
              campaignId={campaign.id}
              filterOptions={filters}
              onRecipientsAdded={fetchCampaign}
            />
          )}

          {/* Clear All Recipients button */}
          {(isDraft || isReady) && campaign.recipients.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button
                className="btn btn-sm"
                onClick={clearAllRecipients}
                style={{ color: 'var(--danger)', border: '1px solid var(--danger)', background: 'transparent' }}
              >
                Clear All Recipients
              </button>
            </div>
          )}

          {/* Consultant assignment summary */}
          {(() => {
            const assigned = campaign.recipients.filter((r) => r.assigned_consultant_id);
            if (assigned.length === 0) return null;
            const accepted = assigned.filter((r) => r.consultant_status === 'accepted').length;
            const pending = assigned.length - accepted;
            return (
              <div style={{ fontSize: 13, color: '#4a5568', marginBottom: 8, padding: '6px 10px', background: '#edf2f7', borderRadius: 6 }}>
                {assigned.length} assigned to consultants ({accepted} accepted, {pending} pending)
              </div>
            );
          })()}

          {/* Recipients table */}
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Title</th>
                  <th>Domain</th>
                  <th>Country</th>
                  <th>Tier</th>
                  <th style={{ textAlign: 'center', width: 80 }}>Info</th>
                  <th>Consultant</th>
                  {isSent && <th>Status</th>}
                  {isDraft && <th></th>}
                </tr>
              </thead>
              <tbody>
                {campaign.recipients.length === 0 ? (
                  <tr><td colSpan={isDraft ? 12 : 11} style={{ textAlign: 'center', padding: 24, color: '#999' }}>
                    No recipients added yet
                  </td></tr>
                ) : (
                  campaign.recipients.map((r) => (
                    <tr key={r.id}>
                      <td>{r.contact_name || '—'}</td>
                      <td>{r.contact_email || '—'}</td>
                      <td>{r.contact_company || '—'}</td>
                      <td>{r.contact_job_title || '—'}</td>
                      <td>{r.contact_domain || '—'}</td>
                      <td>{r.contact_domicile || '—'}</td>
                      <td>{r.contact_tier ? <span className="badge">{r.contact_tier}</span> : '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                          {r.contact_is_decision_maker && <Crown size={14} color="#d69e2e" style={{ cursor: 'help' }} title="Decision Maker" />}
                          {(parseRelevanceTags(r.contact_relevance_tags).length > 0 || r.contact_relevant_search) && (
                            <Tag size={14} color="#3182ce" style={{ cursor: 'help' }} title={
                              parseRelevanceTags(r.contact_relevance_tags).length > 0
                                ? `Relevant: ${parseRelevanceTags(r.contact_relevance_tags).join(', ')}`
                                : 'Relevant Search'
                            } />
                          )}
                          {r.added_via === 'filter' && <Filter size={14} color="var(--accent)" style={{ cursor: 'help' }} title="Added via filter" />}
                          {r.added_via === 'individual' && <UserPlus size={14} color="#805ad5" style={{ cursor: 'help' }} title="Added individually" />}
                        </div>
                      </td>
                      <td>
                        {(isDraft || isReady) ? (
                          r.assigned_consultant_id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                              <span>{r.assigned_consultant_name}</span>
                              {r.consultant_status === 'accepted' ? (
                                <span style={{ color: 'var(--accent)', fontSize: 11 }}>&#10003;</span>
                              ) : (
                                <span className="badge" style={{ background: 'var(--warning)', color: '#744210', fontSize: 10 }}>pending</span>
                              )}
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 10, color: 'var(--danger)', padding: '0 4px', minWidth: 'auto' }}
                                onClick={() => unassignConsultant(r.id)}
                                title="Remove consultant assignment"
                              >
                                &times;
                              </button>
                            </div>
                          ) : (
                            <SearchableSelect
                              options={consultants.map((c) => ({ value: c.id, label: c.name }))}
                              placeholder="— Marketing —"
                              onSelect={(cid) => assignConsultant(r.id, cid)}
                              style={{ minWidth: 140, maxWidth: 180 }}
                            />
                          )
                        ) : (
                          r.assigned_consultant_name ? (
                            <div style={{ fontSize: 12 }}>
                              {r.assigned_consultant_name}
                              {r.consultant_status === 'accepted' ? (
                                <span style={{ color: 'var(--accent)', marginLeft: 4 }}>&#10003;</span>
                              ) : (
                                <span className="badge" style={{ background: 'var(--warning)', color: '#744210', fontSize: 10, marginLeft: 4 }}>pending</span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#999', fontSize: 11 }}>Marketing</span>
                          )
                        )}
                      </td>
                      {isSent && <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>}
                      {isDraft && (
                        <td>
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--danger)', fontSize: 11 }}
                            onClick={() => removeRecipient(r.contact_id)}
                          >
                            Remove
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
      )}

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        {isDraft && (
          <>
            <button className="btn btn-primary" onClick={finalize}>Finalize Campaign</button>
            <button className="btn btn-sm" onClick={cancelCampaign} style={{ background: '#e07c24', color: '#000', fontWeight: 600 }}>Cancel Campaign</button>
          </>
        )}
        {isReady && (
          <>
            <button className="btn btn-primary" onClick={sendCampaign}>Send Campaign</button>
            <button className="btn btn-sm" onClick={revertToDraft}>Back to Draft</button>
          </>
        )}
        {canDeleteCampaign() && (
          <button
            className="btn btn-sm"
            onClick={deleteCampaign}
            style={{ color: 'var(--danger)', marginLeft: 'auto' }}
          >
            Remove Campaign
          </button>
        )}
      </div>
    </>
  );
}
