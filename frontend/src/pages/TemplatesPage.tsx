import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { EmailTemplate, HotTopic, Language } from '../types';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'fi', label: 'Finnish' },
];

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

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
  const [tab, setTab] = useState<'templates' | 'topics'>('templates');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [hotTopics, setHotTopics] = useState<HotTopic[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Partial<EmailTemplate>>({});
  const [saveError, setSaveError] = useState('');

  // Admins, BA managers and team managers can create/edit/delete templates
  const isManager = ['admin', 'ba_manager', 'team_manager'].includes(user?.role || '');

  const refreshTemplates = async () => {
    // Managers see all (drafts + published); others see only published
    const params = isManager ? { active_only: false } : {};
    const res = await api.get('/templates/', { params });
    setTemplates(res.data);
  };

  useEffect(() => {
    refreshTemplates().catch(() => {});
    api.get('/hot-topics/').then((r) => setHotTopics(r.data)).catch(() => {});
  }, []);

  // Build a safe payload for POST/PUT — only the fields the backend accepts
  const buildPayload = (tmpl: Partial<EmailTemplate>, overrideActive?: boolean) => {
    const payload: Record<string, unknown> = {
      name: tmpl.name,
      business_area_id: tmpl.business_area_id ?? null,
      responsibility_domain: tmpl.responsibility_domain || null,
      language: tmpl.language,
      subject_template: tmpl.subject_template ?? '',
      body_template: tmpl.body_template ?? '',
    };
    if (overrideActive !== undefined) payload.is_active = overrideActive;
    return payload;
  };

  // Save (draft stays draft; published stays published) — or publish if overrideActive=true
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

  // Publish a draft directly from the table row (no modal needed)
  const handlePublishFromRow = async (t: EmailTemplate) => {
    try {
      await api.put(`/templates/${t.id}`, { is_active: true });
      await refreshTemplates();
    } catch {
      // ignore — user can open the editor if needed
    }
  };

  // Delete with browser confirmation
  const handleDeleteTemplate = async (t: EmailTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.delete(`/templates/${t.id}`);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch {
      alert('Failed to delete the template. It may be in use by existing outreach records.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Email Templates &amp; Hot Topics</h2>
        <p>Manage outreach templates and current topics</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
          Templates ({templates.length})
        </button>
        <button className={`tab ${tab === 'topics' ? 'active' : ''}`} onClick={() => setTab('topics')}>
          Hot Topics ({hotTopics.length})
        </button>
      </div>

      {tab === 'templates' && (
        <div className="card">
          {isManager && (
            <div className="card-header">
              <span>Email Templates</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => { setEditTemplate({ language: 'en' }); setSaveError(''); setShowEditor(true); }}
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
                  <th>Status</th>
                  <th>Version</th>
                  <th>Last Published</th>
                  {isManager && <th style={{ width: 1 }}></th>}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>{t.name || <em style={{ color: '#a0aec0' }}>Unnamed</em>}</td>
                    <td>{LANGUAGES.find((l) => l.value === t.language)?.label || t.language}</td>
                    <td>{t.responsibility_domain || 'General'}</td>
                    <td><StatusBadge active={t.is_active} /></td>
                    <td>{t.version}</td>
                    <td style={{ color: t.published_at ? 'inherit' : '#a0aec0' }}>{fmtDate(t.published_at)}</td>
                    {isManager && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {!t.is_active && (
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
                          onClick={() => { setEditTemplate(t); setSaveError(''); setShowEditor(true); }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
                          onClick={() => handleDeleteTemplate(t)}
                          title="Delete template"
                        >
                          🗑
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {templates.length === 0 && (
                  <tr>
                    <td colSpan={isManager ? 7 : 6} style={{ textAlign: 'center', color: '#a0aec0', padding: '24px 0' }}>
                      No templates found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'topics' && (
        <div className="card">
          <div className="card-header">
            <span>Hot Topics</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Domain</th>
                  <th>Language</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {hotTopics.map((ht) => (
                  <tr key={ht.id}>
                    <td>{ht.topic_text}</td>
                    <td>{ht.responsibility_domain}</td>
                    <td>{LANGUAGES.find((l) => l.value === ht.language)?.label || ht.language}</td>
                    <td>{ht.is_active ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showEditor && (
        <div className="modal-overlay" onClick={() => setShowEditor(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>{editTemplate.id ? 'Edit Template' : 'New Template'}</span>
              {editTemplate.id && <StatusBadge active={!!editTemplate.is_active} />}
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
            </div>

            <div className="modal-footer">
              {saveError && (
                <span style={{ color: 'var(--danger, #e53e3e)', fontSize: 13, marginRight: 'auto' }}>{saveError}</span>
              )}
              <button className="btn btn-outline" onClick={() => setShowEditor(false)}>Cancel</button>
              <button className="btn btn-outline" onClick={() => handleSaveTemplate(false)}>
                Save Draft
              </button>
              <button className="btn btn-primary" onClick={() => handleSaveTemplate(true)}>
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
