// Bateria 6: fila de impressão do kiosk (servidor real do kiosk + CUPS + impressora virtual).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { addUser, login, user, json, close } from '../helpers/backend.mjs';
import { criarFila, removerFila, ligarImpressora, retomarFila, atributosDoTrabalho } from '../helpers/impressora.mjs';
import { subirKiosk, derrubarKiosk, encerrar, k, esperarFim, filesBase, falhas, log } from '../helpers/kiosk.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const impressora = ligarImpressora();
const doc = () => `${filesBase}/uploads/doc.pdf`;
let n = 0;
const aluno = async (creditos) => {
  const u = await addUser({ email: `kiosk${++n}@academico.ifsul.edu.br`, nome: `K${n}`, senha: 'Senha@123', creditos: String(creditos) });
  return { u, token: await login(u.email, 'Senha@123', { client: 'kiosk' }) };
};
const imprimir = (token, extra = {}) => k('/api/print/start', { token, body: { fileUrl: doc(), documentId: 'd1', documentName: 'Doc', pages: 1, copies: 1, pageRanges: '1', color: 'bw', duplex: 'single', ...extra } });
const saldo = (a) => Number(user(a.u).creditos);

before(async () => {
  criarFila();
  retomarFila();
  await impressora.ligar();
  await subirKiosk();
});
after(async () => {
  if (impressora.ligada) await impressora.desligar();
  removerFila();
  await encerrar();
  await close();
});

test('impressão simples: imprime e debita R$0,50 por página P&B', async () => {
  const a = await aluno(5);
  const r = await imprimir(a.token);
  assert.equal(r.status, 200);
  const fim = await esperarFim(r.data.jobId);
  assert.equal(fim.status, 'completed');
  assert.equal(saldo(a), 4.5);
  const c = await k('/api/print/complete', { body: { jobId: r.data.jobId } });
  assert.equal(c.data.credits, 4.5, 'tela recebe o saldo atualizado');
});

test('cópias e páginas escolhidas chegam ao CUPS e são cobradas certo', async () => {
  impressora.demoraMs = 3000; // consulta enquanto o trabalho ainda está na fila
  const a = await aluno(10);
  const r = await imprimir(a.token, { copies: 3, pageRanges: '1-2' });
  const atributos = atributosDoTrabalho(r.data.jobId);
  await esperarFim(r.data.jobId);
  impressora.demoraMs = 0;
  assert.deepEqual(atributos, { copies: 3, pageRanges: '1-2' });
  assert.equal(saldo(a), 10 - 2 * 3 * 0.5);
});

test('fila: segundo documento enviado enquanto o primeiro imprime — os dois saem, na ordem, cobrados uma vez cada', async () => {
  impressora.demoraMs = 4000;
  const a = await aluno(10);
  const antes = impressora.recebidos.length;
  const r1 = await imprimir(a.token, { pageRanges: '1-2' });
  await sleep(1000);
  const r2 = await imprimir(a.token, { pageRanges: '1', color: 'color' });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  const [f1, f2] = await Promise.all([esperarFim(r1.data.jobId), esperarFim(r2.data.jobId)]);
  impressora.demoraMs = 0;
  assert.equal(f1.status, 'completed'); assert.equal(f2.status, 'completed');
  const novos = impressora.recebidos.slice(antes);
  assert.equal(novos.length, 2, 'dois trabalhos chegaram à impressora');
  assert.ok(novos[0].fim <= novos[1].inicio + 50, 'um de cada vez, na ordem');
  assert.equal(saldo(a), 10 - 1 - 0.75);
  assert.equal(json(a.u, 'historicoimpressao').length, 2);
});

test('fila: saldo só dá para um — o segundo documento é recusado antes de imprimir', async () => {
  impressora.demoraMs = 4000;
  const a = await aluno(0.75);
  const antes = impressora.recebidos.length;
  const r1 = await imprimir(a.token);
  await sleep(500);
  const r2 = await imprimir(a.token);
  await esperarFim(r1.data.jobId);
  if (r2.status === 200) await esperarFim(r2.data.jobId);
  impressora.demoraMs = 0;
  await sleep(500);
  assert.equal(r2.status, 402, `segundo pedido deveria ser recusado (veio ${r2.status})`);
  assert.equal(impressora.recebidos.length - antes, 1, 'só um trabalho impresso');
  assert.equal(saldo(a), 0.25);
});

test('clique duplo com saldo para um só: apenas um trabalho é aceito', async () => {
  impressora.demoraMs = 3000;
  const a = await aluno(0.5);
  const [r1, r2] = await Promise.all([imprimir(a.token), imprimir(a.token)]);
  const aceitos = [r1, r2].filter((r) => r.status === 200);
  assert.equal(aceitos.length, 1, `aceitos: ${aceitos.length}`);
  await esperarFim(aceitos[0].data.jobId);
  impressora.demoraMs = 0;
  assert.equal(saldo(a), 0);
});

test('sem saldo: nada vai para a impressora', async () => {
  const a = await aluno(0.2);
  const antes = impressora.recebidos.length;
  const r = await imprimir(a.token);
  assert.equal(r.status, 402);
  await sleep(1500);
  assert.equal(impressora.recebidos.length, antes);
});

test('trabalho cancelado na impressora não é cobrado', async () => {
  impressora.demoraMs = 6000;
  const a = await aluno(5);
  const r = await imprimir(a.token);
  await sleep(1000);
  execFileSync('cancel', [r.data.jobId]);
  const fim = await esperarFim(r.data.jobId);
  impressora.demoraMs = 0;
  assert.equal(fim.status, 'error');
  assert.match(fim.error, /Nenhum crédito foi debitado/);
  assert.equal(saldo(a), 5);
});

test('impressora desligada: trabalho espera, não cobra; ao religar imprime e cobra uma vez', async () => {
  await impressora.desligar();
  const a = await aluno(5);
  const r = await imprimir(a.token);
  assert.equal(r.status, 200);
  await sleep(8000);
  assert.equal((await k(`/api/print/status/${r.data.jobId}`)).data.status, 'printing');
  assert.equal(saldo(a), 5, 'nada cobrado enquanto desligada');
  await impressora.ligar();
  retomarFila();
  const fim = await esperarFim(r.data.jobId, 90_000);
  assert.equal(fim.status, 'completed');
  assert.equal(saldo(a), 4.5);
});

test('servidor principal fora do ar na hora do débito: kiosk tenta de novo e cobra uma vez', async () => {
  const a = await aluno(5);
  falhas.print = ['indisponivel', 'indisponivel'];
  const r = await imprimir(a.token);
  const fim = await esperarFim(r.data.jobId, 60_000);
  assert.equal(fim.status, 'completed');
  assert.equal(saldo(a), 4.5);
});

test('resposta do débito se perde na rede: nova tentativa não cobra duas vezes', async () => {
  const a = await aluno(5);
  falhas.print = ['perde-resposta'];
  const r = await imprimir(a.token);
  const fim = await esperarFim(r.data.jobId, 60_000);
  assert.equal(fim.status, 'completed');
  assert.equal(saldo(a), 4.5);
  assert.equal(json(a.u, 'historicoimpressao').length, 1);
});

test('URL de documento com comando de shell não executa nada no computador do kiosk', async () => {
  const a = await aluno(5);
  const marcador = path.join(os.tmpdir(), `pf-injecao-${process.pid}`);
  const r = await imprimir(a.token, { fileUrl: `${filesBase}/uploads/doc.$(touch${'${IFS}'}${marcador})` });
  await sleep(1000);
  assert.equal(fs.existsSync(marcador), false);
  assert.notEqual(r.status, 200);
});

test('sem login (token ausente ou inválido) o kiosk não imprime', async () => {
  const antes = impressora.recebidos.length;
  assert.equal((await imprimir(undefined)).status, 401);
  assert.equal((await imprimir('token-falso')).status, 401);
  await sleep(1000);
  assert.equal(impressora.recebidos.length, antes);
});

test('10 impressões seguidas do mesmo aluno: todas saem e a soma cobrada bate', async () => {
  const a = await aluno(20);
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push((await imprimir(a.token, { pageRanges: '1-2' })).data.jobId);
  const fins = await Promise.all(jobs.map((j) => esperarFim(j, 120_000)));
  assert.ok(fins.every((f) => f.status === 'completed'), JSON.stringify(fins.map((f) => f.status)));
  assert.equal(saldo(a), 20 - 10 * 2 * 0.5);
});

test('kiosk reinicia no meio de uma impressão: o trabalho ainda deveria ser cobrado', { todo: 'trabalhos em andamento ficam só na memória do kiosk' }, async () => {
  impressora.demoraMs = 5000;
  const a = await aluno(5);
  const r = await imprimir(a.token);
  await sleep(1000);
  await derrubarKiosk();
  await subirKiosk();
  await sleep(10_000);
  impressora.demoraMs = 0;
  assert.equal(saldo(a), 4.5, `saldo ficou R$${saldo(a)}: impressão saiu de graça`);
});
