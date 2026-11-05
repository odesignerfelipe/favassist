import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseFileStorage } from '../src/storage';
import { addDays, client, createAdmin, createTestApp, login, todayIn, type TestContext } from './helpers';

// PNG 1x1 válido
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

function multipart(file: { name: string; type: string; data: Buffer }, description?: string) {
  const boundary = '----fav' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  if (description !== undefined) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let ctx: TestContext;
let collabToken: string;
let ownerBToken: string;
let companyId: string;
let activityId: string;
const today = todayIn();

async function upload(token: string, file: { name: string; type: string; data: Buffer }, description?: string, aId = activityId) {
  const m = multipart(file, description);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/companies/${companyId}/activities/${aId}/evidences/upload`,
    payload: m.payload,
    headers: { ...m.headers, authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  ctx = await createTestApp({ env: { UPLOAD_MAX_MB: '2' } });
  const a = await createAdmin(ctx);
  const admin = client(ctx, (await login(ctx, a.email, a.password)).token);
  companyId = (await admin.post('/companies', { name: 'Empresa Arquivos' })).body.id;
  const collab = await admin.post(`/companies/${companyId}/members`, {
    email: 'colab@arquivos.dev',
    fullName: 'Colab Arquivos',
    role: 'collaborator',
    password: 'senha-colab-123',
  });
  activityId = (
    await admin.post(`/companies/${companyId}/activities`, {
      title: 'Story com evidência',
      scheduledDate: addDays(today, 1),
      pillar: 'bastidores',
      assigneeId: collab.body.userId,
      status: 'aprovada',
    })
  ).body.id;
  collabToken = (await login(ctx, 'colab@arquivos.dev', 'senha-colab-123')).token;

  const other = (await admin.post('/companies', { name: 'Outra Empresa Arquivos' })).body.id;
  await admin.post(`/companies/${other}/members`, {
    email: 'dono@outra.dev',
    fullName: 'Dono Outra',
    role: 'owner',
    password: 'senha-dono-123',
  });
  ownerBToken = (await login(ctx, 'dono@outra.dev', 'senha-dono-123')).token;
});
afterAll(async () => ctx?.close());

describe('evidências em arquivo', () => {
  let evidenceId: string;
  let fileUrl: string;

  it('colaborador envia uma foto e recebe um link temporário', async () => {
    const r = await upload(collabToken, { name: 'story.png', type: 'image/png', data: PNG }, 'Story publicado às 9h');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'arquivo', mimeType: 'image/png', sizeBytes: PNG.length, originalName: 'story.png', description: 'Story publicado às 9h' });
    expect(r.body.storagePath).toMatch(new RegExp(`^${companyId}/${activityId}/[0-9a-f-]{36}\\.png$`));
    expect(r.body.fileUrl).toMatch(/^\/api\/files\/.+\?exp=\d+&sig=/);
    evidenceId = r.body.id;
    fileUrl = r.body.fileUrl;
  });

  it('o link entrega o arquivo; link adulterado ou expirado é recusado', async () => {
    const ok = await ctx.app.inject({ method: 'GET', url: fileUrl });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.rawPayload.equals(PNG)).toBe(true);

    const tampered = await ctx.app.inject({ method: 'GET', url: fileUrl.replace(/sig=./, 'sig=x') });
    expect(tampered.statusCode).toBe(404);
    const expired = await ctx.app.inject({ method: 'GET', url: fileUrl.replace(/exp=\d+/, 'exp=1000') });
    expect(expired.statusCode).toBe(404);
  });

  it('detalhe da atividade traz a evidência com link', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/companies/${companyId}/activities/${activityId}`,
      headers: { authorization: `Bearer ${collabToken}` },
    });
    const ev = res.json().evidences.find((e: { id: string }) => e.id === evidenceId);
    expect(ev.fileUrl).toMatch(/^\/api\/files\//);
  });

  it('recusa formato não suportado, arquivo disfarçado e arquivo acima do limite', async () => {
    expect((await upload(collabToken, { name: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4') })).status).toBe(415);
    const disguised = await upload(collabToken, { name: 'falso.png', type: 'image/png', data: Buffer.from('<script>alert(1)</script>') });
    expect(disguised.status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(2.2 * 1024 * 1024)]);
    expect((await upload(collabToken, { name: 'grande.png', type: 'image/png', data: big })).status).toBe(413);
  });

  it('aceita arquivos maiores que o limite de corpo JSON (1 MB) dentro do limite de upload', async () => {
    const medium = Buffer.concat([PNG, Buffer.alloc(1.5 * 1024 * 1024)]);
    const r = await upload(collabToken, { name: 'medio.png', type: 'image/png', data: medium });
    expect(r.status).toBe(201);
    expect(r.body.sizeBytes).toBe(medium.length);
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/companies/${companyId}/activities/${activityId}/evidences/${r.body.id}`,
      headers: { authorization: `Bearer ${collabToken}` },
    });
  });

  it('usuário de outra empresa não envia arquivos para a atividade', async () => {
    const r = await upload(ownerBToken, { name: 'x.png', type: 'image/png', data: PNG });
    expect(r.status).toBe(404);
  });

  it('o caminho do arquivo precisa estar na pasta da própria empresa (banco)', async () => {
    await expect(
      ctx.deps.db.asService((tx) =>
        tx.query(
          `insert into activity_evidences (company_id, activity_id, kind, storage_path, mime_type)
           values ($1, $2, 'arquivo', 'outra-empresa/x/y.png', 'image/png')`,
          [companyId, activityId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('concluir a tarefa com foto rende os pontos de evidência', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/companies/${companyId}/activities/${activityId}/status`,
      payload: { status: 'concluida' },
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(res.statusCode).toBe(200);
    const pts = await ctx.deps.db.asService((tx) =>
      tx.query(`select reason from point_events where activity_id = $1 order by id`, [activityId]),
    );
    expect(pts.rows.map((r) => r.reason)).toEqual(['conclusao', 'evidencia']);
  });

  it('remover a evidência apaga o arquivo do armazenamento', async () => {
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/companies/${companyId}/activities/${activityId}/evidences/${evidenceId}`,
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(del.statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: fileUrl })).statusCode).toBe(404);
  });
});

describe('Supabase Storage (respostas simuladas)', () => {
  it('cria o bucket privado se não existir e usa só o cabeçalho apikey com chave nova', async () => {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, headers: init.headers as Record<string, string>, body: init.body });
      if (init.method === 'GET') return new Response('{"error":"not found"}', { status: 400 });
      if (url.includes('/object/sign/')) return new Response(JSON.stringify({ signedURL: '/object/sign/evidencias/a.png?token=t' }));
      return new Response('{}');
    }) as typeof fetch;
    const s = new SupabaseFileStorage('https://x.supabase.co', 'sb_secret_abc', 'evidencias', 50 * 1024 * 1024, fetchImpl);
    await s.ensureReady();
    const path = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';
    await s.put(path, PNG, 'image/png');
    const url = await s.signedUrl(path, 3600);

    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://x.supabase.co/storage/v1/bucket' });
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({ id: 'evidencias', public: false });
    expect(calls[2]!.url).toBe(`https://x.supabase.co/storage/v1/object/evidencias/${path}`);
    expect(calls[2]!.headers).toMatchObject({ apikey: 'sb_secret_abc', 'content-type': 'image/png' });
    expect(calls[2]!.headers.authorization).toBeUndefined();
    expect(url).toBe('https://x.supabase.co/storage/v1/object/sign/evidencias/a.png?token=t');
    await expect(s.put('../../etc/passwd', PNG, 'image/png')).rejects.toThrow('Caminho de arquivo inválido');
  });
});
