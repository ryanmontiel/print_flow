// Bateria 7: interface do kiosk no Firefox (automatizado com puppeteer-core),
// usando o servidor real do kiosk, o backend simulado e a impressora virtual.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { addUser, user, close } from '../helpers/backend.mjs';
import { criarFila, removerFila, ligarImpressora, retomarFila } from '../helpers/impressora.mjs';
import { subirKiosk, encerrar, kiosk, filesBase, arquivos } from '../helpers/kiosk.mjs';
import { gerarPdf, RETRATO, PAISAGEM } from '../helpers/pdf.mjs';

const FIREFOX = process.env.PF_FIREFOX || '/usr/bin/firefox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const impressora = ligarImpressora({ demoraMs: 1500 });
let browser;

arquivos.set('/uploads/retrato.pdf', gerarPdf({ paginas: 2, ...RETRATO, titulo: 'Retrato' }));
arquivos.set('/uploads/paisagem.pdf', gerarPdf({ paginas: 2, ...PAISAGEM, titulo: 'Paisagem' }));
const docs = () => JSON.stringify([
  { id: 'r', name: 'Documento Retrato', originalname: 'retrato.pdf', mimetype: 'application/pdf', size: 1000, url: `${filesBase}/uploads/retrato.pdf`, uploadedAt: new Date().toISOString() },
  { id: 'p', name: 'Documento Paisagem', originalname: 'paisagem.pdf', mimetype: 'application/pdf', size: 1000, url: `${filesBase}/uploads/paisagem.pdf`, uploadedAt: new Date().toISOString() },
]);

let n = 0;
const aluno = (creditos) => addUser({ email: `ui${++n}@academico.ifsul.edu.br`, nome: `Aluno UI ${n}`, senha: 'Senha@123', creditos: String(creditos), documentos: docs() });

// Relógio acelerado: o tempo da página passa N vezes mais rápido (para o teste de inatividade)
const acelerarRelogio = (fator) => `(() => {
  const real = Date.now.bind(Date), t0 = real();
  Date.now = () => t0 + (real() - t0) * ${fator};
})();`;

async function abrir({ relogio } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  if (relogio) await page.evaluateOnNewDocument(acelerarRelogio(relogio));
  await page.goto(kiosk + '/', { waitUntil: 'domcontentloaded' });
  return page;
}

async function entrar(page, email) {
  await page.locator('input[placeholder="seu@email.com"]').fill(email);
  await page.locator('input[placeholder="Digite sua senha"]').fill('Senha@123');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname.startsWith('/print'), { timeout: 15000 });
}

const texto = (page) => page.evaluate(() => document.body.innerText);
const esperarTexto = (page, t, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);

async function abrirDocumento(page, nome) {
  await page.locator(`::-p-text(${nome})`).click();
  // Espera o PDF ser desenhado no canvas principal
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas.shadow-lg');
    return c && c.width > 0 && c.style.width;
  }, { timeout: 20000 });
  await sleep(800);
}

// Proporções do canvas principal: tamanho na tela (CSS) e tamanho desenhado (pixels)
const medirPrevia = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas.shadow-lg');
  const r = c.getBoundingClientRect();
  const thumbs = [...document.querySelectorAll('button canvas.block')].map((t) => t.getBoundingClientRect().height / t.getBoundingClientRect().width);
  return { tela: r.height / r.width, desenho: c.height / c.width, alturaTela: r.height, thumbs };
});

before(async () => {
  criarFila();
  retomarFila();
  await impressora.ligar();
  await subirKiosk();
  browser = await puppeteer.launch({ browser: 'firefox', executablePath: FIREFOX, headless: true });
});
after(async () => {
  await browser?.close();
  await impressora.desligar();
  removerFila();
  await encerrar();
  await close();
});

test('login com senha errada mostra erro e não entra', async () => {
  const u = await aluno(5);
  const page = await abrir();
  await page.locator('input[placeholder="seu@email.com"]').fill(u.email);
  await page.locator('input[placeholder="Digite sua senha"]').fill('Errada@123');
  await page.locator('button[type="submit"]').click();
  await esperarTexto(page, 'Credenciais inválidas');
  assert.equal(new URL(page.url()).pathname, '/');
  await page.close();
});

test('login mostra o nome, o saldo e os documentos do aluno', async () => {
  const u = await aluno(7.5);
  const page = await abrir();
  await entrar(page, u.email);
  await esperarTexto(page, 'Documento Paisagem');
  const t = await texto(page);
  assert.match(t, /Aluno UI/);
  assert.match(t, /R\$\s?7,50/);
  assert.match(t, /Documento Retrato/);
  await page.close();
});

test('prévia mantém a proporção: retrato em pé, paisagem deitado, inclusive ao alternar', async () => {
  const u = await aluno(5);
  const page = await abrir();
  await entrar(page, u.email);
  const medidas = [];
  for (const nome of ['Documento Retrato', 'Documento Paisagem', 'Documento Retrato', 'Documento Paisagem', 'Documento Retrato', 'Documento Paisagem']) {
    await abrirDocumento(page, nome);
    const m = await medirPrevia(page);
    medidas.push({ nome, ...m });
    const esperado = nome.includes('Retrato') ? 842 / 595 : 595 / 842;
    assert.ok(Math.abs(m.tela - esperado) < 0.03, `${nome}: proporção na tela ${m.tela.toFixed(3)} (esperado ${esperado.toFixed(3)})`);
    assert.ok(Math.abs(m.desenho - esperado) < 0.03, `${nome}: proporção desenhada ${m.desenho.toFixed(3)}`);
    assert.ok(m.alturaTela <= 420, `${nome}: cabe na área (altura ${m.alturaTela})`);
    for (const t of m.thumbs) assert.ok(Math.abs(t - esperado) < 0.05, `${nome}: miniatura ${t.toFixed(3)}`);
    await page.locator('button ::-p-text(Voltar)').click().catch(async () => { await page.goBack(); });
    await sleep(300);
  }
  await page.close();
});

test('sem saldo: aviso aparece e o botão Imprimir fica desabilitado', async () => {
  const u = await aluno(0.2);
  const page = await abrir();
  await entrar(page, u.email);
  await abrirDocumento(page, 'Documento Retrato');
  await esperarTexto(page, 'Créditos insuficientes');
  const desabilitado = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Imprimir ('))?.disabled);
  assert.equal(desabilitado, true);
  await page.close();
});

test('impressão pela tela: mostra andamento, conclui e atualiza o saldo', async () => {
  const u = await aluno(5);
  const page = await abrir();
  await entrar(page, u.email);
  await abrirDocumento(page, 'Documento Retrato');
  const antes = impressora.recebidos.length;
  await page.locator('::-p-text(Imprimir ()').click();
  await esperarTexto(page, 'Impressão concluída', 60000);
  assert.equal(impressora.recebidos.length - antes, 1);
  assert.equal(Number(user(u).creditos), 4, '2 páginas P&B = R$1,00');
  await page.close();
});

test('clique duplo no Imprimir gera só um trabalho', async () => {
  const u = await aluno(5);
  const page = await abrir();
  await entrar(page, u.email);
  await abrirDocumento(page, 'Documento Paisagem');
  const antes = impressora.recebidos.length;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Imprimir ('));
    b.click(); b.click(); b.click();
  });
  await esperarTexto(page, 'Impressão concluída', 60000);
  await sleep(2000);
  assert.equal(impressora.recebidos.length - antes, 1);
  assert.equal(Number(user(u).creditos), 4);
  await page.close();
});

test('inatividade: avisa e encerra a sessão sozinho após 2 minutos', async () => {
  const u = await aluno(5);
  const page = await abrir({ relogio: 10 });
  await entrar(page, u.email);
  await esperarTexto(page, 'Documento Retrato');
  // 2 min de relógio acelerado (10x) ≈ 12 s reais; o aviso aparece nos últimos 20 s
  await esperarTexto(page, 'Sessão será encerrada', 20000);
  await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
  const token = await page.evaluate(() => sessionStorage.getItem('pf-kiosk-token'));
  assert.equal(token, null, 'token apagado');
  await page.close();
});

test('tocar na tela durante o aviso mantém a sessão', async () => {
  const u = await aluno(5);
  const page = await abrir({ relogio: 10 });
  await entrar(page, u.email);
  await esperarTexto(page, 'Sessão será encerrada', 20000);
  await page.mouse.click(640, 400);
  await sleep(1500);
  assert.ok(new URL(page.url()).pathname.startsWith('/print'));
  assert.ok(!(await texto(page)).includes('Sessão será encerrada'), 'aviso some');
  await page.close();
});

test('botão Sair apaga a sessão e não dá para voltar sem login', async () => {
  const u = await aluno(5);
  const page = await abrir();
  await entrar(page, u.email);
  await page.locator('button[title="Sair"]').click();
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
  await page.goto(kiosk + '/print', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
  await page.close();
});

test('atalhos bloqueados na tela do kiosk; digitar e colar continuam funcionando', async () => {
  const page = await abrir();
  const resultado = await page.evaluate(() => {
    const tenta = (init) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      document.querySelector('input[placeholder="seu@email.com"]').dispatchEvent(e);
      return e.defaultPrevented;
    };
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(menu);
    return {
      bloqueados: {
        'Ctrl+P': tenta({ key: 'p', ctrlKey: true }),
        'Ctrl+S': tenta({ key: 's', ctrlKey: true }),
        'Ctrl+R': tenta({ key: 'r', ctrlKey: true }),
        F5: tenta({ key: 'F5' }),
        F11: tenta({ key: 'F11' }),
        F12: tenta({ key: 'F12' }),
        'Ctrl+Shift+I': tenta({ key: 'I', ctrlKey: true, shiftKey: true }),
        'Ctrl++ (zoom)': tenta({ key: '+', ctrlKey: true }),
        'Alt+← (voltar)': tenta({ key: 'ArrowLeft', altKey: true }),
        'clique direito': menu.defaultPrevented,
      },
      liberados: {
        'letra a': tenta({ key: 'a' }),
        'Ctrl+V (colar)': tenta({ key: 'v', ctrlKey: true }),
        'Ctrl+C (copiar)': tenta({ key: 'c', ctrlKey: true }),
        'Ctrl+A (selecionar)': tenta({ key: 'a', ctrlKey: true }),
        Backspace: tenta({ key: 'Backspace' }),
      },
    };
  });
  for (const [atalho, bloqueado] of Object.entries(resultado.bloqueados)) assert.equal(bloqueado, true, `${atalho} deveria ser bloqueado`);
  for (const [tecla, bloqueado] of Object.entries(resultado.liberados)) assert.equal(bloqueado, false, `${tecla} deveria funcionar`);
  // Digitação de verdade no campo
  await page.locator('input[placeholder="seu@email.com"]').fill('aluno@academico.ifsul.edu.br');
  assert.equal(await page.$eval('input[placeholder="seu@email.com"]', (i) => i.value), 'aluno@academico.ifsul.edu.br');
  await page.close();
});
