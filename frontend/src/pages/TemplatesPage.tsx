import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { EmailTemplate, HotTopic, Language, TemplateAttachment } from '../types';
import { formatDateShort } from '../utils/dateFormat';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'fi', label: 'Finnish' },
];

const fmtDate = (iso?: string) => formatDateShort(iso);

const fmtFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const StatusBadge = ({ active }: { active: boolean }) =>
  active ? (
    <span style={{ background: '#c6f6d5', color: '#276749', padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
      Published
    </span>
  ) : (
    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
      Draft
    </span>
  );

export default function TemplatesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'templates' | 'my-templates' | 'topics'>('templates');
  const [officialTemplates, setOfficialTemplates] = useState<EmailTemplate[]>([]);
  const [personalTemplates, setPersonalTemplates] = useState<EmailTemplate[]>([]);
  const [hotTopics, setHotTopics] = useState<HotTopic[]>([]);
  const [businessAreas, setBusinessAreas] = useState<{ id: number; name: string }[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Partial<EmailTemplate> & { is_personal?: boolean }>({});
  const [saveError, setSaveError] = useState('');

  // Hot topic editor state
  const [showTopicEditor, setShowTopicEditor] = useState(false);
  const [editTopic, setEditTopic] = useState<Partial<HotTopic>>({});
  const [topicSaveError, setTopicSaveError] = useState('');

  // Attachment state
  const [templateAttachments, setTemplateAttachments] = useState<TemplateAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isManager = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');

  const refreshTemplates = async () => {
    const params: Record<string, any> = isManager ? { active_only: false } : {};
    params.include_personal = true;
    const res = await api.get('/templates/', { params });
    const all: EmailTemplate[] = res.data;
    setOfficialTemplates(all.filter((t) => !t.is_personal));
    setPersonalTemplates(all.filter((t) => t.is_personal));
  };

  const refreshHotTopics = async () => {
    const params = isManager ? { active_only: false } : {};
    const res = await api.get('/hot-topics/', { params });
    setHotTopics(res.data);
  };

  const refreshAttachments = async (templateId: number) => {
    try {
      const res = await api.get(`/templates/${templateId}/attachments`);
      setTemplateAttachments(res.data);
    } catch {
      setTemplateAttachments([]);
    }
  };

  useEffect(() => {
    refreshTemplates().catch(() => {});
    refreshHotTopics().catch(() => {});
    // Business areas for hot topic editor
    if (isManager) {
      api.get('/admin/business-areas').then((r) => setBusinessAreas(r.data)).catch(() => {});
    }
  }, []);

  // Load attachments when editing a saved template
  useEffect(() => {
    if (showEditor && editTemplate.id) {
      refreshAttachments(editTemplate.id);
    } else {
      setTemplateAttachments([]);
    }
  }, [showEditor, editTemplate.id]);

  // ── Template handlers ─────────────────────────────────────

  const buildPayload = (tmpl: Partial<EmailTemplate> & { is_personal?: boolean }, overrideActive?: boolean) => {
    const payload: Record<string, unknown> = {
      name: tmpl.name,
      business_area_id: tmpl.business_area_id ?? null,
      responsibility_domain: tmpl.responsibility_domain || null,
      language: tmpl.language,
      subject_template: tmpl.subject_template ?? '',
      body_template: tmpl.body_template ?? '',
      is_personal: !!tmpl.is_personal,
    };
    if (overrideActive !== undefined) payload.is_active = overrideActive;
    return payload;
  };

  const handleSaveTemplate = async (overrideActive?: boolean) => {
    setSaveError('');
    try {
      const payload = buildPayload(editTemplate, overrideActive);
      if (editTemplate.id) {
        await api.put(`/templates/${editTemplate.id}`, payload);
      } else {
        await api.post('/templates/', payload);
      }
      setShowEditor(false);
      await refreshTemplates();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => `${d.loc?.slice(-1)[0] ?? 'field'}: ${d.msg}`).join('; ')
        : (typeof detail === 'string' ? detail : 'Failed to save template.');
      setSaveError(msg);
    }
  };

  const handlePublishFromRow = async (t: EmailTemplate) => {
    try {
      await api.put(`/templates/${t.id}`, { is_active: true });
      await refreshTemplates();
    } catch { }
  };

  const handleDeleteTemplate = async (t: EmailTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.delete(`/templates/${t.id}`);
      await refreshTemplates();
    } catch {
      alert('Failed to delete the template. It may be in use by existing outreach records.');
    }
  };

  // ── Attachment handlers ───────────────────────────────────

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !editTemplate.id) return;
    const file = e.target.files[0];
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/templates/${editTemplate.id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await refreshAttachments(editTemplate.id);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      alert(typeof detail === 'string' ? detail : 'Failed to upload file.');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRenameAttachment = async (att: TemplateAttachment) => {
    if (!renameValue.trim() || !editTemplate.id) return;
    try {
      await api.put(`/templates/${editTemplate.id}/attachments/${att.id}`, { display_name: renameValue.trim() });
      await refreshAttachments(editTemplate.id);
      setRenamingAttachmentId(null);
    } catch { }
  };

  const handleDeleteAttachment = async (att: TemplateAttachment) => {
    if (!editTemplate.id) return;
    try {
      await api.delete(`/templates/${editTemplate.id}/attachments/${att.id}`);
      await refreshAttachments(editTemplate.id);
    } catch { }
  };

  // ── Hot Topic handlers ────────────────────────────────────

  const handleSaveTopic = async (overrideActive?: boolean) => {
    setTopicSaveError('');
    try {
      const payload: Record<string, unknown> = {
        business_area_id: editTopic.business_area_id || null,
        responsibility_domain: editTopic.responsibility_domain || null,
        topic_text: editTopic.topic_text || '',
        language: editTopic.language || 'en',
      };
      if (overrideActive !== undefined) payload.is_active = overrideActive;

      if (editTopic.id) {
        await api.put(`/hot-topics/${editTopic.id}`, payload);
      } else {
        await api.post('/hot-topics/', payload);
      }
      setShowTopicEditor(false);
      await refreshHotTopics();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => `${d.loc?.slice(-1)[0] ?? 'field'}: ${d.msg}`).join('; ')
        : (typeof detail === 'string' ? detail : 'Failed to save hot topic.');
      setTopicSaveError(msg);
    }
  };

  const handlePublishTopicFromRow = async (ht: HotTopic) => {
    try {
      await api.put(`/hot-topics/${ht.id}`, { is_active: true });
      await refreshHotTopics();
    } catch { }
  };

  const handleDeleteTopic = async (ht: HotTopic) => {
    if (!window.confirm(`Deactivate hot topic?\n\n"${ht.topic_text.substring(0, 80)}..."`)) return;
    try {
      await api.delete(`/hot-topics/${ht.id}`);
      await refreshHotTopics();
    } catch {
      alert('Failed to deactivate the hot topic.');
    }
  };

  // ── Template table component ──────────────────────────────

  const renderTemplateTable = (templates: EmailTemplate[], isPersonal: boolean) => {
    const canEdit = isPersonal || isManager;
    return (
      <div className="card">
        {canEdit && (
          <div className="card-header">
            <span>{isPersonal ? 'My Personal Templates' : 'Email Templates'}</span>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                setEditTemplate({ language: 'en', is_personal: isPersonal });
                setSaveError('');
                setShowEditor(true);
              }}
            >
              New Template
            </button>
          </div>
        )}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Language</th>
                <th>Domain</th>
                {!isPersonal && <th>Status</th>}
                <th>Version</th>
                {!isPersonal && <th>Last Published</th>}
                {canEdit && <th style={{ width: 1 }}></th>}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500 }}>{t.name || <em style={{ color: '#a0aec0' }}>Unnamed</em>}</td>
                  <td>{LANGUAGES.find((l) => l.value === t.language)?.label || t.language}</td>
                  <td>{t.responsibility_domain || 'General'}</td>
                  {!isPersonal && <td><StatusBadge active={t.is_active} /></td>}
                  <td>{t.version}</td>
                  {!isPersonal && (
                    <td style={{ color: t.published_at ? 'inherit' : '#a0aec0' }}>{fmtDate(t.published_at)}</td>
                  )}
                  {canEdit && (
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {!isPersonal && !t.is_active && isManager && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ marginRight: 6 }}
                          onClick={() => handlePublishFromRow(t)}
                          title="Publish this draft"
                        >
                          Publish
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ marginRight: 6 }}
                        onClick={() => { setEditTemplate({ ...t, is_personal: !!t.is_personal }); setSaveError(''); setShowEditor(true); }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
                        onClick={() => handleDeleteTemplate(t)}
                        title="Delete template"
                      >
                        Del
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: '#a0aec0', padding: '24px 0' }}>
                    {isPersonal ? 'No personal templates yet — create one above' : 'No templates found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const isEditingPersonal = !!editTemplate.is_personal;

  return (
    <div>
      <div className="page-header">
        <h2>Email Templates &amp; Hot Topics</h2>
        <p>Manage outreach templates and current topics</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
          Templates ({officialTemplates.length})
        </button>
        <button className={`tab ${tab === 'my-templates' ? 'active' : ''}`} onClick={() => setTab('my-templates')}>
          My Templates ({personalTemplates.length})
        </button>
        <button className={`tab ${tab === 'topics' ? 'active' : ''}`} onClick={() => setTab('topics')}>
          Hot Topics ({hotTopics.length})
        </button>
      </div>

      {tab === 'templates' && renderTemplateTable(officialTemplates, false)}

      {tab === 'my-templates' && renderTemplateTable(personalTemplates, true)}

      {tab === 'topics' && (
        <div className="card">
          <div className="card-header">
            <span>Hot Topics</span>
            {isManager && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setEditTopic({ language: 'en' });
                  setTopicSaveError('');
                  setShowTopicEditor(true);
                }}
              >
                New Hot Topic
              </button>
            )}
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Business Area</th>
                  <th>Domain</th>
                  <th>Language</th>
                  <th>Status</th>
                  {isManager && <th style={{ width: 1 }}></th>}
                </tr>
              </thead>
              <tbody>
                {hotTopics.map((ht) => (
                  <tr key={ht.id}>
                    <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ht.topic_text}
                    </td>
                    <td>{businessAreas.find((b) => b.id === ht.business_area_id)?.name || '—'}</td>
                    <td>{ht.responsibility_domain || '—'}</td>
                    <td>{LANGUAGES.find((l) => l.value === ht.language)?.label || ht.language}</td>
                    <td><StatusBadge active={ht.is_active} /></td>
                    {isManager && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {!ht.is_active && (
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ marginRight: 6 }}
                            onClick={() => handlePublishTopicFromRow(ht)}
                            title="Publish"
                          >
                            Publish
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ marginRight: 6 }}
                          onClick={() => { setEditTopic(ht); setTopicSaveError(''); setShowTopicEditor(true); }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
                          onClick={() => handleDeleteTopic(ht)}
                          title="Deactivate"
                        >
                          Del
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {hotTopics.length === 0 && (
                  <tr>
                    <td colSpan={isManager ? 6 : 5} style={{ textAlign: 'center', color: '#a0aec0', padding: '24px 0' }}>
                      No hot topics found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Template Editor Modal */}
      {showEditor && (
        <div className="modal-overlay" onClick={() => setShowEditor(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>
                {editTemplate.id ? 'Edit' : 'New'}{' '}
                {isEditingPersonal ? 'Personal Template' : 'Template'}
              </span>
              {editTemplate.id && !isEditingPersonal && <StatusBadge active={!!editTemplate.is_active} />}
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>
                    Name <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span>
                  </label>
                  <input
                    className="form-control"
                    value={editTemplate.name || ''}
                    onChange={(e) => setEditTemplate({ ...editTemplate, name: e.target.value })}
                    placeholder="e.g. General Outreach – English"
                  />
                </div>
                <div className="form-group">
                  <label>
                    Language <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span>
                  </label>
                  <select
                    className="form-control"
                    value={editTemplate.language || 'en'}
                    onChange={(e) => setEditTemplate({ ...editTemplate, language: e.target.value as Language })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Responsibility Domain <span style={{ color: '#718096', fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="form-control"
                  value={editTemplate.responsibility_domain || ''}
                  onChange={(e) => setEditTemplate({ ...editTemplate, responsibility_domain: e.target.value })}
                  placeholder="Leave empty for a general-purpose template"
                />
              </div>

              <div className="form-group">
                <label>Subject Template</label>
                <input
                  className="form-control"
                  value={editTemplate.subject_template || ''}
                  onChange={(e) => setEditTemplate({ ...editTemplate, subject_template: e.target.value })}
                  placeholder="e.g. Introduction from {{ employee_name }} at Advisense"
                />
              </div>

              <div className="form-group">
                <label>Body Template <span style={{ color: '#718096', fontWeight: 400 }}>(Jinja2)</span></label>
                <textarea
                  className="form-control"
                  rows={10}
                  value={editTemplate.body_template || ''}
                  onChange={(e) => setEditTemplate({ ...editTemplate, body_template: e.target.value })}
                  placeholder="Dear {{ contact_first_name }},"
                />
                <div style={{ fontSize: 12, color: '#718096', marginTop: 6, lineHeight: 1.6 }}>
                  <strong>Available variables:</strong>{' '}
                  {[
                    '{{ contact_first_name }}',
                    '{{ contact_company }}',
                    '{{ employee_name }}',
                    '{{ employee_ba }}',
                    '{{ hot_topics_text }}',
                    '{{ meeting_phrasing }}',
                    '{{ slot_1 }}',
                    '{{ slot_2 }}',
                  ].join(', ')}
                </div>
              </div>

              {/* Attachments section (only for saved templates) */}
              {editTemplate.id ? (
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 8 }}>
                  <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Attachments (PDF / PowerPoint)</label>

                  {templateAttachments.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {templateAttachments.map((att) => (
                        <div
                          key={att.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 0', borderBottom: '1px solid #edf2f7',
                          }}
                        >
                          <span style={{ fontSize: 16 }}>
                            {att.content_type.includes('pdf') ? '(PDF)' : '(PPT)'}
                          </span>

                          {renamingAttachmentId === att.id ? (
                            <input
                              className="form-control"
                              style={{ flex: 1, padding: '2px 8px', fontSize: 13 }}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => handleRenameAttachment(att)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameAttachment(att); if (e.key === 'Escape') setRenamingAttachmentId(null); }}
                              autoFocus
                            />
                          ) : (
                            <span
                              style={{ flex: 1, cursor: 'pointer', fontSize: 13 }}
                              title="Click to rename"
                              onClick={() => { setRenamingAttachmentId(att.id); setRenameValue(att.display_name); }}
                            >
                              {att.display_name}
                            </span>
                          )}

                          <span style={{ fontSize: 12, color: '#a0aec0' }}>{fmtFileSize(att.file_size_bytes)}</span>

                          <a
                            href={`${api.defaults.baseURL}/templates/${editTemplate.id}/attachments/${att.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: 12, padding: '2px 8px' }}
                          >
                            Preview
                          </a>

                          <button
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: 12, padding: '2px 8px', color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
                            onClick={() => handleDeleteAttachment(att)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.pptx,.ppt"
                      onChange={handleUploadAttachment}
                      style={{ fontSize: 13 }}
                    />
                    {uploadingAttachment && <span style={{ fontSize: 12, color: '#718096' }}>Uploading...</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 4 }}>
                    Max 25 MB per file. PDF and PowerPoint only.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#a0aec0', fontStyle: 'italic', marginTop: 8 }}>
                  Save the template first to add attachments.
                </div>
              )}
            </div>

            <div className="modal-footer">
              {saveError && (
                <span style={{ color: 'var(--danger, #e53e3e)', fontSize: 13, marginRight: 'auto' }}>{saveError}</span>
              )}
              <button className="btn btn-outline" onClick={() => setShowEditor(false)}>Cancel</button>
              {isEditingPersonal ? (
                <button className="btn btn-primary" onClick={() => handleSaveTemplate(true)}>
                  Save
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={() => handleSaveTemplate(false)}>
                    Save Draft
                  </button>
                  <button className="btn btn-primary" onClick={() => handleSaveTemplate(true)}>
                    Publish
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hot Topic Editor Modal */}
      {showTopicEditor && (
        <div className="modal-overlay" onClick={() => setShowTopicEditor(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>{editTopic.id ? 'Edit Hot Topic' : 'New Hot Topic'}</span>
              {editTopic.id && <StatusBadge active={!!editTopic.is_active} />}
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Business Area</label>
                  <select
                    className="form-control"
                    value={editTopic.business_area_id ?? ''}
                    onChange={(e) =>
                      setEditTopic({ ...editTopic, business_area_id: e.target.value ? Number(e.target.value) : undefined })
                    }
                  >
                    <option value="">— All —</option>
                    {businessAreas.map((ba) => (
                      <option key={ba.id} value={ba.id}>{ba.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Language</label>
                  <select
                    className="form-control"
                    value={editTopic.language || 'en'}
                    onChange={(e) => setEditTopic({ ...editTopic, language: e.target.value as Language })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Domain <span style={{ color: '#718096', fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="form-control"
                  value={editTopic.responsibility_domain || ''}
                  onChange={(e) => setEditTopic({ ...editTopic, responsibility_domain: e.target.value })}
                  placeholder="e.g. Risk Management"
                />
              </div>

              <div className="form-group">
                <label>Topic Text <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span></label>
                <textarea
                  className="form-control"
                  rows={5}
                  value={editTopic.topic_text || ''}
                  onChange={(e) => setEditTopic({ ...editTopic, topic_text: e.target.value })}
                  placeholder="Describe the hot topic..."
                />
              </div>
            </div>

            <div className="modal-footer">
              {topicSaveError && (
                <span style={{ color: 'var(--danger, #e53e3e)', fontSize: 13, marginRight: 'auto' }}>{topicSaveError}</span>
              )}
              <button className="btn btn-outline" onClick={() => setShowTopicEditor(false)}>Cancel</button>
              <button className="btn btn-outline" onClick={() => handleSaveTopic(false)}>
                Save Draft
              </button>
              <button className="btn btn-primary" onClick={() => handleSaveTopic(true)}>
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
