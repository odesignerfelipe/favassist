import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/layout/app-shell';
import { BrandMark } from './components/layout/brand';
import { Spinner } from './components/ui/display';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';

const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const CompaniesPage = lazy(() => import('./pages/admin/CompaniesPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const WhatsappMonitorPage = lazy(() => import('./pages/admin/WhatsappMonitorPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const CompanyLayout = lazy(() => import('./pages/company/CompanyLayout'));
const OverviewPage = lazy(() => import('./pages/company/OverviewPage'));
const CalendarPage = lazy(() => import('./pages/company/CalendarPage'));
const ProfilePage = lazy(() => import('./pages/company/ProfilePage'));
const CampaignsPage = lazy(() => import('./pages/company/CampaignsPage'));
const TeamPage = lazy(() => import('./pages/company/TeamPage'));
const AiPage = lazy(() => import('./pages/company/AiPage'));
const WhatsappPage = lazy(() => import('./pages/company/WhatsappPage'));
const MetricsPage = lazy(() => import('./pages/company/MetricsPage'));
const RankingPage = lazy(() => import('./pages/company/RankingPage'));
const ChecklistPage = lazy(() => import('./pages/ChecklistPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <BrandMark />
      <Spinner label="Carregando sua sessão…" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.isFavisAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

/** Acesso à área da empresa: admin ou membro com visão completa. Colaboradores vão para o checklist. */
function RequireCompany({ children }: { children: ReactNode }) {
  const { companyId } = useParams();
  const { user, can } = useAuth();
  if (user?.isFavisAdmin || can(companyId, 'activities.view_all')) return <>{children}</>;
  return <Navigate to="/minhas-tarefas" replace />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.isFavisAdmin) return <Navigate to="/admin" replace />;
  const managed = user.companies.find((c) => c.permissions.includes('activities.view_all'));
  if (managed) return <Navigate to={`/empresas/${managed.id}`} replace />;
  if (user.companies.length) return <Navigate to="/minhas-tarefas" replace />;
  return <Navigate to="/conta" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route
          path="/*"
          element={
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route index element={<HomeRedirect />} />
                <Route path="admin" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
                <Route path="admin/empresas" element={<RequireAdmin><CompaniesPage /></RequireAdmin>} />
                <Route path="admin/usuarios" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
                <Route path="admin/whatsapp" element={<RequireAdmin><WhatsappMonitorPage /></RequireAdmin>} />
                <Route path="admin/auditoria" element={<RequireAdmin><AuditPage /></RequireAdmin>} />
                <Route path="admin/configuracoes" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
                <Route path="empresas/:companyId" element={<RequireCompany><CompanyLayout /></RequireCompany>}>
                  <Route index element={<OverviewPage />} />
                  <Route path="calendario" element={<CalendarPage />} />
                  <Route path="diagnostico" element={<ProfilePage />} />
                  <Route path="campanhas" element={<CampaignsPage />} />
                  <Route path="equipe" element={<TeamPage />} />
                  <Route path="ia" element={<AiPage />} />
                  <Route path="whatsapp" element={<WhatsappPage />} />
                  <Route path="metricas" element={<MetricsPage />} />
                  <Route path="ranking" element={<RankingPage />} />
                </Route>
                <Route path="minhas-tarefas" element={<ChecklistPage />} />
                <Route path="conta" element={<AccountPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
