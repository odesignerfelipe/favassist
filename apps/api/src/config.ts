import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().default('http://localhost:5173'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().default(3333),
    LOG_LEVEL: z.string().default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    DATABASE_SSL: bool,

    AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    AUTH_JWT_SECRET: optionalString,
    AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(14),
    /** Cookie de sessão com flag Secure. Padrão: true em produção. Use false só sem HTTPS (ex.: teste local). */
    COOKIE_SECURE: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),

    SUPABASE_URL: optionalString,
    SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_JWT_SECRET: optionalString,

    REDIS_URL: optionalString,

    AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
    AI_MODEL: optionalString,
    AI_API_KEY: optionalString,
    AI_TIMEOUT_MS: z.coerce.number().int().min(5000).default(600_000),

    MESSAGING_PROVIDER: z.enum(['simulator']).default('simulator'),
    SIMULATOR_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    MESSAGING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_PROVIDER === 'local' && (!env.AUTH_JWT_SECRET || env.AUTH_JWT_SECRET.length < 32)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_JWT_SECRET'],
        message: 'Obrigatório com AUTH_PROVIDER=local (mínimo 32 caracteres)',
      });
    }
    if (env.AUTH_PROVIDER === 'supabase') {
      for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Obrigatório com AUTH_PROVIDER=supabase' });
      }
    }
    if (env.AI_PROVIDER !== 'none' && !env.AI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['AI_API_KEY'], message: 'Obrigatório quando AI_PROVIDER não é none' });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${details}\nConsulte .env.example`);
  }
  return parsed.data;
}
