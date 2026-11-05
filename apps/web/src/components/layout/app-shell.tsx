import {
  Building2,
  ChevronsUpDown,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MEMBER_ROLE_LABELS } from '@fav/shared';
import { Avatar } from '@/components/ui/display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand';
import { NotificationBell } from './notification-bell';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

function useNavSections() {
  const { user } = useAuth();
  if (!user) return [];
  const sections: { title?: string; items: NavItem[] }[] = [];
  if (user.isFavisAdmin) {
    sections.push({
      title: 'FAVIS',
      items: [
        { to: '/admin', label: 'Visão geral', icon: LayoutDashboard, end: true },
        { to: '/admin/empresas', label: 'Empresas', icon: Building2 },
        { to: '/admin/usuarios', label: 'Usuários', icon: Users },
        { to: '/admin/whatsapp', label: 'WhatsApp', icon: MessageSquare },
        { to: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
        { to: '/admin/configuracoes', label: 'Configurações', icon: Settings },
      ],
    });
  }
  if (user.companies.length) {
    sections.push({
      title: user.companies.length > 1 ? 'Minhas empresas' : 'Minha empresa',
      items: user.companies
        .filter((c) => c.permissions.includes('activities.view_all'))
        .map((c) => ({ to: `/empresas/${c.id}`, label: c.name, icon: Building2 })),
    });
  }
  sections.push({
    title: 'Pessoal',
    items: [
      ...(user.companies.length ? [{ to: '/minhas-tarefas', label: 'Minhas tarefas', icon: ClipboardCheck }] : []),
      { to: '/conta', label: 'Minha conta', icon: UserRound },
    ],
  });
  return sections.filter((s) => s.items.length);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const sections = useNavSections();
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-6">
      {sections.map((s) => (
        <div key={s.title}>
          {s.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{s.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {s.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/75 transition-colors hover:bg-surface-muted hover:text-foreground',
                      isActive && 'bg-surface-muted font-medium text-foreground',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const role = user.isFavisAdmin
    ? 'Administrador FAVIS'
    : user.companies[0]
      ? MEMBER_ROLE_LABELS[user.companies[0].role]
      : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-surface-muted" aria-label="Menu do usuário">
        <Avatar name={user.fullName || user.email} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.fullName || user.email}</p>
          <p className="truncate text-xs text-muted-foreground">{role}</p>
        </div>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/conta')}>
          <UserRound /> Minha conta
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout().then(() => navigate('/login'))}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate, showBell }: { onNavigate?: () => void; showBell?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-4 pt-5">
        <BrandMark />
        {showBell && <NotificationBell className="-mr-2" />}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="border-t p-2">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Ir para o conteúdo
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r bg-surface lg:block">
        <Sidebar showBell />
      </aside>

      {/* Barra superior no celular/tablet */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-surface/90 px-4 backdrop-blur lg:hidden">
        <BrandMark />
        <div className="flex items-center gap-1">
        <NotificationBell />
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger className="rounded-md p-2 hover:bg-surface-muted" aria-label="Abrir menu">
            <Menu className="size-5" />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-black/30" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-[84%] max-w-xs bg-surface shadow-2xl data-[state=open]:animate-fade-in">
              <D.Title className="sr-only">Menu</D.Title>
              <D.Description className="sr-only">Navegação principal</D.Description>
              <Sidebar onNavigate={() => setOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
        </div>
      </header>

      <main id="conteudo" key={location.pathname.split('/').slice(0, 3).join('/')} className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl animate-fade-in">{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
