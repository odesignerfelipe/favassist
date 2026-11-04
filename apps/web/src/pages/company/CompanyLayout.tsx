import type { Permission } from '@fav/shared';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { Badge, ErrorState, Skeleton } from '@/components/ui/display';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Company } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS: { to: string; label: string; permission: Permission; end?: boolean }[] = [
  { to: '', label: 'Visão geral', permission: 'activities.view_all', end: true },
  { to: 'calendario', label: 'Calendário', permission: 'activities.view_all' },
  { to: 'diagnostico', label: 'Diagnóstico', permission: 'company.view' },
  { to: 'campanhas', label: 'Campanhas', permission: 'company.view' },
  { to: 'equipe', label: 'Equipe', permission: 'company.view' },
  { to: 'ia', label: 'IA', permission: 'ai.use' },
  { to: 'whatsapp', label: 'WhatsApp', permission: 'messaging.view' },
  { to: 'ranking', label: 'Ranking', permission: 'company.view' },
  { to: 'metricas', label: 'Métricas', permission: 'company.view' },
];

export function useCompanyId() {
  return useParams().companyId!;
}

export default function CompanyLayout() {
  const companyId = useCompanyId();
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: ['company', companyId], queryFn: () => api.get<Company>(`/companies/${companyId}`) });

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div>
      <div className="mb-5">
        {user?.isFavisAdmin && <p className="mb-1 text-[13px] font-medium text-muted-foreground">Empresa</p>}
        {q.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{q.data.name}</h1>
            {q.data.status === 'inativa' && <Badge tone="warning">Inativa</Badge>}
          </div>
        ) : (
          <Skeleton className="h-8 w-56" />
        )}
        {q.data?.segment && <p className="mt-0.5 text-muted-foreground">{q.data.segment}</p>}
      </div>
      <nav aria-label="Seções da empresa" className="-mx-4 mb-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.filter((t) => can(companyId, t.permission)).map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-block border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                    isActive && 'border-foreground font-medium text-foreground',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
