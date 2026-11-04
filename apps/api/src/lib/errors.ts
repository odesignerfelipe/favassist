export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'requisicao_invalida', message, details);
export const unauthorized = (message = 'Sessão inválida ou expirada') => new AppError(401, 'nao_autenticado', message);
export const forbidden = (message = 'Você não tem permissão para esta ação') => new AppError(403, 'sem_permissao', message);
export const notFound = (message = 'Registro não encontrado') => new AppError(404, 'nao_encontrado', message);
export const conflict = (message: string) => new AppError(409, 'conflito', message);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'regra_de_negocio', message, details);
export const unavailable = (message: string) => new AppError(503, 'indisponivel', message);

interface PgLikeError {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
}

/** Converte erros do PostgreSQL (RLS, constraints, triggers) em respostas HTTP claras. */
export function fromPgError(err: unknown): AppError | null {
  const e = err as PgLikeError;
  if (!e || typeof e.code !== 'string' || e.code.length !== 5) return null;
  switch (e.code) {
    case '42501':
      return forbidden(
        e.message?.includes('row-level security') ? 'Você não tem permissão para esta ação' : (e.message ?? undefined),
      );
    case '23505':
      return conflict(uniqueMessage(e.constraint));
    case '23503':
      return unprocessable('Referência inválida: o registro relacionado não existe ou pertence a outra empresa');
    case '23514':
      return unprocessable('Dados fora das regras permitidas', { constraint: e.constraint });
    case '22023':
    case 'P0001':
      return unprocessable(e.message ?? 'Operação não permitida');
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('Formato de dado inválido');
    default:
      return null;
  }
}

function uniqueMessage(constraint?: string): string {
  if (!constraint) return 'Registro duplicado';
  if (constraint.includes('slug')) return 'Já existe uma empresa com este identificador';
  if (constraint.includes('company_members')) return 'Este usuário já faz parte da empresa';
  if (constraint.includes('whatsapp_groups_provider_external')) return 'Este grupo já está vinculado a uma empresa';
  if (constraint.includes('email')) return 'Já existe um usuário com este e-mail';
  return 'Registro duplicado';
}
