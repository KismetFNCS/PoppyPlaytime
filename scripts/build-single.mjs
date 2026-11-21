// Inlines dist/main.js into index.html to produce a standalone, offline the-underworks.html.
import { readFileSync, writeFileSync } from 'node:fs';

const tag = '<script type="module" src="./dist/main.js"></script>';
const html = readFileSync('index.html', 'utf8');
if (!html.includes(tag)) {
  throw new Error('index.html no longer references ./dist/main.js');
}
const js = readFileSync('dist/main.js', 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*$/, '')
  .replaceAll('</script', '<\\/script');
writeFileSync('the-underworks.html', html.replace(tag, () => `<script type="module">\n${js}\n</script>`));
console.log('wrote the-underworks.html');
