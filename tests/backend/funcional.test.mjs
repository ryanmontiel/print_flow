// Bateria 1: testes funcionais do backend (regras de negócio).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, api, login, db, json, user, paid, r2Objects, sentEmails, close } from '../helpers/backend.mjs';

after(close);

let n = 0;
const email = () => `aluno${++n}@academico.ifsul.edu.br`;
const novoAluno = async (extra = {}) => {
  const u = await addUser({ email: email(), nome: `Aluno ${n}`, senha: 'Senha@123', ...extra });
  return { u, token: await login(u.email, 'Senha@123') };
};

// ── Cadastro e verificação ───────────────────────────────────────────
test('cadastro aceita só email institucional', async () => {
  const r = await api('/api/register', { body: { email: 'x@gmail.com', nome: 'X', senha: 'Senha@123' } });
  assert.equal(r.status, 400);
});

test('cadastro exige senha forte', async () => {
  const r = await api('/api/register', { body: { email: email(), nome: 'X', senha: 'fraca' } });
  assert.equal(r.status, 400);
});

test('cadastro envia código de 6 dígitos e a verificação libera o login', async () => {
  const e = email();
  const r = await api('/api/register', { body: { email: e, nome: 'Novo', senha: 'Senha@123' } });
  assert.equal(r.status, 201);
  const code = /(\d{6})/.exec(sentEmails.at(-1).text)[1];
  assert.equal((await api('/api/login', { body: { email: e, senha: 'Senha@123' } })).status, 403, 'login antes de verificar');
  assert.equal((await api('/api/verify-email', { body: { email: e, codigo: '000000' === code ? '111111' : '000000' } })).status, 400, 'código errado');
  assert.equal((await api('/api/verify-email', { body: { email: e, codigo: code } })).status, 200);
  assert.equal((await api('/api/login', { body: { email: e, senha: 'Senha@123' } })).status, 200);
});

test('email já cadastrado é recusado', async () => {
  const { u } = await novoAluno();
  const r = await api('/api/register', { body: { email: u.email, nome: 'Outro', senha: 'Senha@123' } });
  assert.equal(r.status, 409);
});

// ── Preço e débito ───────────────────────────────────────────────────
test('tabela de preços: P&B R$0,50/0,35 e colorido R$0,75/0,60 por página', async () => {
  const { token } = await novoAluno({ creditos: '100' });
  const q = async (color, duplex, pages) => (await api('/api/print/quote', { body: { pages, color, duplex }, token })).data.cost;
  assert.equal(await q('bw', 'single', 10), 5);
  assert.equal(await q('bw', 'duplex', 10), 3.5);
  assert.equal(await q('color', 'single', 10), 7.5);
  assert.equal(await q('color', 'duplex', 10), 6);
});

test('valor enviado pelo cliente é ignorado: o servidor calcula', async () => {
  const { u, token } = await novoAluno({ creditos: '10' });
  const r = await api('/api/print', { body: { documentId: 'd', pages: 10, color: 'bw', duplex: 'single', cost: 0.01 }, token });
  assert.equal(r.status, 200);
  assert.equal(Number(user(u).creditos), 5);
});

test('débito registra histórico e extrato', async () => {
  const { u, token } = await novoAluno({ creditos: '10' });
  await api('/api/print', { body: { documentId: 'd', documentName: 'Trabalho', pages: 2, color: 'color', duplex: 'single' }, token });
  assert.equal(json(u, 'historicoimpressao').length, 1);
  assert.equal(json(u, 'transacoes').at(-1).amount, -1.5);
});

test('sem saldo: impressão recusada (HTTP 402) e saldo não fica negativo', async () => {
  const { u, token } = await novoAluno({ creditos: '1' });
  const r = await api('/api/print', { body: { documentId: 'd', pages: 3, color: 'bw', duplex: 'single' }, token });
  assert.equal(r.status, 402);
  assert.equal(Number(user(u).creditos), 1);
});

test('frente e verso exige pelo menos 2 páginas', async () => {
  const { token } = await novoAluno({ creditos: '10' });
  const r = await api('/api/print', { body: { documentId: 'd', pages: 1, color: 'bw', duplex: 'duplex' }, token });
  assert.equal(r.status, 400);
});

test('número de páginas inválido é recusado (0, fração, negativo)', async () => {
  const { token } = await novoAluno({ creditos: '10' });
  for (const pages of [0, 1.5, -3, 'abc']) {
    assert.equal((await api('/api/print', { body: { documentId: 'd', pages }, token })).status, 400, `pages=${pages}`);
  }
});

test('reenvio do mesmo débito (clientRef) não cobra duas vezes', async () => {
  const { u, token } = await novoAluno({ creditos: '10' });
  const body = { documentId: 'd', pages: 2, color: 'bw', duplex: 'single', clientRef: 'kiosk-1' };
  await api('/api/print', { body, token });
  await api('/api/print', { body, token });
  assert.equal(Number(user(u).creditos), 9);
});

// ── Pagamentos ───────────────────────────────────────────────────────
test('Pix: crédito só depois que a InfinitePay confirma, e uma única vez', async () => {
  const { u, token } = await novoAluno();
  const link = await api('/api/create-payment-link', { body: { amount: 10 }, token });
  const order = link.data.order_nsu;
  await api('/api/webhook-infinitepay', { body: { order_nsu: order } });
  assert.equal(Number(user(u).creditos), 0, 'webhook de pagamento não confirmado');
  paid.add(order);
  await api('/api/webhook-infinitepay', { body: { order_nsu: order } });
  await api('/api/check-payment', { body: { order_nsu: order }, token });
  await api('/api/reprocess-payment', { body: { order_nsu: order }, token });
  assert.equal(Number(user(u).creditos), 10);
  assert.equal(json(u, 'transacoes').length, 1);
});

test('Pix: valores fora do intervalo R$1–500 são recusados', async () => {
  const { token } = await novoAluno();
  for (const amount of [0, -5, 0.5, 501, 'abc']) {
    assert.equal((await api('/api/create-payment-link', { body: { amount }, token })).status, 400, `amount=${amount}`);
  }
});

// ── Documentos ───────────────────────────────────────────────────────
// declaredSize: tamanho informado no pedido de upload; realSize: tamanho que chega ao R2
const upload = async (token, realSize, name = 'doc.pdf', declaredSize = realSize) => {
  const p = await api('/api/upload/presign', { body: { filename: name, contentType: 'application/pdf', size: declaredSize }, token });
  if (p.status !== 200) return p;
  r2Objects.set(p.data.key, realSize);
  return api('/api/add-document', { body: { documentName: name, originalname: name, url: p.data.url }, token });
};

test('upload: registra documento com o tamanho real do arquivo', async () => {
  const { u, token } = await novoAluno();
  const r = await upload(token, 2048);
  assert.equal(r.status, 200);
  assert.equal(json(u, 'documentos')[0].size, 2048);
});

test('upload: tipo de arquivo não permitido é recusado', async () => {
  const { token } = await novoAluno();
  const r = await api('/api/upload/presign', { body: { filename: 'a.exe', contentType: 'application/x-msdownload', size: 10 }, token });
  assert.equal(r.status, 400);
});

test('upload: arquivo acima de 10 MB é recusado já no pedido', async () => {
  const { token } = await novoAluno();
  assert.equal((await upload(token, 11 * 1024 * 1024)).status, 413);
});

test('upload: quem mente o tamanho e envia arquivo maior tem o arquivo recusado e apagado', async () => {
  const { u, token } = await novoAluno();
  const before = r2Objects.size;
  assert.equal((await upload(token, 11 * 1024 * 1024, 'grande.pdf', 1000)).status, 413);
  assert.equal(r2Objects.size, before, 'arquivo removido do armazenamento');
  assert.equal(json(u, 'documentos').length, 0);
});

test('upload: cota de 50 MB por aluno', async () => {
  const { token } = await novoAluno();
  for (let i = 0; i < 5; i++) assert.equal((await upload(token, 10 * 1024 * 1024, `f${i}.pdf`)).status, 200);
  assert.equal((await upload(token, 1024, 'extra.pdf')).status, 413);
});

test('excluir documento próprio apaga o arquivo do armazenamento', async () => {
  const { u, token } = await novoAluno();
  await upload(token, 100);
  const doc = json(u, 'documentos')[0];
  const key = new URL(doc.url).pathname.slice(1);
  assert.equal((await api('/api/delete-document', { body: { documentId: doc.id }, token })).status, 200);
  assert.equal(r2Objects.has(key), false);
});

// ── Compartilhamento ─────────────────────────────────────────────────
test('compartilhar: destinatário recebe o documento e uma notificação pendente', async () => {
  const a = await novoAluno(), b = await novoAluno();
  await upload(a.token, 100);
  const doc = json(a.u, 'documentos')[0];
  const r = await api('/api/share-document', { body: { targetEmail: b.u.email, documentId: doc.id, message: 'oi' }, token: a.token });
  assert.equal(r.status, 200);
  const recebido = json(b.u, 'documentos')[0];
  assert.equal(recebido.compartilhado_de_email, a.u.email);
  assert.equal(recebido.url, doc.url, 'aponta para o mesmo arquivo');
  assert.equal(json(b.u, 'notificacoes')[0].status, 'pending');
});

test('compartilhar: recusar remove o documento do destinatário', async () => {
  const a = await novoAluno(), b = await novoAluno();
  await upload(a.token, 100);
  await api('/api/share-document', { body: { targetEmail: b.u.email, documentId: json(a.u, 'documentos')[0].id }, token: a.token });
  const notif = json(b.u, 'notificacoes')[0];
  await api('/api/handle-share', { body: { notificationId: notif.id, action: 'rejected' }, token: b.token });
  assert.equal(json(b.u, 'documentos').length, 0);
});

test('compartilhar: documento recebido não conta na cota e excluir não apaga o original', async () => {
  const a = await novoAluno(), b = await novoAluno();
  await upload(a.token, 5000);
  const original = json(a.u, 'documentos')[0];
  await api('/api/share-document', { body: { targetEmail: b.u.email, documentId: original.id }, token: a.token });
  const docs = await api('/api/documents', { body: {}, token: b.token });
  assert.equal(docs.data.usedBytes, 0);
  await api('/api/delete-document', { body: { documentId: json(b.u, 'documentos')[0].id }, token: b.token });
  assert.equal(r2Objects.has(new URL(original.url).pathname.slice(1)), true);
});

test('busca de usuários para compartilhar: só verificados, mínimo 3 letras, sem o próprio', async () => {
  const a = await novoAluno();
  await addUser({ email: 'zeca.verificado@academico.ifsul.edu.br', nome: 'Zeca', senha: 'Senha@123' });
  await addUser({ email: 'zeca.pendente@academico.ifsul.edu.br', nome: 'Zeca P', senha: 'Senha@123', verificado: 'false' });
  assert.equal((await api('/api/users/search', { body: { q: 'ze' }, token: a.token })).data.users.length, 0);
  const r = await api('/api/users/search', { body: { q: 'zeca' }, token: a.token });
  assert.deepEqual(r.data.users.map((x) => x.nome), ['Zeca']);
});

// ── Preferências e recuperação de senha ─────────────────────────────
test('preferências de impressão são salvas e devolvidas no login', async () => {
  const { u, token } = await novoAluno();
  await api('/api/user/print-preferences', { body: { printColor: 'color', printDuplex: 'duplex' }, token });
  const r = await api('/api/login', { body: { email: u.email, senha: 'Senha@123' } });
  assert.equal(r.data.printColor, 'color');
  assert.equal(r.data.printDuplex, 'duplex');
});

test('recuperação de senha: link funciona uma vez e derruba sessões antigas', async () => {
  const { u, token } = await novoAluno();
  await api('/api/forgot-password', { body: { email: u.email } });
  const code = decodeURIComponent(/code=([^"&\s]+)/.exec(sentEmails.at(-1).text)[1]);
  assert.equal((await api('/api/reset-password', { body: { code, senha: 'Nova@1234' } })).status, 200);
  assert.equal((await api('/api/reset-password', { body: { code, senha: 'Outra@1234' } })).status, 400, 'reuso');
  assert.equal((await api('/api/credits', { method: 'GET', token })).status, 401, 'sessão antiga');
  assert.equal((await api('/api/login', { body: { email: u.email, senha: 'Nova@1234' } })).status, 200);
});
