// Gera as variáveis de ambiente da credencial de desenvolvedor (painel de métricas).
// A senha é digitada sem aparecer na tela e não é gravada: só o hash bcrypt é impresso.
//
// Uso: npm run dev:credencial
import readline from 'node:readline';
import bcrypt from 'bcryptjs';

const perguntar = (texto, oculto = false) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (oculto) {
    rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(texto); };
  }
  rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write('\n'); resolve(r); });
});

const email = (await perguntar('Email de login do desenvolvedor (ex.: dev@printflow.app): ')).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+$/.test(email)) { console.error('Email inválido.'); process.exit(1); }
if (/@(?:academico\.)?ifsul\.edu\.br$/.test(email)) { console.error('Use um email que não seja institucional, para não coincidir com conta de aluno.'); process.exit(1); }

const senha = await perguntar('Senha (mínimo 14 caracteres, com maiúscula, minúscula, número e símbolo): ', true);
if (senha.length < 14 || !/[A-Z]/.test(senha) || !/[a-z]/.test(senha) || !/[0-9]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
  console.error('Senha fraca demais para o acesso de desenvolvedor.');
  process.exit(1);
}
if (senha !== await perguntar('Repita a senha: ', true)) { console.error('As senhas não conferem.'); process.exit(1); }

const hash = await bcrypt.hash(senha, 12);
console.log('\nCadastre estas duas variáveis na Vercel (Settings → Environment Variables → Production) e faça um novo deploy:\n');
console.log(`DEV_EMAIL=${email}`);
console.log(`DEV_PASSWORD_HASH=${hash}`);
console.log('\nPara usar localmente, adicione as mesmas linhas ao arquivo .env.');
