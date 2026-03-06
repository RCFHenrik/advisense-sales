import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { OutreachRecord, NegationReason, Language, EmailTemplate, Contact, TemplateAttachment } from '../types';

const NEGATION_REASONS: { value: NegationReason; label: string }[] = [
  { value: 'wrong_person', label: 'Wrong person (left company / changed role)' },
  { value: 'wrong_domain', label: 'Wrong domain classification' },
  { value: 'sensitive_situation', label: 'Sensitive situation' },
  { value: 'not_appropriate_timing', label: 'Not appropriate timing' },
  { value: 'another_consultant_better', label: 'Another consultant better suited' },
  { value: 'duplicate_ongoing', label: 'Duplicate already ongoing' },
  { value: 'do_not_contact', label: 'Do-not-contact request' },
];

const OUTCOME_OPTIONS = [
  { value: 'replied', label: 'Replied' },
  { value: 'meeting_booked', label: 'Meeting Booked' },
  { value: 'closed_met', label: 'Closed - Met' },
  { value: 'closed_no_response', label: 'Closed - No Response' },
  { value: 'closed_not_relevant', label: 'Closed - Not Relevant' },
  { value: 'closed_bounced', label: 'Closed - Bounced' },
];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'fi', label: 'Finnish' },
];

const fmtFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function OutreachDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [record, setRecord] = useState<OutreachRecord | null>(null);
  const [showNegate, setShowNegate] = useState(false);
  const [negReason, setNegReason] = useState<NegationReason>('wrong_person');
  const [negNotes, setNegNotes] = useState('');
  const [showOutcome, setShowOutcome] = useState(false);
  const [outcome, setOutcome] = useState('replied');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailLang, setEmailLang] = useState<Language>('en');
  const [generating, setGenerating] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [contactDetail, setContactDetail] = useState<Contact | null>(null);
  const [meetingParticipants, setMeetingParticipants] = useState<
    { employee_name: string; meeting_count: number }[]
  >([]);

  // Attachment state
  const [templateAttachments, setTemplateAttachments] = useState<TemplateAttachment[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<number[]>([]);

  useEffect(() => {
    fetchRecord();
  }, [id]);

  // Fetch contact detail and meeting participants when the record loads
  useEffect(() => {
    if (!record?.contact_id) return;
    api.get(`/contacts/${record.contact_id}`)
      .then((r) => setContactDetail(r.data))
      .catch(() => {});
    api.get(`/contacts/${record.contact_id}/meeting-participants`)
      .then((r) => setMeetingParticipants(r.data))
      .catch(() => {});
  }, [record?.contact_id]);

  // Fetch available templates whenever the selected language changes
  useEffect(() => {
    setSelectedTemplateId(null);
    api.get('/templates/', { params: { language: emailLang, active_only: true, include_personal: true } })
      .then((r) => setAvailableTemplates(r.data))
      .catch(() => setAvailableTemplates([]));
  }, [emailLang]);

  // Fetch attachments when a template is selected
  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateAttachments([]);
      return;
    }
    api.get(`/templates/${selectedTemplateId}/attachments`)
      .then((r) => setTemplateAttachments(r.data))
      .catch(() => setTemplateAttachments([]));
  }, [selectedTemplateId]);

  const fetchRecord = async () => {
    try {
      const res = await api.get(`/outreach/${id}`);
      setRecord(res.data);
      setEmailSubject(res.data.email_subject || '');
      setEmailBody(res.data.email_body || '');
      setEmailLang(res.data.email_language || 'en');
      // Restore selected attachment IDs from saved record
      if (res.data.selected_attachment_ids) {
        try {
          const ids = JSON.parse(res.data.selected_attachment_ids);
          if (Array.isArray(ids)) setSelectedAttachmentIds(ids);
        } catch { }
      }
    } catch {
      navigate('/outreach');
    }
  };

  const handleAccept = async () => {
    await api.post(`/outreach/${id}/accept`);
    fetchRecord();
  };

  const handleNegate = async () => {
    await api.post(`/outreach/${id}/negate`, { reason: negReason, notes: negNotes });
    setShowNegate(false);
    fetchRecord();
  };

  const handleGenerateEmail = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/outreach/${id}/generate-email`, {
        language: emailLang,
        ...(selectedTemplateId ? { template_id: selectedTemplateId } : {}),
      });
      setEmailSubject(res.data.subject);
      setEmailBody(res.data.body);
      if (res.data.template_id) {
        setSelectedTemplateId(res.data.template_id);
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to generate email');
    } finally {
      setGenerating(false);
    }
  };

  const buildAttachmentPayload = () => {
    if (selectedAttachmentIds.length === 0) return undefined;
    return JSON.stringify(selectedAttachmentIds);
  };

  const handleSaveDraft = async () => {
    await api.post(`/outreach/${id}/draft`, {
      email_subject: emailSubject,
      email_body: emailBody,
      email_language: emailLang,
      selected_attachment_ids: buildAttachmentPayload(),
    });
    fetchRecord();
  };

  const handleSend = async () => {
    await api.post(`/outreach/${id}/send`, {
      email_subject: emailSubject,
      email_body: emailBody,
      email_language: emailLang,
      selected_attachment_ids: buildAttachmentPayload(),
    });
    fetchRecord();
  };

  const handleMarkSent = async () => {
    await api.post(`/outreach/${id}/mark-sent`);
    fetchRecord();
  };

  const handleRevertToDraft = async () => {
    try {
      await api.post(`/outreach/${id}/revert-to-draft`);
      fetchRecord();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to revert to draft');
    }
  };

  const handleOutcome = async () => {
    await api.post(`/outreach/${id}/outcome`, { outcome, outcome_notes: outcomeNotes });
    setShowOutcome(false);
    fetchRecord();
  };

  const toggleAttachment = (attId: number) => {
    setSelectedAttachmentIds((prev) =>
      prev.includes(attId) ? prev.filter((x) => x !== attId) : [...prev, attId]
    );
  };

  // Split templates into official vs personal for optgroups
  const officialTemplates = availableTemplates.filter((t) => !t.is_personal);
  const myTemplates = availableTemplates.filter((t) => t.is_personal);

  // For the prepared view, resolve selected attachment details
  const resolvedAttachments = templateAttachments.filter((a) => selectedAttachmentIds.includes(a.id));

  if (!record) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>
          <button className="btn-icon" onClick={() => navigate('/outreach')} style={{ marginRight: 8 }}>
            ←
          </button>
          Outreach #{record.id}
        </h2>
        <p>
          {record.contact_name} at {record.contact_company}
          {' '}&mdash;{' '}
          <span className={`badge badge-${record.status}`}>
            {record.status.replace(/_/g, ' ')}
          </span>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Contact Details</div>
          <div className="card-body">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 14 }}>
              <dt style={{ color: '#718096' }}>Name:</dt><dd>{record.contact_name}</dd>
              <dt style={{ color: '#718096' }}>Email:</dt><dd>{record.contact_email}</dd>
              <dt style={{ color: '#718096' }}>Company:</dt><dd>{record.contact_company}</dd>
              {contactDetail?.responsibility_domain && (
                <><dt style={{ color: '#718096' }}>Domain:</dt><dd>{contactDetail.responsibility_domain}</dd></>
              )}
              <dt style={{ color: '#718096' }}>Days Since Interaction:</dt>
              <dd>{contactDetail?.days_since_interaction != null ? `${contactDetail.days_since_interaction} days` : '—'}</dd>
              <dt style={{ color: '#718096' }}>Total Historical Revenue:</dt>
              <dd>
                {contactDetail?.revenue != null
                  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(contactDetail.revenue)
                  : contactDetail?.has_historical_revenue ? 'Yes (amount undisclosed)' : '—'}
              </dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Assignment</div>
          <div className="card-body">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 14 }}>
              <dt style={{ color: '#718096' }}>Consultant:</dt><dd>{record.employee_name}</dd>
              <dt style={{ color: '#718096' }}>Score:</dt><dd>{record.recommendation_score?.toFixed(0) || '—'}</dd>
              <dt style={{ color: '#718096' }}>Reason:</dt><dd style={{ fontSize: 13 }}>{record.recommendation_reason || '—'}</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* Previous meetings with this contact */}
      {meetingParticipants.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Previous Meetings With This Contact</div>
          <div className="card-body">
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingBottom: 6 }}>Consultant</th>
                  <th style={{ textAlign: 'right', paddingBottom: 6 }}>Meetings</th>
                </tr>
              </thead>
              <tbody>
                {meetingParticipants.map((p) => (
                  <tr key={p.employee_name}>
                    <td style={{ paddingTop: 4 }}>{p.employee_name}</td>
                    <td style={{ textAlign: 'right', paddingTop: 4 }}>{p.meeting_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions based on status */}
      {record.status === 'proposed' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Action Required</div>
          <div className="card-body" style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleAccept}>Accept Proposal</button>
            <button className="btn btn-danger" onClick={() => setShowNegate(true)}>Negate</button>
          </div>
        </div>
      )}

      {/* Email Editor */}
      {['accepted', 'draft'].includes(record.status) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            Email Draft
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="form-control"
                style={{ width: 150 }}
                value={emailLang}
                onChange={(e) => setEmailLang(e.target.value as Language)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <select
                className="form-control"
                style={{ width: 220 }}
                value={selectedTemplateId ?? ''}
                onChange={(e) => setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)}
                title="Select template (Auto picks the best match for this contact)"
              >
                <option value="">Auto (recommended)</option>
                {officialTemplates.length > 0 && (
                  <optgroup label="Official Templates">
                    {officialTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {myTemplates.length > 0 && (
                  <optgroup label="My Templates">
                    {myTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button className="btn btn-sm btn-outline" onClick={handleGenerateEmail} disabled={generating}>
                {generating ? 'Generating...' : 'Auto-generate'}
              </button>
            </div>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label>Subject</label>
              <input
                className="form-control"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Body</label>
              <textarea
                className="form-control"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={12}
              />
            </div>

            {/* Attachment selection panel */}
            {templateAttachments.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f7fafc', borderRadius: 8 }}>
                <label style={{ fontWeight: 600, marginBottom: 8, display: 'block', fontSize: 13 }}>
                  Attachments to include
                </label>
                {templateAttachments.map((att) => (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={selectedAttachmentIds.includes(att.id)}
                      onChange={() => toggleAttachment(att.id)}
                      id={`att-${att.id}`}
                    />
                    <label htmlFor={`att-${att.id}`} style={{ cursor: 'pointer', fontSize: 13, flex: 1 }}>
                      {att.display_name}
                      <span style={{ color: '#a0aec0', marginLeft: 8 }}>
                        ({att.content_type.includes('pdf') ? 'PDF' : 'PPT'}, {fmtFileSize(att.file_size_bytes)})
                      </span>
                    </label>
                    <a
                      href={`${api.defaults.baseURL}/templates/${selectedTemplateId}/attachments/${att.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--primary, #3182ce)' }}
                    >
                      Preview
                    </a>
                  </div>
                ))}
              </div>
            )}

            {record.proposed_slot_1_start && (
              <div style={{ marginBottom: 16, fontSize: 13, color: '#718096' }}>
                <strong>Proposed slots:</strong><br />
                Slot 1: {new Date(record.proposed_slot_1_start).toLocaleString()} - {new Date(record.proposed_slot_1_end!).toLocaleString()}<br />
                {record.proposed_slot_2_start && (
                  <>Slot 2: {new Date(record.proposed_slot_2_start).toLocaleString()} - {new Date(record.proposed_slot_2_end!).toLocaleString()}</>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={handleSaveDraft}>Save Draft</button>
              <button className="btn btn-accent" onClick={handleSend}>Prepare & Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Prepared - needs manual send confirmation */}
      {record.status === 'prepared' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Email Prepared</div>
          <div className="card-body">
            <p style={{ marginBottom: 12 }}>
              The email has been prepared. Please send it manually via Outlook, then confirm below.
            </p>
            <div style={{ background: '#f7fafc', padding: 16, borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Subject: {record.email_subject}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{record.email_body}</pre>
            </div>

            {/* Show selected attachments in prepared view */}
            {selectedAttachmentIds.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: '#ebf8ff', borderRadius: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  Attachments to include with this email:
                </div>
                {resolvedAttachments.length > 0
                  ? resolvedAttachments.map((att) => (
                      <div key={att.id} style={{ fontSize: 13, padding: '2px 0' }}>
                        {att.display_name}
                        <span style={{ color: '#a0aec0', marginLeft: 8 }}>
                          ({att.content_type.includes('pdf') ? 'PDF' : 'PPT'}, {fmtFileSize(att.file_size_bytes)})
                        </span>
                      </div>
                    ))
                  : (
                    <div style={{ fontSize: 13, color: '#718096' }}>
                      {selectedAttachmentIds.length} attachment(s) selected
                    </div>
                  )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={handleRevertToDraft}>← Back to Draft</button>
              <button className="btn btn-primary" onClick={handleMarkSent}>Mark as Sent</button>
            </div>
          </div>
        </div>
      )}

      {/* Post-send outcomes */}
      {['sent', 'replied', 'meeting_booked'].includes(record.status) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Post-Outreach Status</div>
          <div className="card-body">
            {record.email_subject && (
              <div style={{ background: '#f7fafc', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Subject: {record.email_subject}</div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{record.email_body}</pre>
              </div>
            )}
            <button className="btn btn-outline" onClick={() => setShowOutcome(true)}>
              Set Outcome
            </button>
          </div>
        </div>
      )}

      {/* Negation Modal */}
      {showNegate && (
        <div className="modal-overlay" onClick={() => setShowNegate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Negate Proposal</div>
            <div className="modal-body">
              <div className="form-group">
                <label>Reason (required)</label>
                <select
                  className="form-control"
                  value={negReason}
                  onChange={(e) => setNegReason(e.target.value as NegationReason)}
                >
                  {NEGATION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  className="form-control"
                  value={negNotes}
                  onChange={(e) => setNegNotes(e.target.value)}
                  placeholder="Additional context..."
                />
              </div>
              {negReason === 'do_not_contact' && (
                <div style={{ padding: 12, background: '#fff5f5', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  This will add the contact to the suppression list. All future outreach will be blocked.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowNegate(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleNegate}>Confirm Negation</button>
            </div>
          </div>
        </div>
      )}

      {/* Outcome Modal */}
      {showOutcome && (
        <div className="modal-overlay" onClick={() => setShowOutcome(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Set Outcome</div>
            <div className="modal-body">
              <div className="form-group">
                <label>Outcome</label>
                <select
                  className="form-control"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  {OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  className="form-control"
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowOutcome(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleOutcome}>Save Outcome</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
