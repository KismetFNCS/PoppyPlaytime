// Concatenates the engine modules (src/NN_*.js, in numeric order) into the single-file game.
// Usage: node tools/build.mjs   ->  writes index.html at the repository root.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const shell = readFileSync(join(src, 'shell.html'), 'utf8');
const modules = readdirSync(src).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
const body = modules.map(f => '// ===== module: ' + f + ' =====\n' + readFileSync(join(src, f), 'utf8').trimEnd()).join('\n\n');
const marker = '<!--@@SCRIPTS@@-->';
if (!shell.includes(marker)) throw new Error('shell.html is missing the script marker');
const out = shell.replace(marker, () => '<script>\n' + body + '\n</script>');
writeFileSync(join(root, 'index.html'), out);
console.log('built index.html from ' + modules.length + ' modules, ' + out.split('\n').length + ' lines');
