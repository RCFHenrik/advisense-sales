import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Employee } from '../types';

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Employee | null>(null);
  const [profileDescription, setProfileDescription] = useState('');
  const [expertiseTags, setExpertiseTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      const emp: Employee = r.data;
      setProfile(emp);
      setProfileDescription(emp.profile_description || '');
      if (emp.domain_expertise_tags) {
        try {
          const tags = JSON.parse(emp.domain_expertise_tags);
          setExpertiseTags(Array.isArray(tags) ? tags.join(', ') : emp.domain_expertise_tags);
        } catch {
          setExpertiseTags(emp.domain_expertise_tags);
        }
      }
    }).catch(() => {});
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
      });
      setSaved(true);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
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
              <dd style={{ textTransform: 'capitalize' }}>{profile.seniority || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Team:</dt>
              <dd>{profile.team_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Business Area:</dt>
              <dd>{profile.business_area_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Site:</dt>
              <dd>{profile.site_name || '—'}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Language:</dt>
              <dd>{profile.primary_language?.toUpperCase()}</dd>
              <dt style={{ color: '#718096', fontWeight: 500 }}>Outreach Target:</dt>
              <dd>{profile.outreach_target_per_week} per week</dd>
            </dl>
          </div>
        </div>

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
                rows={7}
                value={profileDescription}
                onChange={(e) => { setProfileDescription(e.target.value); setSaved(false); }}
                placeholder="Describe your background, specialisations, and the types of client engagements you excel at. This text is used to improve outreach allocation."
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
      </div>
    </div>
  );
}
