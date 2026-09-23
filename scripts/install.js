// Empacota a extensão e instala o .vsix gerado no VSCode e/ou no Cursor,
// usando os CLIs `code` e `cursor` (o que estiver disponível no PATH).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(__dirname, '..', vsixName);

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function commandExists(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 1. build + package
run('npm', ['run', 'build']);
run('npx', ['vsce', 'package', '--allow-missing-repository', '--allow-star-activation']);

if (!fs.existsSync(vsixPath)) {
  console.error(`Não encontrei ${vsixName} após o package.`);
  process.exit(1);
}

// 2. instala em cada editor disponível
const editors = ['code', 'cursor'];
let installedAny = false;

for (const editor of editors) {
  if (!commandExists(editor)) {
    console.log(`\n(${editor} CLI não encontrado no PATH — pulando. No editor, use "Shell Command: Install '${editor}' command in PATH" na paleta de comandos se quiser habilitar.)`);
    continue;
  }
  run(editor, ['--install-extension', vsixPath, '--force']);
  installedAny = true;
}

if (!installedAny) {
  console.error('\nNenhum CLI (code/cursor) encontrado no PATH. Instale manualmente: abra o editor, vá em Extensions > "..." > "Install from VSIX..." e selecione ' + vsixName);
  process.exit(1);
}

console.log('\n✅ Extensão instalada. Reinicie a janela do editor (ou "Reload Window") para carregar a versão nova.');
