// Consentimento de cookies no site (Firefox automatizado): o aviso bloqueia o site
// até a escolha e, com "Recusar", nada opcional fica salvo no navegador.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { addUser, base, close } from '../helpers/backend.mjs';

const FIREFOX = process.env.PF_FIREFOX || '/usr/bin/firefox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
let n = 0;

before(async () => { browser = await puppeteer.launch({ browser: 'firefox', executablePath: FIREFOX, headless: true }); });
after(async () => { await browser?.close(); await close(); });

// Cada cenário num navegador "zerado"
async function novaAba() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

const armazenado = (page) => page.evaluate(() => ({ local: Object.keys(localStorage).sort(), sessao: Object.keys(sessionStorage).sort() }));
const aviso = (page) => page.$('[role="dialog"][aria-labelledby="cookie-titulo"]');
const escolher = async (page, botao) => { await page.locator(`[role="dialog"] ::-p-text(${botao})`).click(); await sleep(300); };

async function entrar(page, email, lembrar) {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('Senha@123');
  if (lembrar) await page.locator('input[type="checkbox"]').click();
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname === '/home', { timeout: 15000 });
  await sleep(800);
}

async function fecharTutorial(page) {
  const pular = await page.$('::-p-text(Pular tour)');
  if (pular) { await pular.click(); await sleep(500); }
}

const aluno = async () => (await addUser({ email: `cookie${++n}@academico.ifsul.edu.br`, nome: `Cookie ${n}`, senha: 'Senha@123' })).email;

test('primeira visita: aviso aparece já no login, bloqueia o site e nada é salvo antes da escolha', async () => {
  const { ctx, page } = await novaAba();
  assert.ok(await aviso(page), 'aviso visível');
  // O que está no centro da tela é a camada do aviso, não o formulário de login
  const bloqueado = await page.evaluate(() => {
    const input = document.querySelector('input[type="email"]');
    const r = input.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== input;
  });
  assert.ok(bloqueado, 'formulário coberto pelo aviso');
  await page.keyboard.press('Escape');
  assert.ok(await aviso(page), 'Esc não fecha o aviso');
  assert.deepEqual((await armazenado(page)).local, []);
  await ctx.close();
});

test('Tab fica preso entre os dois botões do aviso', async () => {
  const { ctx, page } = await novaAba();
  const focos = [];
  for (let i = 0; i < 4; i++) {
    focos.push(await page.evaluate(() => document.activeElement?.innerText?.trim()));
    await page.keyboard.press('Tab');
  }
  assert.deepEqual(focos, ['Recusar', 'Aceitar', 'Recusar', 'Aceitar']);
  await ctx.close();
});

test('recusar: "lembrar de mim" fica desabilitado e só a escolha é salva', async () => {
  const { ctx, page } = await novaAba();
  await escolher(page, 'Recusar');
  assert.equal(await aviso(page), null);
  assert.equal(await page.$eval('input[type="checkbox"]', (c) => c.disabled), true);
  await entrar(page, await aluno(), false);
  await fecharTutorial(page);
  const temaAntes = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.locator('button[aria-label="Alternar tema"]').click();
  await sleep(300);
  assert.notEqual(await page.evaluate(() => document.documentElement.classList.contains('dark')), temaAntes, 'tema trocou');
  const s = await armazenado(page);
  assert.ok(s.sessao.includes('printflow-theme'), 'tema vale durante a visita');
  assert.deepEqual(s.local, ['pf-cookie-consent'], `localStorage: ${s.local}`);
  assert.ok(s.sessao.includes('printflow-token'), 'sessão ativa durante a visita');
  assert.equal(await page.evaluate(() => localStorage.getItem('pf-cookie-consent')), 'rejected');
  await ctx.close();
});

test('aceitar: "lembrar de mim" guarda o login e as preferências ficam salvas', async () => {
  const { ctx, page } = await novaAba();
  await escolher(page, 'Aceitar');
  await entrar(page, await aluno(), true);
  await fecharTutorial(page);
  const s = await armazenado(page);
  assert.ok(s.local.includes('printflow-token'), `localStorage: ${s.local}`);
  assert.ok(s.local.includes('printflow-user'));
  assert.ok(s.local.includes('printflow-onboarded'), 'tutorial visto fica salvo');
  await page.locator('button[aria-label="Alternar tema"]').click();
  await sleep(300);
  assert.ok((await armazenado(page)).local.includes('printflow-theme'), 'tema fica salvo');
  await ctx.close();
});

test('mudar de "aceitar" para "recusar" no Perfil apaga o que estava salvo e mantém a visita', async () => {
  const { ctx, page } = await novaAba();
  await escolher(page, 'Aceitar');
  await entrar(page, await aluno(), true);
  await fecharTutorial(page);
  await page.goto(base + '/profile', { waitUntil: 'domcontentloaded' });
  await page.locator('::-p-text(Alterar escolha)').click();
  await sleep(300);
  assert.ok(await aviso(page), 'aviso volta a aparecer');
  await escolher(page, 'Recusar');
  const s = await armazenado(page);
  assert.deepEqual(s.local, ['pf-cookie-consent'], `localStorage: ${s.local}`);
  assert.ok(s.sessao.includes('printflow-token'), 'continua logado nesta visita');
  assert.ok(new URL(page.url()).pathname.startsWith('/profile'));
  await ctx.close();
});
