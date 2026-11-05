/**
 * Teste E2E do MARCO 1 no navegador (Playwright).
 *
 * Pré-requisitos: API e web rodando (pnpm dev), banco migrado e um admin criado (pnpm db:seed:admin).
 * Uso:
 *   E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... node e2e/milestone.e2e.mjs
 * Variáveis opcionais: E2E_SCREENSHOTS=<pasta> para salvar capturas de tela.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@favis.dev', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin-fav-2026' };
const SHOTS = process.env.E2E_SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const id = Date.now().toString(36);
const company = `Empresa E2E ${id}`;
const collab = { name: `Colaborador E2E ${id}`, email: `colab-${id}@e2e.dev`, password: 'senha-e2e-12345' };
const task = `Bastidores E2E ${id}`;

const steps = [];
async function step(name, fn) {
  const t = Date.now();
  await fn();
  steps.push(`✓ ${name} (${Date.now() - t}ms)`);
  console.log(steps.at(-1));
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function logout(page) {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
}

const browser = await chromium.launch();
// Navegador no fuso das empresas (Brasil), como os usuários reais
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('Erro na página:', e.message));
let companyUrl = '';

try {
  await step('1. Admin FAVIS acessa o sistema', async () => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
    await shot(page, '01-admin-dashboard');
  });

  await step('2. Cadastra uma empresa', async () => {
    await page.getByRole('link', { name: 'Empresas' }).first().click();
    await page.getByRole('button', { name: 'Nova empresa' }).first().click();
    await page.getByLabel('Nome da empresa').fill(company);
    await page.getByLabel('Segmento de atuação').fill('Padaria artesanal');
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL('**/diagnostico');
    companyUrl = page.url().replace(/\/diagnostico$/, '');
  });

  await step('3. Configura o diagnóstico estratégico', async () => {
    await page.getByLabel('Descrição do negócio').fill('Padaria de fermentação natural no bairro.');
    await page.getByLabel('Público-alvo').fill('Famílias do bairro que valorizam pão artesanal.');
    await page.getByLabel('Tom de comunicação').fill('Próximo e alegre');
    await page.getByRole('button', { name: 'Salvar diagnóstico' }).click();
    await page.getByText('Diagnóstico salvo').waitFor();
    await shot(page, '03-diagnostico');
  });

  await step('4. Cadastra uma campanha', async () => {
    await page.getByRole('link', { name: 'Campanhas' }).click();
    await page.getByRole('button', { name: 'Nova campanha' }).click();
    await page.getByLabel('Nome').fill('Panetone artesanal');
    await page.getByLabel('Ofertas confirmadas').fill('Panetone 1kg por R$ 89,90');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Campanha cadastrada').waitFor();
  });

  await step('6a. Adiciona um colaborador à equipe', async () => {
    await page.getByRole('link', { name: 'Equipe' }).click();
    await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
    await page.getByLabel('Nome completo').fill(collab.name);
    await page.getByLabel('E-mail').fill(collab.email);
    await page.getByLabel('Papel').selectOption({ label: 'Colaborador' });
    await page.getByLabel('Senha inicial').fill(collab.password);
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByText('Usuário criado e adicionado à equipe').waitFor();
  });

  await step('5/6b. Cria atividade no calendário e atribui responsável', async () => {
    await page.getByRole('link', { name: 'Calendário' }).click();
    await page.getByRole('button', { name: 'Nova atividade', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Título').fill(task);
    await dlg.getByLabel('Horário recomendado').fill('09:00');
    await dlg.getByLabel('Categoria (pilar)').selectOption('bastidores');
    await dlg.getByLabel('Quantidade de Stories').fill('3');
    await dlg.getByLabel('Responsável').selectOption({ label: collab.name });
    await dlg.getByLabel('Status inicial').selectOption('aprovada');
    await dlg.getByLabel('Roteiro').fill('1. Mostre a massa saindo do forno.\n2. Explique a fermentação de 48h.');
    await dlg.getByLabel('Chamada para ação').fill('Responda a enquete: qual pão você prefere?');
    await page.getByRole('button', { name: 'Criar atividade' }).click();
    await page.getByText('Atividade criada').waitFor();
    await page.getByRole('button', { name: new RegExp(task) }).first().waitFor();
    await shot(page, '05-calendario');
  });

  await step('10. Simula o envio do planejamento pelo WhatsApp', async () => {
    await page.getByRole('link', { name: 'WhatsApp' }).last().click();
    await page.getByRole('button', { name: 'Vincular' }).click();
    await page.getByLabel('Nome do grupo').fill(`Grupo ${company}`);
    await page.getByLabel('Identificador do grupo').fill(`grupo-${id}`);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Grupo vinculado').waitFor();
    await page.getByRole('button', { name: 'Enviar cronograma de hoje' }).click();
    await page.getByText('Cronograma enviado (simulado)').waitFor();
    const bubble = page.getByText(/assistente virtual de marketing da FAVIS/).first();
    await bubble.waitFor();
    assert.match(await bubble.innerText(), new RegExp(task));
    await shot(page, '10-whatsapp');
    await logout(page);
  });

  await step('7/8. Colaborador vê a tarefa e conclui', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, collab.email, collab.password);
    await page.waitForURL('**/minhas-tarefas');
    await page.getByText(task).waitFor();
    await shot(page, '07-checklist-mobile');
    await page.getByRole('button', { name: `Concluir: ${task}` }).click();
    await page.getByText('Tarefa concluída!').waitFor();
    await page.getByRole('button', { name: 'Concluída', exact: true }).waitFor();
    await shot(page, '08-checklist-concluida');
    // Colaborador não acessa a área de gestão
    await page.goto(companyUrl);
    await page.waitForURL('**/minhas-tarefas');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('button', { name: 'Menu do usuário' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await page.waitForURL('**/login');
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('9. Dashboard reflete a execução', async () => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto(companyUrl);
    const stat = page.getByText('Concluídas', { exact: true }).locator('xpath=..').locator('p').nth(1);
    await stat.waitFor();
    assert.equal((await stat.innerText()).trim(), '1');
    await page.getByText('100%').first().waitFor();
    await shot(page, '09-dashboard-empresa');
  });

  console.log(`\nMarco 1 validado no navegador: ${steps.length} etapas.`);
} catch (err) {
  await shot(page, 'erro');
  console.error('\n✗ Falha no E2E:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
