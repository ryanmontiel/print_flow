// Acesso de desenvolvedor: isolamento das rotas, bloqueio por tentativas e
// exatidão das métricas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { default: bcrypt } = await import(pathToFileURL(path.join(ROOT, 'node_modules/bcryptjs/index.js')).href);

const DEV_EMAIL = 'dev@printflow.test';
const DEV_SENHA = 'Painel-Dev#2026!';
process.env.DEV_EMAIL = DEV_EMAIL;
process.env.DEV_PASSWORD_HASH = await bcrypt.hash(DEV_SENHA, 4);

const { addUser, api, login, db, APP_SECRET, close } = await import('../helpers/backend.mjs');
after(close);

const hmac = (d) => crypto.createHmac('sha256', APP_SECRET).update(d).digest('hex');
const sign = (data) => { const p = Buffer.from(JSON.stringify(data)).toString('base64url'); return `${p}.${hmac('session|' + p)}`; };
const devLogin = async () => (await api('/api/login', { body: { email: DEV_EMAIL, senha: DEV_SENHA } })).data;
const metrics = (token, q = '') => api(`/api/dev/metrics${q}`, { method: 'GET', token });

// ── Dados conhecidos para conferir as métricas ───────────────────────
const iso = (s) => new Date(s).toISOString();
const ULTIMO_LOGIN_ANA = iso('2026-10-20T09:00:00-03:00');
const ana = await addUser({
  email: 'ana@academico.ifsul.edu.br', nome: 'Ana', senha: 'Senha@123', creditos: '12.5',
  criadoem: iso('2026-10-02T13:00:00-03:00'), ultimologinem: ULTIMO_LOGIN_ANA,
  historicoimpressao: JSON.stringify([
    { pages: 10, cost: 5, color: 'bw', duplex: 'single', printedAt: iso('2026-10-10T08:15:00-03:00') },
    { pages: 4, cost: 2.4, color: 'color', duplex: 'duplex', printedAt: iso('2026-10-10T14:40:00-03:00') },
    // 23h30 em Brasília = 02h30 UTC do dia seguinte: tem de contar em 15/10
    { pages: 2, cost: 1, color: 'bw', duplex: 'single', printedAt: iso('2026-10-15T23:30:00-03:00') },
    { pages: 6, cost: 3, color: 'bw', duplex: 'single', printedAt: iso('2026-08-01T10:00:00-03:00') },
  ]),
  transacoes: JSON.stringify([
    { amount: 10, type: 'credit', order_nsu: 'pf-1', description: 'Créditos via InfinitePay (tx)', createdAt: iso('2026-10-09T10:00:00-03:00') },
    { amount: 20, type: 'credit', description: 'Créditos via InfinitePay (antigo)', createdAt: iso('2026-10-12T10:00:00-03:00') },
    { amount: 100, type: 'credit', description: 'Debug manual', createdAt: iso('2026-10-12T11:00:00-03:00') },
    { amount: -5, type: 'debit', description: 'Impressão', createdAt: iso('2026-10-10T08:15:00-03:00') },
  ]),
  pagamentospendentes: JSON.stringify({
    'pf-1': { amount: 10, status: 'completed', createdAt: iso('2026-10-09T09:58:00-03:00') },
    'pf-2': { amount: 50, status: 'pending', createdAt: iso('2026-10-11T09:00:00-03:00') },
  }),
  documentos: JSON.stringify([{ id: '1', size: 1000 }, { id: '2', size: 500, compartilhado_de_email: 'bia@academico.ifsul.edu.br' }]),
  notificacoes: JSON.stringify([{ tipo: 'share_request', status: 'accepted' }, { tipo: 'share_request', status: 'pending' }]),
});
await addUser({
  email: 'bia@academico.ifsul.edu.br', nome: 'Bia', senha: 'Senha@123', creditos: '0', verificado: 'false',
  criadoem: iso('2026-09-01T10:00:00-03:00'),
  historicoimpressao: JSON.stringify([{ pages: 3, cost: 2.25, color: 'color', duplex: 'single', printedAt: iso('2026-10-10T08:50:00-03:00') }]),
  transacoes: JSON.stringify([{ amount: 5, type: 'credit', order_nsu: 'pf-3', createdAt: iso('2026-10-10T08:00:00-03:00') }]),
});

// ── Isolamento ───────────────────────────────────────────────────────
test('login de dev devolve token com papel de desenvolvedor', async () => {
  const d = await devLogin();
  assert.equal(d.role, 'dev');
  assert.ok(d.token);
});

test('painel de métricas exige login (401) e recusa token de aluno (403)', async () => {
  assert.equal((await metrics()).status, 401);
  const aluno = await login('ana@academico.ifsul.edu.br', 'Senha@123');
  assert.equal((await metrics(aluno)).status, 403);
});

test('token de dev não abre nenhuma rota de aluno', async () => {
  const { token } = await devLogin();
  for (const [m, p] of [['POST', '/api/documents'], ['GET', '/api/credits'], ['POST', '/api/print'], ['GET', '/api/notifications'], ['POST', '/api/create-payment-link'], ['POST', '/api/users/search']]) {
    assert.equal((await api(p, { method: m, body: m === 'POST' ? {} : undefined, token })).status, 401, `${m} ${p}`);
  }
});

test('aluno não vira dev forjando o papel no token', async () => {
  const aluno = await login('ana@academico.ifsul.edu.br', 'Senha@123');
  const data = JSON.parse(Buffer.from(aluno.split('.')[0], 'base64url').toString());
  const forjado = `${Buffer.from(JSON.stringify({ ...data, r: 'dev' })).toString('base64url')}.${aluno.split('.')[1]}`;
  assert.equal((await metrics(forjado)).status, 401, 'assinatura não confere');
  // Mesmo bem assinado, sem a "impressão" da senha de dev não passa
  assert.equal((await metrics(sign({ e: DEV_EMAIL, r: 'dev', x: Date.now() + 60_000, p: 'x' }))).status, 403);
  assert.equal((await metrics(sign({ e: 'ana@academico.ifsul.edu.br', r: 'dev', x: Date.now() + 60_000 }))).status, 403);
});

test('token de dev expirado é recusado', async () => {
  const { token } = await devLogin();
  const data = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  assert.equal((await metrics(sign({ ...data, x: Date.now() - 1 }))).status, 401);
});

test('credencial de dev não funciona no kiosk', async () => {
  const r = await api('/api/login', { body: { email: DEV_EMAIL, senha: DEV_SENHA, client: 'kiosk' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.token, undefined);
});

test('senha de dev errada responde igual a uma conta inexistente', async () => {
  const dev = await api('/api/login', { body: { email: DEV_EMAIL, senha: 'Errada#123456' } });
  const nada = await api('/api/login', { body: { email: 'ninguem@academico.ifsul.edu.br', senha: 'Errada#123456' } });
  assert.deepEqual([dev.status, dev.data], [nada.status, nada.data]);
});

// ── Métricas ─────────────────────────────────────────────────────────
test('métricas de outubro batem com os dados (fuso de Brasília)', async () => {
  // Os testes anteriores fazem login com a Ana, o que grava a data de hoje em
  // ultimologinem; volta ao valor conhecido para o resultado não depender do dia
  db.get(ana.__id).ultimologinem = ULTIMO_LOGIN_ANA;
  const { token } = await devLogin();
  const r = await metrics(token, '?from=2026-10-01&to=2026-10-31&fresh=1');
  assert.equal(r.status, 200);
  const m = r.data;
  assert.deepEqual(m.periodo, { from: '2026-10-01', to: '2026-10-31', dias: 31, granularidade: 'dia' });
  assert.equal(m.impressoes.trabalhos, 4);
  assert.equal(m.impressoes.paginas, 19);
  assert.equal(m.impressoes.receita, 10.65);
  assert.equal(m.impressoes.alunos, 2);
  assert.deepEqual(m.impressoes.porTipo.map((t) => [t.tipo, t.trabalhos, t.paginas, t.receita]), [
    ['bw_single', 2, 12, 6], ['bw_duplex', 0, 0, 0], ['color_single', 1, 3, 2.25], ['color_duplex', 1, 4, 2.4],
  ]);
  assert.equal(m.impressoes.porHora[8], 2);
  assert.equal(m.impressoes.porHora[23], 1, 'impressão das 23h30 no horário de Brasília');
  assert.equal(m.creditos.compras, 3);
  assert.equal(m.creditos.valor, 35);
  assert.equal(m.creditos.compradores, 2);
  assert.deepEqual(m.creditos.manuais, { lancamentos: 1, valor: 100 });
  assert.deepEqual(m.creditos.porValor, [{ valor: 5, compras: 1 }, { valor: 10, compras: 1 }, { valor: 20, compras: 1 }]);
  assert.deepEqual({ ...m.pagamentos }, { linksGerados: 2, pagos: 1, pendentes: 1, valorPendente: 50, conversao: 0.5 });
  assert.deepEqual(m.alunos, { total: 2, verificados: 1, novos: 1, ativos: 1, imprimiram: 2, compraram: 2 });
  assert.equal(m.situacao.saldoEmContas, 12.5);
  assert.equal(m.situacao.armazenamentoBytes, 1000);
  assert.deepEqual(m.situacao.compartilhamentos, { pendentes: 1, aceitos: 1, recusados: 0 });
  const dia15 = m.serie.find((s) => s.periodo === '2026-10-15');
  assert.deepEqual([dia15.trabalhos, dia15.receitaImpressoes], [1, 1]);
  const dia10 = m.serie.find((s) => s.periodo === '2026-10-10');
  assert.deepEqual([dia10.trabalhos, dia10.paginas, dia10.receitaImpressoes, dia10.creditosComprados], [3, 17, 9.65, 5]);
  assert.equal(m.serie.length, 31, 'um ponto por dia, inclusive os sem movimento');
});

test('filtro por um dia específico', async () => {
  const { token } = await devLogin();
  const m = (await metrics(token, '?from=2026-10-15&to=2026-10-15')).data;
  assert.equal(m.impressoes.trabalhos, 1);
  assert.equal(m.creditos.compras, 0);
});

test('período "tudo" começa no primeiro registro e agrupa por mês quando longo', async () => {
  const { token } = await devLogin();
  const m = (await metrics(token, '?from=all&to=2026-12-31')).data;
  assert.equal(m.periodo.from, '2026-08-01');
  assert.equal(m.periodo.granularidade, 'mes');
  assert.equal(m.impressoes.trabalhos, 5);
  assert.deepEqual(m.serie.map((s) => s.periodo), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
});

test('datas inválidas: início depois do fim é recusado', async () => {
  const { token } = await devLogin();
  assert.equal((await metrics(token, '?from=2026-10-20&to=2026-10-01')).status, 400);
});

test('métricas não expõem email, nome nem hash de nenhum aluno', async () => {
  const { token } = await devLogin();
  const texto = JSON.stringify((await metrics(token, '?from=all')).data);
  assert.ok(!/@|Ana|Bia|\$2[aby]\$/.test(texto), texto.slice(0, 200));
});

// ── Ajuste de créditos ───────────────────────────────────────────────
let req = 0;
const ajustar = async (token, body) => api('/api/dev/credits/adjust', { token, body: { requestId: `teste-ajuste-${++req}-${Date.now()}`, ...body } });

test('dev busca aluno por nome ou email e vê o saldo', async () => {
  const { token } = await devLogin();
  const r = await api('/api/dev/users/search', { token, body: { q: 'ana' } });
  assert.deepEqual(r.data.users, [{ email: 'ana@academico.ifsul.edu.br', nome: 'Ana', creditos: 12.5, verificado: true }]);
});

test('adicionar créditos: saldo muda e o aluno vê no extrato quem, quando e por quê', async () => {
  const { token } = await devLogin();
  const antes = Date.now();
  const r = await ajustar(token, { email: 'ana@academico.ifsul.edu.br', operacao: 'adicionar', valor: 10, motivo: 'Reembolso de impressão falha' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.saldoAnterior, r.data.saldoNovo], [12.5, 22.5]);
  const aluno = await login('ana@academico.ifsul.edu.br', 'Senha@123');
  const extrato = (await api('/api/credits', { method: 'GET', token: aluno })).data;
  assert.equal(extrato.credits, 22.5);
  const t = extrato.transactions.at(-1);
  assert.equal(t.description, 'Ajuste feito pela equipe PrintFlow');
  assert.equal(t.motivo, 'Reembolso de impressão falha');
  assert.equal(t.type, 'credit');
  assert.equal(t.amount, 10);
  assert.equal(t.origem, 'equipe');
  assert.ok(Date.parse(t.createdAt) >= antes - 1000, 'data e hora do ajuste');
  assert.deepEqual({ ...t.ajuste, em: undefined }, { operacao: 'adicionar', saldoAnterior: 12.5, saldoNovo: 22.5, por: DEV_EMAIL, em: undefined });
});

test('remover créditos aparece como débito; não deixa o saldo negativo', async () => {
  const { token } = await devLogin();
  const demais = await ajustar(token, { email: 'ana@academico.ifsul.edu.br', operacao: 'remover', valor: 100, motivo: 'Teste de remoção' });
  assert.equal(demais.status, 400);
  const r = await ajustar(token, { email: 'ana@academico.ifsul.edu.br', operacao: 'remover', valor: 2.5, motivo: 'Crédito lançado em dobro' });
  assert.deepEqual([r.status, r.data.saldoNovo, r.data.transacao.type, r.data.transacao.amount], [200, 20, 'debit', -2.5]);
});

test('definir saldo grava a diferença como transação', async () => {
  const { token } = await devLogin();
  const r = await ajustar(token, { email: 'ana@academico.ifsul.edu.br', operacao: 'definir', valor: 15, motivo: 'Correção após conferência do caixa' });
  assert.deepEqual([r.data.saldoAnterior, r.data.saldoNovo, r.data.transacao.amount], [20, 15, -5]);
  assert.equal((await ajustar(token, { email: 'ana@academico.ifsul.edu.br', operacao: 'definir', valor: 15, motivo: 'Mesmo valor de novo' })).status, 400);
});

test('ajuste exige motivo, valor válido e aluno existente', async () => {
  const { token } = await devLogin();
  const base = { email: 'ana@academico.ifsul.edu.br', operacao: 'adicionar', valor: 5, motivo: 'Motivo válido' };
  assert.equal((await ajustar(token, { ...base, motivo: '' })).status, 400, 'sem motivo');
  assert.equal((await ajustar(token, { ...base, valor: 1001 })).status, 400, 'acima do limite');
  assert.equal((await ajustar(token, { ...base, valor: -5 })).status, 400, 'negativo');
  assert.equal((await ajustar(token, { ...base, valor: 'abc' })).status, 400, 'não numérico');
  assert.equal((await ajustar(token, { ...base, operacao: 'zerar' })).status, 400, 'operação inválida');
  assert.equal((await ajustar(token, { ...base, email: 'ninguem@academico.ifsul.edu.br' })).status, 404);
});

test('clique repetido (mesmo pedido) ajusta uma vez só', async () => {
  const { token } = await devLogin();
  const body = { requestId: 'pedido-duplicado-123', email: 'bia@academico.ifsul.edu.br', operacao: 'adicionar', valor: 3, motivo: 'Bônus de boas-vindas' };
  const [a, b] = [await api('/api/dev/credits/adjust', { token, body }), await api('/api/dev/credits/adjust', { token, body })];
  assert.equal(a.data.saldoNovo, 3);
  assert.equal(b.data.message, 'Ajuste já registrado');
  const busca = await api('/api/dev/users/search', { token, body: { q: 'bia' } });
  assert.equal(busca.data.users[0].creditos, 3, 'saldo subiu só uma vez');
});

test('aluno não acessa busca, ajuste nem histórico de ajustes', async () => {
  const aluno = await login('ana@academico.ifsul.edu.br', 'Senha@123');
  assert.equal((await api('/api/dev/users/search', { token: aluno, body: { q: 'ana' } })).status, 403);
  assert.equal((await api('/api/dev/credits/adjust', { token: aluno, body: { requestId: 'x'.repeat(10), email: 'ana@academico.ifsul.edu.br', operacao: 'adicionar', valor: 100, motivo: 'Tentativa do aluno' } })).status, 403);
  assert.equal((await api('/api/dev/adjustments', { method: 'GET', token: aluno })).status, 403);
});

test('histórico de ajustes lista tudo, do mais recente ao mais antigo, com aluno, valores e motivo', async () => {
  const { token } = await devLogin();
  const { ajustes } = (await api('/api/dev/adjustments', { method: 'GET', token })).data;
  // Os pedidos recusados (sem motivo, acima do limite etc.) não entram
  assert.deepEqual(ajustes.map((a) => [a.aluno.nome, a.operacao, a.valor, a.saldoAnterior, a.saldoNovo]), [
    ['Bia', 'adicionar', 3, 0, 3],
    ['Ana', 'definir', -5, 20, 15],
    ['Ana', 'remover', -2.5, 22.5, 20],
    ['Ana', 'adicionar', 10, 12.5, 22.5],
  ]);
  assert.ok(ajustes.every((a) => a.por === DEV_EMAIL && a.motivo && a.em));
});

test('métricas contam ajustes à parte, fora das compras por Pix', async () => {
  const { token } = await devLogin();
  const m = (await metrics(token, '?from=all&fresh=1')).data;
  assert.equal(m.creditos.valor, 35, 'compras Pix inalteradas');
  assert.equal(m.creditos.manuais.lancamentos, 1, 'só o lançamento legado');
  assert.deepEqual(m.ajustes, { lancamentos: 4, adicionado: 13, removido: 7.5 });
});

// Por último: depois disso o IP de teste fica bloqueado para o login de dev
test('login de dev bloqueia após 5 senhas erradas (mesmo com a senha certa depois)', async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await api('/api/login', { body: { email: DEV_EMAIL, senha: `Errada#${i}xxxxxxx` } })).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
  const r = await api('/api/login', { body: { email: DEV_EMAIL, senha: DEV_SENHA } });
  assert.equal(r.status, 429);
});
