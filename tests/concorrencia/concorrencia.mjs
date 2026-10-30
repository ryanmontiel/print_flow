// Bateria 3: concorrência. Duas ou mais operações simultâneas sobre o mesmo aluno,
// com o Sheetlabs simulado na latência medida. Cada cenário roda N vezes e conta
// quantas rodadas terminaram com dados errados.
//
// Uso: node tests/concorrencia/concorrencia.mjs [rodadas]
process.env.PF_SHEET_LATENCY = process.env.PF_SHEET_LATENCY || 'real';
const { addUser, api, login, json, user, paid, r2Objects, close } = await import('../helpers/backend.mjs');

const RODADAS = Number(process.argv[2] || 20);
let n = 0;
const aluno = async (extra = {}) => {
  const u = await addUser({ email: `conc${++n}@academico.ifsul.edu.br`, nome: `C${n}`, senha: 'Senha@123', ...extra });
  return { u, token: await login(u.email, 'Senha@123') };
};
const presign = async (token, name) => {
  const p = await api('/api/upload/presign', { body: { filename: name, contentType: 'application/pdf', size: 100 }, token });
  r2Objects.set(p.data.key, 100);
  return p.data.url;
};

const cenarios = [
  {
    nome: 'Mesmo aluno envia 2 documentos ao mesmo tempo (duas abas)',
    async rodada() {
      const a = await aluno();
      const [u1, u2] = [await presign(a.token, '1.pdf'), await presign(a.token, '2.pdf')];
      await Promise.all([u1, u2].map((url, i) => api('/api/add-document', { body: { documentName: `d${i}`, url }, token: a.token })));
      const docs = json(a.u, 'documentos').length;
      return { ok: docs === 2, detalhe: `${docs} de 2 documentos salvos` };
    },
  },
  {
    nome: '5 colegas compartilham com o mesmo aluno ao mesmo tempo',
    async rodada() {
      const alvo = await aluno();
      const remetentes = await Promise.all(Array.from({ length: 5 }, () => aluno()));
      for (const r of remetentes) {
        const url = await presign(r.token, 'x.pdf');
        await api('/api/add-document', { body: { documentName: 'x', url }, token: r.token });
      }
      await Promise.all(remetentes.map((r) => api('/api/share-document', { body: { targetEmail: alvo.u.email, documentId: json(r.u, 'documentos')[0].id }, token: r.token })));
      const docs = json(alvo.u, 'documentos').length, notifs = json(alvo.u, 'notificacoes').length;
      return { ok: docs === 5 && notifs === 5, detalhe: `${docs}/5 documentos, ${notifs}/5 notificações` };
    },
  },
  {
    nome: 'Pix confirmado: webhook e tela de créditos chegam juntos',
    async rodada() {
      const a = await aluno();
      const { data } = await api('/api/create-payment-link', { body: { amount: 10 }, token: a.token });
      paid.add(data.order_nsu);
      await Promise.all([
        api('/api/webhook-infinitepay', { body: { order_nsu: data.order_nsu } }),
        api('/api/check-payment', { body: { order_nsu: data.order_nsu }, token: a.token }),
      ]);
      const saldo = Number(user(a.u).creditos);
      return { ok: saldo === 10, detalhe: `saldo R$${saldo} (esperado R$10)` };
    },
  },
  {
    nome: 'Débito de impressão e crédito de Pix no mesmo instante',
    async rodada() {
      const a = await aluno({ creditos: '5' });
      const { data } = await api('/api/create-payment-link', { body: { amount: 10 }, token: a.token });
      paid.add(data.order_nsu);
      await Promise.all([
        api('/api/print', { body: { documentId: 'd', pages: 2, color: 'bw', duplex: 'single' }, token: a.token }),
        api('/api/webhook-infinitepay', { body: { order_nsu: data.order_nsu } }),
      ]);
      const saldo = Number(user(a.u).creditos);
      return { ok: saldo === 14, detalhe: `saldo R$${saldo} (esperado R$5 - 1 + 10 = R$14)` };
    },
  },
  {
    nome: 'Kiosk reenvia o mesmo débito enquanto o primeiro ainda está em andamento',
    async rodada() {
      const a = await aluno({ creditos: '10' });
      const body = { documentId: 'd', pages: 2, color: 'bw', duplex: 'single', clientRef: `ref-${n}` };
      await Promise.all([api('/api/print', { body, token: a.token }), api('/api/print', { body, token: a.token })]);
      const saldo = Number(user(a.u).creditos);
      return { ok: saldo === 9, detalhe: `saldo R$${saldo} (esperado R$9)` };
    },
  },
];

const resultados = [];
for (const c of cenarios) {
  let falhas = 0;
  const exemplos = new Set();
  for (let i = 0; i < RODADAS; i++) {
    const r = await c.rodada();
    if (!r.ok) { falhas++; exemplos.add(r.detalhe); }
  }
  resultados.push({ cenario: c.nome, rodadas: RODADAS, falhas, taxa: `${Math.round((falhas / RODADAS) * 100)}%`, exemplos: [...exemplos].slice(0, 3) });
  console.error(`• ${c.nome}: ${falhas}/${RODADAS} rodadas com erro`);
}
const fs = await import('node:fs');
const out = new URL('../resultados/concorrencia.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({ data: new Date().toISOString(), latencia: process.env.PF_SHEET_LATENCY, resultados }, null, 2));
console.error(`resultados em ${out.pathname}`);
await close();
