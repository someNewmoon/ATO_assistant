import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';

export async function buildHostedStory(staging) {
  const root = join(staging, 'story');
  const page = join(root, 'index.html');
  const html = await readFile(page, 'utf8');
  const start = html.indexOf('    <script src="../assets/campaign-session.js?');
  const end = html.lastIndexOf('</body>');
  if (start < 0 || end <= start) throw new Error('Hosted story script block was not found.');

  const files = [...html.slice(start, end).matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)]
    .map(([, path]) => path);
  const sources = [];
  const englishSources = [];
  for (const path of files) {
    const script = await readFile(join(root, path), 'utf8').catch(error => {
      if (path === './audio-packs/audio/manifest.js' && error.code === 'ENOENT') return '';
      throw error;
    });
    if (path !== './storybook-placeholder.js') {
      const destination = /\/english-(?:terms|ui|language)\.js$/.test(path) ? englishSources : sources;
      destination.push(script);
      continue;
    }
    const raw = script.match(/window\.STORYBOOK_DATA\s*=\s*([\s\S]+);\s*$/);
    if (!raw) throw new Error('Hosted story book list was not found.');
    const books = JSON.parse(raw[1]).books.filter(book => /^c[1-5]$/.test(book.id))
      .map(({ id, title }) => ({ id, title, entries: [] }));
    sources.push('window.STORYBOOK_DATA = ' + JSON.stringify({ books }));
  }
  async function bundle(name, scripts) {
    const { code } = await transform(scripts.join('\n;\n'), { minify: true, target: 'es2022' });
    const version = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const asset = 'assets/' + name + '.' + version + '.js';
    await writeFile(join(root, asset), code);
    return './' + asset;
  }
  const [asset, english] = await Promise.all([
    bundle('hosted-reader', sources),
    bundle('hosted-reader-english', englishSources),
  ]);

  const shell = html.slice(0, start).replace('<html ', '<html data-hosted-story ')
    .replace(/^\s*<script src="\.\.\/story\/data\/english-source-data\.js[^"]*"><\/script>/m, '');
  const loader = [
    '<script>',
    '(() => {',
    '  const body = document.getElementById("storyText");',
    '  let english;',
    '  window.ATO_LOAD_ENGLISH = () => {',
    '    if (english) return;',
    '    english = document.createElement("script");',
    '    english.src = ' + JSON.stringify(english) + ';',
    '    english.onload = () => window.ATO_LANGUAGE?.refresh();',
    '    english.onerror = () => { english.remove(); english = null; };',
    '    document.head.append(english);',
    '  };',
    '  function load(attempt) {',
    '    body.textContent = attempt ? "故事书连接较慢，正在重试…" : "正在加载线上故事书…";',
    '    const script = document.createElement("script");',
    '    script.src = ' + JSON.stringify(asset) + ' + (attempt ? "?retry=" + Date.now() : "");',
    '    script.onerror = () => {',
    '      script.remove();',
    '      if (!attempt) return load(1);',
    '      const retry = document.createElement("button");',
    '      retry.type = "button";',
    '      retry.textContent = "重试";',
    '      retry.onclick = () => load(1);',
    '      body.replaceChildren("故事书加载失败。", retry);',
    '    };',
    '    document.head.append(script);',
    '  }',
    '  load(0);',
    '})();',
    '</script>',
  ].join('\n');
  await writeFile(page, shell + loader + '\n' + html.slice(end));
}
