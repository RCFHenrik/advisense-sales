import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../api/client';
import type { Employee } from '../types';

interface AuthContextType {
  user: Employee | null;
  token: string | null;
  fxRates: Record<string, number>;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearMustChangePassword: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Employee | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        return !!u.must_change_password;
      } catch { return false; }
    }
    return false;
  });
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => {
    const stored = localStorage.getItem('fxRates');
    return stored ? JSON.parse(stored) : {};
  });

  // Fetch FX rates whenever we have a valid token
  const fetchFxRates = () => {
    api.get('/admin/fx-rates')
      .then((res) => {
        setFxRates(res.data);
        localStorage.setItem('fxRates', JSON.stringify(res.data));
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (token && !user) {
      api.get('/auth/me').then((res) => {
        setUser(res.data);
        setMustChangePassword(!!res.data.must_change_password);
        localStorage.setItem('user', JSON.stringify(res.data));
      }).catch(() => {
        logout();
      });
    }
    if (token) {
      fetchFxRates();
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { access_token, employee } = res.data;
      setToken(access_token);
      setUser(employee);
      setMustChangePassword(!!employee.must_change_password);
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(employee));
      // FX rates will be fetched by the useEffect on token change
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setFxRates({});
    setMustChangePassword(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('fxRates');
  };

  const clearMustChangePassword = () => {
    setMustChangePassword(false);
    // Update stored user data
    if (user) {
      const updatedUser = { ...user, must_change_password: false };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, fxRates, mustChangePassword, login, logout, clearMustChangePassword, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
