// Impressora virtual para os testes do kiosk: uma fila do CUPS ("pf-teste") que
// entrega os trabalhos a um servidor TCP local (protocolo AppSocket/JetDirect)
// em vez de papel. Dá para deixá-la lenta, desligada ou ligada de novo.
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FILA = 'pf-teste';
export const PORTA = 9187;

export function criarFila() {
  try { execFileSync('lpstat', ['-v', FILA], { stdio: 'ignore' }); return; } catch {}
  execFileSync('/usr/sbin/lpadmin', ['-p', FILA, '-E', '-v', `socket://127.0.0.1:${PORTA}`, '-m', 'raw', '-D', 'PrintFlow teste (virtual)'], { stdio: 'ignore' });
}

export function removerFila() {
  try { execFileSync('cancel', ['-a', FILA], { stdio: 'ignore' }); } catch {}
  try { execFileSync('/usr/sbin/lpadmin', ['-x', FILA], { stdio: 'ignore' }); } catch {}
}

export function ligarImpressora({ demoraMs = 0 } = {}) {
  const recebidos = [];
  const sockets = new Set();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    const job = { inicio: Date.now(), bytes: 0 };
    // "Imprimir" leva demoraMs: só lê os dados depois disso
    s.pause();
    setTimeout(() => s.resume(), impressora.demoraMs);
    s.on('data', (d) => { job.bytes += d.length; });
    s.on('end', () => { job.fim = Date.now(); recebidos.push(job); s.end(); });
    s.on('error', () => {});
  });
  const impressora = {
    demoraMs,
    recebidos,
    ligada: false,
    async ligar() {
      await new Promise((r, j) => server.once('error', j).listen(PORTA, '127.0.0.1', () => r()));
      impressora.ligada = true;
    },
    async desligar() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(() => r()));
      impressora.ligada = false;
    },
  };
  return impressora;
}

// Retoma a fila se o CUPS a pausou depois de uma falha de conexão
export function retomarFila() {
  try { execFileSync('cupsenable', [FILA], { stdio: 'ignore' }); } catch {}
}

// Atributos de um trabalho registrados pelo CUPS (cópias, intervalo de páginas, estado)
export function atributosDoTrabalho(jobId) {
  const num = jobId.split('-').pop();
  const test = `{ OPERATION Get-Job-Attributes
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR integer job-id ${num}
  ATTR keyword requested-attributes copies,page-ranges,job-state }`;
  // O ipptool não lê o arquivo de teste por pipe: precisa ser um arquivo de verdade
  const arquivo = path.join(os.tmpdir(), `pf-ipp-${process.pid}-${num}.test`);
  fs.writeFileSync(arquivo, test);
  let out;
  try { out = execFileSync('ipptool', ['-tv', `ipp://localhost/printers/${FILA}`, arquivo]).toString(); }
  finally { fs.unlinkSync(arquivo); }
  return {
    copies: Number(/copies \(integer\) = (\d+)/.exec(out)?.[1]),
    pageRanges: /page-ranges \(rangeOfInteger\) = (\S+)/.exec(out)?.[1],
  };
}
