import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ContactsPage from './pages/ContactsPage';
import OutreachPage from './pages/OutreachPage';
import OutreachDetailPage from './pages/OutreachDetailPage';
import TemplatesPage from './pages/TemplatesPage';
import UploadPage from './pages/UploadPage';
import AdminPage from './pages/AdminPage';
import EmployeesPage from './pages/EmployeesPage';
import ProfilePage from './pages/ProfilePage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/outreach" element={<OutreachPage />} />
                <Route path="/outreach/:id" element={<OutreachDetailPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
