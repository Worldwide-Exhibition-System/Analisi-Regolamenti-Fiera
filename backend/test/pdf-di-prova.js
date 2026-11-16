// Genera piccoli PDF di prova in memoria, senza librerie: una pagina con una
// riga di testo (o vuota) e, a richiesta, un dizionario di cifratura con
// password utente, per provare il messaggio sui PDF protetti.

export function pdfDiProva({ testo = 'Regolamento di prova', cifrato = false } = {}) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const flusso = testo == null ? '' : `BT /F1 12 Tf 72 720 Td (${esc(testo)}) Tj ET`;

  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flusso, 'latin1')} >>\nstream\n${flusso}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  if (cifrato) {
    const h32 = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90';
    oggetti.push(`<< /Filter /Standard /V 1 /R 2 /O <${h32}> /U <${h32}> /P -44 >>`);
  }

  let pdf = '%PDF-1.4\n';
  const posizioni = [];
  oggetti.forEach((o, i) => {
    posizioni.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const p of posizioni) pdf += `${String(p).padStart(10, '0')} 00000 n \n`;
  const cifratura = cifrato ? ` /Encrypt ${oggetti.length} 0 R /ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>]` : '';
  pdf += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R${cifratura} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
