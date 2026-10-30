// Gera PDFs mínimos e válidos para os testes (N páginas, retrato ou paisagem).
export function gerarPdf({ paginas = 1, largura = 595, altura = 842, titulo = 'Teste' } = {}) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 1; i <= paginas; i++) {
    const texto = `${titulo} - pagina ${i} de ${paginas}`;
    const stream = `BT /F1 24 Tf 40 ${altura - 80} Td (${texto}) Tj ET 0 0 1 RG 4 w 10 10 ${largura - 20} ${altura - 20} re S`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${largura} ${altura}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${paginas} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

export const RETRATO = { largura: 595, altura: 842 };   // A4 em pé
export const PAISAGEM = { largura: 842, altura: 595 };  // A4 deitado
