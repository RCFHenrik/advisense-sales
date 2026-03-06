import { useState, useEffect } from 'react';
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
  const [profileDescription, setProfileDescription] = useState('');
  const [expertiseTags, setExpertiseTags] = useState('');
  const [seniority, setSeniority] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Site languages
  const [availableLanguages, setAvailableLanguages] = useState<SiteLanguageItem[]>([]);
  const [myLanguages, setMyLanguages] = useState<EmployeeSiteLanguage[]>([]);
  const [langAdding, setLangAdding] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      const emp: Employee = r.data;
      setProfile(emp);
      setProfileDescription(emp.profile_description || '');
      setSeniority(emp.seniority || '');
      setMyLanguages(emp.site_languages || []);
      if (emp.domain_expertise_tags) {
        try {
          const tags = JSON.parse(emp.domain_expertise_tags);
          setExpertiseTags(Array.isArray(tags) ? tags.join(', ') : emp.domain_expertise_tags);
        } catch {
          setExpertiseTags(emp.domain_expertise_tags);
        }
      }
    }).catch(() => {});

    // Load available site languages
    api.get('/admin/site-languages').then((r) => setAvailableLanguages(r.data)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const tagsArray = expertiseTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.patch('/employees/me', {
        profile_description: profileDescription,
        domain_expertise_tags: JSON.stringify(tagsArray),
        seniority: seniority || null,
      });
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
              <dd>{profile.name}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Email:</dt>
              <dd>{profile.email}</dd>
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
                  Domain Expertise Tags
                </label>
                <input
                  className="form-control"
                  value={expertiseTags}
                  onChange={(e) => { setExpertiseTags(e.target.value); setSaved(false); }}
                  placeholder="e.g. Risk Modelling, IFRS 9, Basel IV"
                />
                <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 4 }}>
                  Comma-separated. Used for automatic outreach matching.
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
                {saved && (
                  <span style={{ color: '#38a169', fontSize: 13 }}>Saved successfully.</span>
                )}
                {error && (
                  <span style={{ color: '#e53e3e', fontSize: 13 }}>{error}</span>
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
                          color: '#c53030',
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
        </div>
      </div>
    </div>
  );
}
