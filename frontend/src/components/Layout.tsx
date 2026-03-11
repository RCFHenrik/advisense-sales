import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import {
  Gauge, Users, Send, Megaphone, FileText, Upload, UserCog, Settings, User,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  section?: string;
  path?: string;
  label?: string;
  icon?: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { section: 'Main' },
  { path: '/', label: 'Dashboard', icon: Gauge },
  { path: '/contacts', label: 'Contacts', icon: Users },
  { path: '/outreach', label: 'Outreach', icon: Send },
  { path: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { section: 'Administration' },
  { path: '/templates', label: 'Email Templates', icon: FileText },
  { path: '/upload', label: 'Data Upload', icon: Upload },
  { path: '/employees', label: 'Consultants', icon: UserCog },
  { path: '/admin', label: 'Settings', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'ba_manager': return 'BA Manager';
      case 'team_manager': return 'Team Manager';
      default: return 'Consultant';
    }
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/advisense_white.png" alt="Advisense" style={{ width: '110%', marginLeft: '-5%', marginBottom: 4 }} />
          <div className="subtitle">Network Orchestration</div>
        </div>

        <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 4 }}>
          <NavLink
            to="/campaign-assignments"
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            style={{ position: 'relative' }}
          >
            <span className="sidebar-icon"><ClipboardList size={18} /></span> My Assignments
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'var(--danger)', color: '#fff', borderRadius: '50%',
                width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </NavLink>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) => {
            if (item.section && !item.path) {
              // Hide admin section for consultants
              if (item.section === 'Administration' && user?.role === 'consultant') return null;
              return <div key={i} className="sidebar-section">{item.section}</div>;
            }

            // Role-based nav visibility
            if (item.path === '/admin' && user?.role !== 'admin') return null;
            if (item.path === '/upload' && !['admin', 'ba_manager'].includes(user?.role || '')) return null;
            if (item.path === '/employees' && !['admin', 'ba_manager', 'team_manager'].includes(user?.role || '')) return null;
            if (item.path === '/campaigns') {
              const hasAccess = ['admin', 'ba_manager'].includes(user?.role || '') || user?.can_campaign;
              if (!hasAccess) return null;
            }

            const IconComponent = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path!}
                end={item.path === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span className="sidebar-icon">
                  {IconComponent && <IconComponent size={18} />}
                </span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <NavLink
          to="/profile"
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          style={{ marginTop: 'auto', marginBottom: 8 }}
        >
          <span className="sidebar-icon"><User size={18} /></span> My Profile
        </NavLink>

        <div className="sidebar-footer">
          <div className="user-name">{user?.name}</div>
          <div className="user-role">{roleLabel(user?.role || '')}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
