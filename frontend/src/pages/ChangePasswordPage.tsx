import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ChangePasswordPage() {
  const { clearMustChangePassword, mustChangePassword } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      clearMustChangePassword();
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 20px' }}>
      <div className="card" style={{ padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Lock size={40} style={{ color: 'var(--primary)', marginBottom: 12 }} />
          <h2 style={{ margin: 0 }}>
            {mustChangePassword ? 'Change Your Password' : 'Update Password'}
          </h2>
          {mustChangePassword && (
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
              You were given a temporary password. Please set a new password to continue.
            </p>
          )}
        </div>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              Current Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="form-input"
                style={{ width: '100%', paddingRight: 40 }}
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
                }}
              >
                {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              New Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="form-input"
                style={{ width: '100%', paddingRight: 40 }}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
                }}
              >
                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="form-input"
              style={{ width: '100%' }}
              placeholder="Repeat new password"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px 0', fontSize: 15 }}
          >
            {saving ? 'Saving...' : 'Change Password'}
          </button>

          {!mustChangePassword && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="btn"
              style={{ width: '100%', marginTop: 8, padding: '10px 0', fontSize: 14 }}
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
