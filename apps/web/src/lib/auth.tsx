import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as apiClient from './api';
import type { Me, MeCompany } from './api';
import type { Permission } from '@fav/shared';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: Me | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  company(companyId: string | undefined): MeCompany | undefined;
  can(companyId: string | undefined, permission: Permission): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const off = apiClient.onSessionChange((s) => {
      setUser(s?.user ?? null);
      setExpiresAt(s?.expiresAt ?? null);
      setStatus(s ? 'authenticated' : 'anonymous');
      if (!s) qc.clear();
    });
    void apiClient.refreshSession();
    return () => {
      off();
    };
  }, [qc]);

  // Renova o token antes de expirar
  useEffect(() => {
    if (!expiresAt) return;
    const ms = Math.max(5_000, expiresAt * 1000 - Date.now() - 60_000);
    const t = setTimeout(() => void apiClient.refreshSession(), ms);
    return () => clearTimeout(t);
  }, [expiresAt]);

  const login = useCallback(async (email: string, password: string) => {
    await apiClient.login(email, password);
  }, []);
  const logout = useCallback(async () => {
    await apiClient.logout();
  }, []);
  const reload = useCallback(async () => {
    const me = await apiClient.api.get<Me>('/auth/me');
    setUser(me);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login,
      logout,
      reload,
      company: (id) => user?.companies.find((c) => c.id === id),
      can: (id, permission) => {
        if (!user) return false;
        if (user.isFavisAdmin) return true;
        return !!user.companies.find((c) => c.id === id)?.permissions.includes(permission);
      },
    }),
    [status, user, login, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
