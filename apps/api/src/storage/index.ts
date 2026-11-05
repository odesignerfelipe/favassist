import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { isLegacyJwtKey } from '../auth/provider';

/**
 * Armazenamento de arquivos (evidências).
 * Os arquivos são privados: o acesso é sempre por link temporário, gerado pela
 * API somente depois da checagem de permissão do usuário.
 */
export interface FileStorage {
  readonly name: 'local' | 'supabase';
  /** Prepara o destino (ex.: cria o bucket privado no Supabase). */
  ensureReady(): Promise<void>;
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  /** Link temporário para leitura. */
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

export class StorageError extends Error {}

/** Caminhos aceitos: <uuid>/<uuid>/<uuid>.<ext> — sem "..", barras extras ou caracteres especiais. */
const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;
export function assertSafePath(path: string) {
  if (!SAFE_PATH.test(path)) throw new StorageError('Caminho de arquivo inválido');
}

// =============================================================================
// Disco local (desenvolvimento, testes, VPS sem Supabase)
// =============================================================================
export class LocalFileStorage implements FileStorage {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(
    dir: string,
    private readonly secret: string,
    private readonly publicBase = '/api/files',
  ) {
    this.root = resolve(dir);
  }

  private full(path: string) {
    assertSafePath(path);
    const p = resolve(this.root, path);
    if (!p.startsWith(this.root + sep)) throw new StorageError('Caminho de arquivo inválido');
    return p;
  }

  private sign(path: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${path}|${exp}`).digest('base64url');
  }

  async ensureReady() {
    await mkdir(this.root, { recursive: true });
  }

  async put(path: string, data: Buffer) {
    const p = this.full(path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx' });
  }

  async signedUrl(path: string, expiresInSeconds: number) {
    assertSafePath(path);
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${this.publicBase}/${path}?exp=${exp}&sig=${this.sign(path, exp)}`;
  }

  async remove(path: string) {
    await rm(this.full(path), { force: true });
  }

  /** Valida a assinatura e devolve o arquivo (usado pela rota GET /api/files/*). */
  async open(path: string, exp: number, sig: string): Promise<{ stream: Readable; size: number } | null> {
    try {
      assertSafePath(path);
    } catch {
      return null;
    }
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
    const expected = Buffer.from(this.sign(path, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const p = this.full(path);
    const info = await stat(p).catch(() => null);
    if (!info) return null;
    return { stream: createReadStream(p), size: info.size };
  }
}

// =============================================================================
// Supabase Storage (produção) — bucket privado, acesso por URL assinada
// =============================================================================
export class SupabaseFileStorage implements FileStorage {
  readonly name = 'supabase' as const;
  private readonly base: string;

  constructor(
    url: string,
    private readonly secretKey: string,
    private readonly bucket: string,
    private readonly maxBytes: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${url.replace(/\/$/, '')}/storage/v1`;
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { apikey: this.secretKey, ...extra };
    // Chaves novas (sb_secret_) vão só no apikey; chaves legadas (JWT) também como Bearer
    if (isLegacyJwtKey(this.secretKey)) h.authorization = `Bearer ${this.secretKey}`;
    return h;
  }

  private async call(method: string, path: string, init: { body?: RequestInit["body"]; json?: unknown; headers?: Record<string, string> } = {}) {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: this.headers({
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      }),
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* resposta não-JSON */
    }
    return { ok: res.ok, status: res.status, json };
  }

  async ensureReady() {
    const got = await this.call('GET', `/bucket/${this.bucket}`);
    if (got.ok) return;
    const created = await this.call('POST', '/bucket', {
      json: {
        id: this.bucket,
        name: this.bucket,
        public: false,
        file_size_limit: this.maxBytes,
        allowed_mime_types: ['image/*', 'video/*'],
      },
    });
    if (!created.ok && created.status !== 409) {
      throw new StorageError(`Não foi possível preparar o bucket "${this.bucket}" (HTTP ${created.status})`);
    }
  }

  async put(path: string, data: Buffer, contentType: string) {
    assertSafePath(path);
    const r = await this.call('POST', `/object/${this.bucket}/${path}`, {
      body: new Uint8Array(data),
      headers: { 'content-type': contentType, 'x-upsert': 'false', 'cache-control': '3600' },
    });
    if (!r.ok) throw new StorageError(`Falha ao enviar o arquivo (HTTP ${r.status})`);
  }

  async signedUrl(path: string, expiresInSeconds: number) {
    assertSafePath(path);
    const r = await this.call('POST', `/object/sign/${this.bucket}/${path}`, { json: { expiresIn: expiresInSeconds } });
    const signed = (r.json.signedURL ?? r.json.signedUrl) as string | undefined;
    if (!r.ok || !signed) throw new StorageError(`Falha ao gerar o link do arquivo (HTTP ${r.status})`);
    return signed.startsWith('http') ? signed : `${this.base}${signed.startsWith('/') ? '' : '/'}${signed}`;
  }

  async remove(path: string) {
    assertSafePath(path);
    const r = await this.call('DELETE', `/object/${this.bucket}`, { json: { prefixes: [path] } });
    if (!r.ok && r.status !== 404) throw new StorageError(`Falha ao remover o arquivo (HTTP ${r.status})`);
  }
}

// =============================================================================
// Tipos aceitos — conferidos pelo cabeçalho E pela assinatura binária do arquivo
// =============================================================================
export const ALLOWED_TYPES: Record<string, { ext: string; kind: 'image' | 'video' }> = {
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/heic': { ext: 'heic', kind: 'image' },
  'image/heif': { ext: 'heif', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
};

/** Confere se o conteúdo bate com o tipo declarado (evita arquivo disfarçado). */
export function matchesSignature(mime: string, buf: Buffer): boolean {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString('latin1');
  switch (mime) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/webm':
      return buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case 'image/heic':
    case 'image/heif':
    case 'video/mp4':
    case 'video/quicktime':
      return ascii(4, 8) === 'ftyp';
    default:
      return false;
  }
}
