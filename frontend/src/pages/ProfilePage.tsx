import { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, Eye, EyeOff, X, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Employee, SiteLanguageItem, EmployeeSiteLanguage } from '../types';

const SENIORITY_OPTIONS = [
  'Junior Associate',
  'Associate',
  'Senior Associate',
  'Manager',
  'Senior Manager',
  'Director',
  'Managing Director',
];

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Employee | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [relevanceTags, setRelevanceTags] = useState<string[]>([]);
  const [seniority, setSeniority] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Expertise tag picker
  const [availableTags, setAvailableTags] = useState<{id: number; name: string}[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Site languages
  const [availableLanguages, setAvailableLanguages] = useState<SiteLanguageItem[]>([]);
  const [myLanguages, setMyLanguages] = useState<EmployeeSiteLanguage[]>([]);
  const [langAdding, setLangAdding] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      const emp: Employee = r.data;
      setProfile(emp);
      setEditName(emp.name || '');
      setEditEmail(emp.email || '');
      setProfileDescription(emp.profile_description || '');
      setSeniority(emp.seniority || '');
      setMyLanguages(emp.site_languages || []);
      if (emp.domain_expertise_tags) {
        try {
          const tags = JSON.parse(emp.domain_expertise_tags);
          setSelectedTags(Array.isArray(tags) ? tags : [emp.domain_expertise_tags]);
        } catch {
          setSelectedTags(emp.domain_expertise_tags ? emp.domain_expertise_tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
        }
      }
      if (emp.relevance_tags) {
        try {
          const rt = JSON.parse(emp.relevance_tags);
          setRelevanceTags(Array.isArray(rt) ? rt : [emp.relevance_tags]);
        } catch {
          setRelevanceTags(emp.relevance_tags ? emp.relevance_tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
        }
      }
    }).catch(() => {});

    // Load expertise tags database
    api.get('/employees/expertise-tags').then((r) => setAvailableTags(r.data)).catch(() => {});

    // Load available site languages
    api.get('/admin/site-languages').then((r) => setAvailableLanguages(r.data)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const payload: any = {
        profile_description: profileDescription,
        domain_expertise_tags: JSON.stringify(selectedTags),
        relevance_tags: JSON.stringify(relevanceTags),
        seniority: seniority || null,
      };
      if (editName !== (profile?.name || '')) payload.name = editName;
      if (editEmail !== (profile?.email || '')) payload.email = editEmail;
      await api.patch('/employees/me', payload);
      // Update local profile state with new name/email
      if (profile) {
        setProfile({ ...profile, name: editName || profile.name, email: editEmail || profile.email });
      }
      setSaved(true);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLanguage = async (langId: number) => {
    setLangAdding(true);
    try {
      const res = await api.post(`/employees/me/site-languages/${langId}`);
      setMyLanguages((prev) => [...prev, res.data]);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add language');
    } finally {
      setLangAdding(false);
    }
  };

  const handleRemoveLanguage = async (langId: number) => {
    try {
      await api.delete(`/employees/me/site-languages/${langId}`);
      setMyLanguages((prev) => prev.filter((l) => l.site_language_id !== langId));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to remove language');
    }
  };

  // Tag picker helpers
  const addTag = useCallback((tagName: string) => {
    if (!selectedTags.includes(tagName)) {
      setSelectedTags((prev) => [...prev, tagName]);
      setSaved(false);
    }
    setTagSearch('');
    setShowTagDropdown(false);
    tagInputRef.current?.focus();
  }, [selectedTags]);

  const removeTag = useCallback((tagName: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tagName));
    setSaved(false);
  }, []);

  const filteredTags = availableTags.filter(
    (t) =>
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !selectedTags.includes(t.name)
  ).slice(0, 10);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        tagDropdownRef.current &&
        !tagDropdownRef.current.contains(e.target as Node) &&
        tagInputRef.current &&
        !tagInputRef.current.contains(e.target as Node)
      ) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'ba_manager': return 'BA Manager';
      case 'team_manager': return 'Team Manager';
      default: return 'Consultant';
    }
  };

  // Languages not yet added by this user
  const myLangIds = new Set(myLanguages.map((l) => l.site_language_id));
  const unselectedLanguages = availableLanguages.filter((l) => !myLangIds.has(l.id));

  if (!profile) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>My Profile</h2>
        <p>View and update your consultant profile. Your description and expertise tags are used in outreach matching.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">Profile Information</div>
          <div className="card-body">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', fontSize: 14 }}>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Name:</dt>
              <dd>
                <input
                  className="form-control"
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setSaved(false); }}
                  style={{ padding: '3px 6px', fontSize: 14 }}
                />
              </dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Email:</dt>
              <dd>
                <input
                  className="form-control"
                  type="email"
                  value={editEmail}
                  onChange={(e) => { setEditEmail(e.target.value); setSaved(false); }}
                  style={{ padding: '3px 6px', fontSize: 14 }}
                />
              </dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Role:</dt>
              <dd>{roleLabel(profile.role)}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Seniority:</dt>
              <dd>
                <select
                  value={seniority}
                  onChange={(e) => { setSeniority(e.target.value); setSaved(false); }}
                  style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: 14 }}
                >
                  <option value="">Other (no seniority)</option>
                  {SENIORITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Business Area:</dt>
              <dd>{profile.business_area_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Team:</dt>
              <dd>{profile.team_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Site:</dt>
              <dd>{profile.site_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Language:</dt>
              <dd>{profile.primary_language?.toUpperCase()}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Outreach Target:</dt>
              <dd>{profile.outreach_target_per_week} per week</dd>
            </dl>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">Expertise & Description</div>
            <div className="card-body">
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
                  Expert Areas
                </label>

                {/* Selected tags as pills */}
                {selectedTags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {selectedTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: '#edf2f7',
                          color: '#2d3748',
                          borderRadius: 99,
                          padding: '3px 10px',
                          fontSize: 12,
                        }}
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            color: '#a0aec0',
                          }}
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Search + Add */}
                {availableTags.length > 0 ? (
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        ref={tagInputRef}
                        className="form-control"
                        value={tagSearch}
                        onChange={(e) => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
                        onFocus={() => setShowTagDropdown(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && filteredTags.length > 0) {
                            e.preventDefault();
                            addTag(filteredTags[0].name);
                          }
                        }}
                        placeholder="Search expertise..."
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        disabled={!tagSearch || filteredTags.length === 0}
                        onClick={() => filteredTags.length > 0 && addTag(filteredTags[0].name)}
                      >
                        Add
                      </button>
                    </div>

                    {/* Dropdown */}
                    {showTagDropdown && tagSearch && filteredTags.length > 0 && (
                      <div
                        ref={tagDropdownRef}
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          background: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          zIndex: 100,
                          maxHeight: 200,
                          overflowY: 'auto',
                          marginTop: 2,
                        }}
                      >
                        {filteredTags.map((tag) => (
                          <div
                            key={tag.id}
                            onClick={() => addTag(tag.name)}
                            style={{
                              padding: '6px 12px',
                              fontSize: 13,
                              cursor: 'pointer',
                              borderBottom: '1px solid #f7fafc',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f7fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                          >
                            {tag.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#a0aec0', fontStyle: 'italic' }}>
                    No expertise tags available. Ask an admin to upload the tag database via Data Upload.
                  </div>
                )}

                <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 4 }}>
                  Used for automatic outreach matching.
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
                  Relevance Tags
                </label>
                {relevanceTags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {relevanceTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: '#e6fffa',
                          color: '#285e61',
                          borderRadius: 99,
                          padding: '3px 10px',
                          fontSize: 12,
                        }}
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => { setRelevanceTags((prev) => prev.filter((t) => t !== tag)); setSaved(false); }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            color: '#a0aec0',
                          }}
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="form-control"
                    placeholder="Type a tag and press Enter (e.g. Public Sector, Audit...)"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val && !relevanceTags.includes(val)) {
                          setRelevanceTags((prev) => [...prev, val]);
                          setSaved(false);
                        }
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 4 }}>
                  Broader tags (sector, capability, role type, geography) used for contact-consultant matching and AI analysis.
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
                  Profile Description
                </label>
                <textarea
                  className="form-control"
                  rows={5}
                  value={profileDescription}
                  onChange={(e) => { setProfileDescription(e.target.value); setSaved(false); }}
                  placeholder="Describe your background, specialisations, and the types of client engagements you excel at."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled
                  title="Coming soon — AI-powered CV analysis will suggest expertise tags"
                  style={{ opacity: 0.45, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <FileText size={14} /> Scan CV
                </button>
                {saved && (
                  <span style={{ color: 'var(--accent)', fontSize: 13 }}>Saved successfully.</span>
                )}
                {error && (
                  <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Site Languages</div>
            <div className="card-body">
              <div style={{ fontSize: 13, color: '#718096', marginBottom: 12 }}>
                Languages you can serve clients in. Used for outreach matching.
              </div>

              {/* Current languages */}
              {myLanguages.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {myLanguages.map((l) => (
                    <span
                      key={l.site_language_id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#ebf8ff',
                        color: '#2b6cb0',
                        padding: '4px 10px',
                        borderRadius: 16,
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {l.name}
                      {l.code && <span style={{ color: '#90cdf4', fontSize: 11 }}>({l.code})</span>}
                      <button
                        onClick={() => handleRemoveLanguage(l.site_language_id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 14,
                          lineHeight: 1,
                          fontWeight: 700,
                        }}
                        title="Remove language"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#a0aec0', marginBottom: 12 }}>
                  No site languages added yet.
                </div>
              )}

              {/* Add language dropdown */}
              {unselectedLanguages.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    id="add-site-lang"
                    className="form-control"
                    style={{ maxWidth: 200 }}
                    defaultValue=""
                    disabled={langAdding}
                  >
                    <option value="" disabled>Add language...</option>
                    {unselectedLanguages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.code ? ` (${l.code})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={langAdding}
                    onClick={() => {
                      const sel = document.getElementById('add-site-lang') as HTMLSelectElement;
                      if (sel.value) {
                        handleAddLanguage(Number(sel.value));
                        sel.value = '';
                      }
                    }}
                  >
                    {langAdding ? 'Adding...' : 'Add'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <ChangePasswordCard />
        </div>
      </div>
    </div>
  );
}


/* ── Inline Change Password Card ─────────────────────────────────────── */

function ChangePasswordCard() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pwError, setPwError] = useState('');

  const handleChangePw = async () => {
    setPwError('');
    setResult(null);
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return; }

    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPw,
        new_password: newPw,
        confirm_password: confirmPw,
      });
      setResult('Password changed successfully.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      setPwError(err?.response?.data?.detail || 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lock size={16} />
        Change Password
      </div>
      <div className="card-body">
        {pwError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {pwError}
          </div>
        )}
        {result && (
          <div style={{ background: 'var(--accent-lighter)', border: '1px solid var(--accent)', color: 'var(--accent-hover)', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {result}
          </div>
        )}

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
            Current Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showCur ? 'text' : 'password'}
              className="form-control"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Current password"
              style={{ paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => setShowCur(!showCur)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#a0aec0' }}
            >
              {showCur ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
            New Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showNew ? 'text' : 'password'}
              className="form-control"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="At least 8 characters"
              style={{ paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#a0aec0' }}
            >
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#4a5568' }}>
            Confirm New Password
          </label>
          <input
            type="password"
            className="form-control"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Repeat new password"
          />
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleChangePw}
          disabled={saving || !currentPw || !newPw || !confirmPw}
        >
          {saving ? 'Saving...' : 'Change Password'}
        </button>
      </div>
    </div>
  );
}
