import type { MemberRole, Permission } from '@fav/shared';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export interface MeCompany {
  id: string;
  name: string;
  slug: string;
  segment: string;
  role: MemberRole;
  permissions: Permission[];
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  isFavisAdmin: boolean;
  companies: MeCompany[];
}

export interface Session {
  accessToken: string;
  expiresAt: number;
  user: Me;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[] | unknown,
  ) {
    super(message);
  }
}

// O access token fica somente em memória; o refresh token está em cookie httpOnly.
let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function onSessionChange(fn: (s: Session | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(s: Session | null) {
  accessToken = s?.accessToken ?? null;
  listeners.forEach((fn) => fn(s));
}

async function parse(res: Response) {
  if (res.status === 204) return undefined;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? 'erro',
      data?.message ?? (res.status >= 500 ? 'Serviço indisponível. Tente novamente.' : 'Não foi possível concluir a ação.'),
      data?.details,
    );
  }
  return data;
}

/** Renova a sessão (uma única requisição simultânea). */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        setSession(null);
        return null;
      }
      const s = (await res.json()) as Session;
      setSession(s);
      return s;
    })
    .catch(() => {
      setSession(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const s = (await parse(res)) as Session;
  setSession(s);
  return s;
}

export async function logout() {
  await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  }).catch(() => undefined);
  setSession(null);
}

type Query = Record<string, string | number | boolean | null | undefined>;

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const qs = query
    ? '?' +
      new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const run = () => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${BASE}${path}${qs}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  let res = await run();
  if (res.status === 401) {
    const s = await refreshSession();
    if (s) res = await run();
  }
  return (await parse(res)) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Mensagem amigável para exibir ao usuário. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length) {
      const first = err.details[0] as { path?: string; message?: string };
      return `${err.message}: ${first.message ?? ''}`.trim();
    }
    return err.message;
  }
  if (err instanceof TypeError) return 'Sem conexão com o servidor. Verifique sua internet.';
  return 'Algo deu errado. Tente novamente.';
}
