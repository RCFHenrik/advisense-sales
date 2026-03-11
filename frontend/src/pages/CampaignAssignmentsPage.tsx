import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CampaignAssignment, OutreachRecord } from '../types';
import { CheckCircle, Mail, Edit3, Send, ArrowRight, CornerDownRight, ChevronDown, ChevronRight, Paperclip } from 'lucide-react';

const ACTIONABLE_STATUSES = ['proposed', 'accepted', 'draft', 'prepared'];

const statusColor: Record<string, { bg: string; color: string }> = {
  proposed: { bg: '#ebf8ff', color: '#2b6cb0' },
  accepted: { bg: '#f0fff4', color: '#276749' },
  draft: { bg: '#fffff0', color: '#744210' },
  prepared: { bg: '#faf5ff', color: '#553c9a' },
};

export default function CampaignAssignmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<CampaignAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [outreachRecords, setOutreachRecords] = useState<OutreachRecord[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(true);

  // Editing state: keyed by recipient_id
  const [editing, setEditing] = useState<Record<number, { subject: string; body: string }>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [accepting, setAccepting] = useState<Record<number, boolean>>({});
  const [openCampaigns, setOpenCampaigns] = useState<Record<number, boolean>>({});
  const [hoveredCampaign, setHoveredCampaign] = useState<number | null>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await api.get('/campaigns/my-assignments');
      setAssignments(res.data as CampaignAssignment[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOutreach = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/outreach/', {
        params: { employee_id: user.id, page_size: 200, sort_by: 'updated_at', sort_dir: 'desc' },
      });
      const all = (res.data.items || []) as OutreachRecord[];
      setOutreachRecords(all.filter((r) => ACTIONABLE_STATUSES.includes(r.status)));
    } catch {
      // ignore
    } finally {
      setOutreachLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);
  useEffect(() => { fetchOutreach(); }, [fetchOutreach]);

  const startEditing = (a: CampaignAssignment) => {
    setEditing((prev) => ({
      ...prev,
      [a.recipient_id]: {
        subject: a.custom_email_subject || a.default_email_subject,
        body: a.custom_email_body || a.default_email_body,
      },
    }));
  };

  const cancelEditing = (rid: number) => {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[rid];
      return next;
    });
  };

  const saveCustom = async (rid: number) => {
    const edit = editing[rid];
    if (!edit) return;
    setSaving((prev) => ({ ...prev, [rid]: true }));
    try {
      await api.put(`/campaigns/assignments/${rid}/customize`, {
        email_subject: edit.subject,
        email_body: edit.body,
      });
      cancelEditing(rid);
      await fetchAssignments();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving((prev) => ({ ...prev, [rid]: false }));
    }
  };

  const acceptAssignment = async (a: CampaignAssignment) => {
    setAccepting((prev) => ({ ...prev, [a.recipient_id]: true }));
    try {
      await api.post(`/campaigns/assignments/${a.recipient_id}/accept`);
      await fetchAssignments();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Accept failed');
    } finally {
      setAccepting((prev) => ({ ...prev, [a.recipient_id]: false }));
    }
  };

  // Group assignments by campaign
  const grouped = assignments.reduce<Record<number, { name: string; items: CampaignAssignment[] }>>((acc, a) => {
    if (!acc[a.campaign_id]) {
      acc[a.campaign_id] = { name: a.campaign_name, items: [] };
    }
    acc[a.campaign_id].items.push(a);
    return acc;
  }, {});

  const bothLoading = loading && outreachLoading;
  if (bothLoading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  const hasAny = assignments.length > 0;
  const pendingCount = assignments.filter((a) => a.consultant_status !== 'accepted').length;
  const totalItems = outreachRecords.length + assignments.length;

  return (
    <>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1>My Assignments</h1>
        <p style={{ color: '#718096', margin: '4px 0 0' }}>
          {totalItems > 0
            ? `${outreachRecords.length} outreach · ${assignments.length} campaign assignment${assignments.length !== 1 ? 's' : ''}${pendingCount > 0 ? ` — ${pendingCount} pending` : ''}`
            : 'No assignments yet'}
        </p>
      </div>

      {/* ── Side-by-side layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* ── My Outreach (left) ── */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
            <Send size={16} />
            My Outreach ({outreachRecords.length})
          </h3>

          {outreachRecords.length === 0 && !outreachLoading ? (
            <p style={{ color: '#999', textAlign: 'center', padding: 16, fontSize: 13 }}>
              No outreach items right now.
            </p>
          ) : (
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {outreachRecords.map((r) => {
                const sc = statusColor[r.status] || { bg: '#f7fafc', color: '#4a5568' };
                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/outreach/${r.id}`)}
                    style={{
                      borderBottom: '1px solid #edf2f7',
                      padding: '8px 6px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f7fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.contact_name || `Contact #${r.contact_id}`}
                        </span>
                        {r.redirected_from_id && (
                          <CornerDownRight size={13} style={{ color: '#805ad5', flexShrink: 0 }} title="Redirected" />
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#718096', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[r.contact_company, r.contact_job_title].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                      {r.recommendation_score != null && (
                        <span style={{ fontSize: 11, color: '#718096', fontWeight: 500 }}>
                          {Math.round(r.recommendation_score)}
                        </span>
                      )}
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                        background: sc.bg, color: sc.color, textTransform: 'capitalize',
                      }}>
                        {r.status}
                      </span>
                      <ArrowRight size={14} style={{ color: '#cbd5e0' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Campaign Assignments (right) ── */}
        <div>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
              <Mail size={16} />
              Campaign Assignments ({assignments.length})
            </h3>

            {!hasAny && (
              <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
                <Mail size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                <p style={{ fontSize: 13 }}>When a campaign manager assigns you to personally send a campaign email, it will appear here.</p>
              </div>
            )}

            {Object.entries(grouped).map(([campId, group]) => {
              const cId = Number(campId);
              const isOpen = !!openCampaigns[cId];
              const sample = group.items[0];
              const pendingInGroup = group.items.filter((x) => x.consultant_status !== 'accepted').length;
              const isHovered = hoveredCampaign === cId;

              const langLabel: Record<string, string> = { sv: 'Swedish', en: 'English', no: 'Norwegian', da: 'Danish', de: 'German', fi: 'Finnish' };

              return (
              <div key={campId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                {/* Collapsible header */}
                <div
                  onClick={() => setOpenCampaigns((prev) => ({ ...prev, [cId]: !prev[cId] }))}
                  onMouseEnter={() => setHoveredCampaign(cId)}
                  onMouseLeave={() => setHoveredCampaign(null)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', background: isOpen ? '#f7fafc' : '',
                    transition: 'background 0.12s', position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isOpen ? <ChevronDown size={14} style={{ color: '#718096' }} /> : <ChevronRight size={14} style={{ color: '#718096' }} />}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{group.name}</span>
                    {pendingInGroup > 0 && (
                      <span style={{
                        background: 'var(--danger)', color: '#fff', borderRadius: 10,
                        padding: '1px 7px', fontSize: 10, fontWeight: 700,
                      }}>
                        {pendingInGroup}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#a0aec0' }}>
                      {group.items.length - pendingInGroup}/{group.items.length}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: '#a0aec0', textTransform: 'capitalize' }}>{sample?.campaign_status}</span>

                  {/* Hover popover */}
                  {isHovered && !isOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 8px 8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: 12, fontSize: 12, color: '#4a5568',
                    }}>
                      {sample?.campaign_description && (
                        <div style={{ marginBottom: 6 }}>{sample.campaign_description}</div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', color: '#718096', fontSize: 11 }}>
                        {sample?.campaign_language && <span>Language: <strong>{langLabel[sample.campaign_language] || sample.campaign_language}</strong></span>}
                        {sample?.campaign_created_by && <span>By: <strong>{sample.campaign_created_by}</strong></span>}
                        {sample?.campaign_total_recipients != null && <span>Total recipients: <strong>{sample.campaign_total_recipients}</strong></span>}
                      </div>
                      {sample?.campaign_attachment_names && sample.campaign_attachment_names.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#718096' }}>
                          <Paperclip size={11} />
                          {sample.campaign_attachment_names.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expanded contact list */}
                {isOpen && (
                  <div style={{ padding: '4px 14px 14px' }}>
                    {/* Campaign summary bar */}
                    <div style={{
                      background: '#f7fafc', borderRadius: 6, padding: '8px 10px', marginBottom: 10,
                      fontSize: 11, color: '#718096', display: 'flex', flexWrap: 'wrap', gap: '2px 14px',
                    }}>
                      {sample?.campaign_description && (
                        <div style={{ width: '100%', color: '#4a5568', marginBottom: 2 }}>{sample.campaign_description}</div>
                      )}
                      {sample?.campaign_language && <span>Language: <strong>{langLabel[sample.campaign_language] || sample.campaign_language}</strong></span>}
                      {sample?.campaign_created_by && <span>By: <strong>{sample.campaign_created_by}</strong></span>}
                      {sample?.campaign_total_recipients != null && <span>Total: <strong>{sample.campaign_total_recipients}</strong></span>}
                      {sample?.campaign_attachment_names && sample.campaign_attachment_names.length > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Paperclip size={10} /> {sample.campaign_attachment_names.join(', ')}
                        </span>
                      )}
                    </div>

          {group.items.map((a) => {
            const isAccepted = a.consultant_status === 'accepted';
            const isEditing = !!editing[a.recipient_id];
            const editData = editing[a.recipient_id];
            const currentSubject = a.custom_email_subject || a.default_email_subject;
            const currentBody = a.custom_email_body || a.default_email_body;

            return (
              <div
                key={a.recipient_id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 12,
                  background: isAccepted ? '#f0fff4' : '#fffff0',
                }}
              >
                {/* Contact info row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{a.contact_name || 'Unknown'}</strong>
                    <div style={{ color: '#718096', fontSize: 12 }}>
                      {a.contact_email} · {a.contact_company || '—'} · {a.contact_job_title || '—'}
                    </div>
                  </div>
                  <div>
                    {isAccepted ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 13 }}>
                        <CheckCircle size={16} />
                        Accepted {a.consultant_accepted_at ? `on ${new Date(a.consultant_accepted_at).toLocaleDateString()}` : ''}
                      </span>
                    ) : (
                      <span className="badge" style={{ background: 'var(--warning)', color: '#744210' }}>Pending</span>
                    )}
                  </div>
                </div>

                {/* Email preview / edit */}
                {isEditing ? (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Subject</label>
                    <input
                      className="form-control"
                      value={editData.subject}
                      onChange={(e) => setEditing((prev) => ({
                        ...prev,
                        [a.recipient_id]: { ...prev[a.recipient_id], subject: e.target.value },
                      }))}
                      style={{ marginBottom: 8 }}
                    />
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Body</label>
                    <textarea
                      className="form-control"
                      value={editData.body}
                      onChange={(e) => setEditing((prev) => ({
                        ...prev,
                        [a.recipient_id]: { ...prev[a.recipient_id], body: e.target.value },
                      }))}
                      rows={6}
                      style={{ resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveCustom(a.recipient_id)}
                        disabled={saving[a.recipient_id]}
                      >
                        {saving[a.recipient_id] ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button className="btn btn-sm" onClick={() => cancelEditing(a.recipient_id)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Subject: {currentSubject}
                    </div>
                    <div style={{ fontSize: 12, color: '#4a5568', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                      {currentBody}
                    </div>
                    {a.custom_email_subject || a.custom_email_body ? (
                      <div style={{ fontSize: 11, color: '#805ad5', marginTop: 4 }}>
                        (Customized)
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Action buttons */}
                {!isAccepted && !isEditing && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => acceptAssignment(a)}
                      disabled={accepting[a.recipient_id]}
                    >
                      <CheckCircle size={14} />
                      {accepting[a.recipient_id] ? 'Accepting...' : 'Accept'}
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => startEditing(a)}
                    >
                      <Edit3 size={14} /> Edit
                    </button>
                  </div>
                )}
              </div>
            );
          })}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
