import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { Campaign } from '../types';

const STATUS_OPTIONS = ['', 'draft', 'ready', 'sending', 'sent', 'cancelled'];
const STATUS_LABELS: Record<string, string> = {
  '': 'All Statuses',
  draft: 'Draft',
  ready: 'Ready',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled',
};

export default function CampaignsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/campaigns/', { params });
      setCampaigns(res.data);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, [statusFilter]);

  const handleCreate = async () => {
    try {
      const res = await api.post('/campaigns/', { name: 'New Campaign' });
      navigate(`/campaigns/${res.data.id}`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to create campaign');
    }
  };

  const canDelete = (c: Campaign) => {
    if (c.status === 'sent' || c.status === 'sending') return false;
    const role = user?.role || '';
    if (['admin', 'ba_manager'].includes(role)) return true;
    if (user?.id === c.created_by_id) return true;
    return false;
  };

  const handleDelete = async (c: Campaign) => {
    if (!confirm(`Remove campaign "${c.name}"? This will permanently delete it and all its recipients.`)) return;
    try {
      await api.delete(`/campaigns/${c.id}`);
      fetchCampaigns();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to delete campaign');
    }
  };

  const badgeClass = (status: string) => {
    switch (status) {
      case 'draft': return 'badge badge-draft';
      case 'ready': return 'badge badge-ready';
      case 'sending': return 'badge badge-sending';
      case 'sent': return 'badge badge-sent';
      case 'cancelled': return 'badge badge-cancelled';
      default: return 'badge';
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Campaign Outreach</h1>
          <p className="page-subtitle">Send newsletters and bulk communications</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select
          className="form-control"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: 180 }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        {['admin', 'ba_manager', 'team_manager'].includes(user?.role || '') && (
          <button className="btn btn-primary" onClick={handleCreate} style={{ marginLeft: 'auto' }}>
            + New Campaign
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Sent</th>
                <th>Language</th>
                <th>BCC</th>
                <th>Created By</th>
                <th>Sent At</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32 }}>Loading...</td></tr>
              ) : campaigns.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: '#999' }}>No campaigns found</td></tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/campaigns/${c.id}`)}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td><span className={badgeClass(c.status)}>{STATUS_LABELS[c.status] || c.status}</span></td>
                    <td>{c.recipient_count}</td>
                    <td>{c.sent_count}</td>
                    <td>{c.email_language?.toUpperCase()}</td>
                    <td>{c.bcc_mode ? 'Yes' : 'No'}</td>
                    <td>{c.created_by_name || '—'}</td>
                    <td>{c.sent_at ? new Date(c.sent_at).toLocaleDateString() : '—'}</td>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/campaigns/${c.id}`); }}
                        >
                          View
                        </button>
                        {canDelete(c) && (
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--danger)', fontSize: 11 }}
                            onClick={(e) => { e.stopPropagation(); handleDelete(c); }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
