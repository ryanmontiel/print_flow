// Servidor para os testes de carga: backend real + serviços simulados, com
// N alunos cadastrados. Imprime a URL e grava uso de CPU/memória a cada segundo.
//
// Uso: PF_SHEET_LATENCY=real node tests/carga/servidor.mjs <alunos> <arquivo-de-métricas>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { default: bcrypt } = await import(path.join(ROOT, 'node_modules/bcryptjs/index.js'));

// Os logs do servidor não interessam aqui
console.log = () => {};
console.warn = () => {};

const { addUser, base, stats } = await import('../helpers/backend.mjs');

const ALUNOS = Number(process.argv[2] || 500);
const METRICAS = process.argv[3];

// Mesmo custo do bcrypt usado no cadastro real (10); um hash só para todos
const senhahash = await bcrypt.hash('Senha@123', 10);
for (let i = 1; i <= ALUNOS; i++) {
  const docs = Array.from({ length: 5 }, (_, d) => ({ id: `${i}-${d}`, name: `Documento ${d}`, url: `https://pub-test.r2.dev/uploads/${i}-${d}.pdf`, size: 200_000, mimetype: 'application/pdf', uploadedAt: new Date().toISOString() }));
  await addUser({ email: `carga${i}@academico.ifsul.edu.br`, nome: `Carga ${i}`, senhahash, creditos: '20', documentos: JSON.stringify(docs) });
}

const amostras = [];
let ultimoCpu = process.cpuUsage(), ultimoT = performance.now();
setInterval(() => {
  const cpu = process.cpuUsage(ultimoCpu), t = performance.now();
  amostras.push({ t: Date.now(), cpu: Math.round(((cpu.user + cpu.system) / 1000 / (t - ultimoT)) * 100), memMB: Math.round(process.memoryUsage().rss / 1048576), sheet: { ...stats } });
  ultimoCpu = process.cpuUsage(); ultimoT = t;
  if (METRICAS) fs.writeFileSync(METRICAS, JSON.stringify(amostras));
}, 1000).unref();

process.stdout.write(`PRONTO ${base}\n`);
