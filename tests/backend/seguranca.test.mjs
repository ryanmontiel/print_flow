// Bateria 2: testes de segurança do backend.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { addUser, api, login, db, json, user, r2Objects, base, realFetch, APP_SECRET, close } from '../helpers/backend.mjs';

after(close);

const hmac = (d) => crypto.createHmac('sha256', APP_SECRET).update(d).digest('hex');
let n = 0;
const novoAluno = async (extra = {}) => {
  const u = await addUser({ email: `seg${++n}@academico.ifsul.edu.br`, nome: `Seg ${n}`, senha: 'Senha@123', ...extra });
  return { u, token: await login(u.email, 'Senha@123') };
};

// Todas as rotas que exigem login
const PROTEGIDAS = [
  ['POST', '/api/users/search'], ['POST', '/api/documents'], ['POST', '/api/upload/presign'],
  ['POST', '/api/add-document'], ['POST', '/api/delete-document'], ['GET', '/api/credits'],
  ['POST', '/api/user/print-preferences'], ['GET', '/api/user/print-preferences'],
  ['POST', '/api/print/quote'], ['POST', '/api/print'], ['GET', '/api/print-history'],
  ['POST', '/api/share-document'], ['POST', '/api/handle-share'], ['GET', '/api/notifications'],
  ['POST', '/api/create-payment-link'], ['POST', '/api/check-payment'], ['POST', '/api/reprocess-payment'],
];

test(`as ${PROTEGIDAS.length} rotas protegidas recusam acesso sem token (401)`, async () => {
  for (const [method, path] of PROTEGIDAS) {
    const r = await api(path, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('rotas protegidas recusam token adulterado, expirado ou de outro sistema', async () => {
  const { token } = await novoAluno();
  const [payload, sig] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const trocaEmail = Buffer.from(JSON.stringify({ ...data, e: 'vitima@academico.ifsul.edu.br' })).toString('base64url');
  const expirado = Buffer.from(JSON.stringify({ ...data, x: Date.now() - 1 })).toString('base64url');
  const falsos = [
    `${trocaEmail}.${sig}`,                                 // troca o email mantendo a assinatura
    `${expirado}.${hmac('session|' + expirado)}`,           // expirado (mesmo bem assinado)
    `${payload}.${crypto.createHmac('sha256', 'outro-segredo').update('session|' + payload).digest('hex')}`,
    'abc', '', `${payload}.`,
  ];
  for (const t of falsos) {
    for (const [method, path] of PROTEGIDAS) {
      const r = await api(path, { method, body: method === 'POST' ? {} : undefined, headers: { Authorization: `Bearer ${t}` } });
      assert.equal(r.status, 401, `${method} ${path} com token ${t.slice(0, 12)}…`);
    }
  }
});

test('clientes antigos (senha no corpo ou na URL) não autenticam mais', async () => {
  const { u } = await novoAluno();
  assert.equal((await api('/api/documents', { body: { email: u.email, senha: 'Senha@123' } })).status, 401);
  assert.equal((await api(`/api/credits?email=${u.email}&senha=Senha@123`, { method: 'GET' })).status, 401);
});

test('rotas que davam créditos grátis ou listavam alunos não existem mais (404)', async () => {
  const { token } = await novoAluno();
  for (const [m, p] of [['POST', '/api/credits/add'], ['POST', '/api/debug/add-credits'], ['POST', '/api/debug/user'], ['GET', '/api/users'], ['POST', '/api/upload']]) {
    assert.equal((await api(p, { method: m, body: m === 'POST' ? { amount: 1000 } : undefined, token })).status, 404, p);
  }
});

test('login com o hash armazenado no lugar da senha é recusado', async () => {
  const { u } = await novoAluno();
  assert.equal((await api('/api/login', { body: { email: u.email, senha: user(u).senhahash } })).status, 401);
});

test('nenhuma resposta da API expõe hash de senha ou código de verificação', async () => {
  const { u, token } = await novoAluno({ codigoverificacao: '123456' });
  const respostas = [await api('/api/login', { body: { email: u.email, senha: 'Senha@123' } })];
  for (const [method, path] of PROTEGIDAS) respostas.push(await api(path, { method, body: method === 'POST' ? {} : undefined, token }));
  const texto = JSON.stringify(respostas);
  assert.ok(!texto.includes(user(u).senhahash), 'hash da senha');
  assert.ok(!/senhahash|codigoverificacao/.test(texto), 'campos internos');
});

test('não dá para descobrir quem é cadastrado (login e recuperação respondem igual)', async () => {
  const { u } = await novoAluno();
  const existe = await api('/api/login', { body: { email: u.email, senha: 'Errada@123' } });
  const naoExiste = await api('/api/login', { body: { email: 'ninguem@academico.ifsul.edu.br', senha: 'Errada@123' } });
  assert.deepEqual([existe.status, existe.data], [naoExiste.status, naoExiste.data]);
  const f1 = await api('/api/forgot-password', { body: { email: u.email } });
  const f2 = await api('/api/forgot-password', { body: { email: 'ninguem@academico.ifsul.edu.br' } });
  assert.deepEqual([f1.status, f1.data], [f2.status, f2.data]);
});

test('URL de documento com comando de shell ou de outro domínio é recusada', async () => {
  const { token } = await novoAluno();
  for (const url of ['https://pub-test.r2.dev/uploads/doc.$(reboot)', 'https://evil.com/uploads/1-a.pdf', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.equal((await api('/api/add-document', { body: { documentName: 'x', url }, token })).status, 400, url);
  }
});

test('aluno não consegue registrar nem apagar arquivo de outro aluno', async () => {
  const a = await novoAluno(), b = await novoAluno();
  const p = await api('/api/upload/presign', { body: { filename: 'a.pdf', contentType: 'application/pdf', size: 10 }, token: a.token });
  r2Objects.set(p.data.key, 10);
  assert.equal((await api('/api/add-document', { body: { documentName: 'roubo', url: p.data.url }, token: b.token })).status, 400);
  db.get(b.u.__id).documentos = JSON.stringify([{ id: 'x', url: `https://evil.com/${p.data.key}` }]);
  await api('/api/delete-document', { body: { documentId: 'x' }, token: b.token });
  assert.ok(r2Objects.has(p.data.key), 'arquivo de A continua lá');
});

test('aluno não consegue agir sobre notificação de outro aluno', async () => {
  const a = await novoAluno(), b = await novoAluno();
  db.get(a.u.__id).notificacoes = JSON.stringify([{ id: 'n1', status: 'pending' }]);
  const r = await api('/api/handle-share', { body: { notificationId: 'n1', action: 'accepted' }, token: b.token });
  assert.equal(r.status, 404);
  assert.equal(json(a.u, 'notificacoes')[0].status, 'pending');
});

test('webhook de pagamento falso não gera crédito', async () => {
  const { u, token } = await novoAluno();
  const { data } = await api('/api/create-payment-link', { body: { amount: 50 }, token });
  for (let i = 0; i < 5; i++) await api('/api/webhook-infinitepay', { body: { order_nsu: data.order_nsu, transaction_nsu: 'falso' } });
  assert.equal(Number(user(u).creditos), 0);
});

test('requisições malformadas são recusadas sem derrubar o servidor', async () => {
  const bad = await realFetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
  assert.equal(bad.status, 400);
  const huge = await realFetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(200_000) }) });
  assert.equal(huge.status, 413);
  assert.equal((await api('/api/health', { method: 'GET' })).status, 200, 'servidor continua no ar');
});

test('rota inexistente responde 404 rápido (não fica pendurada)', async () => {
  const t = performance.now();
  assert.equal((await api('/api/nao-existe', { method: 'GET' })).status, 404);
  assert.ok(performance.now() - t < 1000);
});

// ── Pendências conhecidas (aparecem como TODO no relatório) ──────────
test('força bruta no login: bloquear após várias senhas erradas', { todo: 'não há limite de tentativas de login' }, async () => {
  const { u } = await novoAluno();
  const statuses = [];
  for (let i = 0; i < 30; i++) statuses.push((await api('/api/login', { body: { email: u.email, senha: `Errada@${i}` } })).status);
  assert.ok(statuses.includes(429), `30 tentativas erradas, todas processadas: ${[...new Set(statuses)]}`);
});

test('força bruta no código de verificação: bloquear após várias tentativas', { todo: 'não há limite de tentativas no código de 6 dígitos' }, async () => {
  const e = `brute${++n}@academico.ifsul.edu.br`;
  await addUser({ email: e, senha: 'Senha@123', verificado: 'false', codigoverificacao: '999999', codigoexpiraem: new Date(Date.now() + 6e5).toISOString() });
  const statuses = [];
  for (let i = 0; i < 30; i++) statuses.push((await api('/api/verify-email', { body: { email: e, codigo: String(100000 + i) } })).status);
  assert.ok(statuses.includes(429), `30 códigos errados, todos processados: ${[...new Set(statuses)]}`);
});
