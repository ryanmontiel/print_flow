import { upload } from '@vercel/blob/client';
const cases = [
  { name: 'doc50kb.pdf', type: 'application/pdf' },
  { name: 'foto50kb.jpg', type: 'image/jpeg' },
];
for (const c of cases) {
  try {
    const file = new Blob([Buffer.alloc(50 * 1024, 66)], { type: c.type });
    const res = await upload(c.name, file, {
      access: 'public',
      handleUploadUrl: 'https://tcc-printflow.vercel.app/api/blob/upload',
      clientPayload: JSON.stringify({ email: 'printflow@admin.com', senha: 'admin2026' }),
      contentType: c.type,
    });
    console.log('OK', c.name, '->', res.url);
  } catch (e) {
    console.log('ERRO', c.name, '->', e.message);
  }
}
