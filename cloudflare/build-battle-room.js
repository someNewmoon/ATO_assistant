import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, serialize } from 'parse5';
import { transform } from 'esbuild';

const scripts = [
  'hero/hero-catalog.js', 'technology/gear-inventory.js', 'technology/battle-config.js',
  'aibp/boss-levels-data.js', 'ss/terrain-data.js', 'aibp/battle_los.js',
  'aibp/tactical-sprites.js', 'aibp/battle_board_pieces.js', 'aibp/battle_map_control.js',
  'aibp/room-assets.js', 'aibp/room-card-state.js', 'aibp/room-dice.js',
  'aibp/room-board.js', 'aibp/battle-room.js',
];
const styles = ['battle_map_control.css', 'battle_tactics.css', 'battle-room.css'];

function findById(node, id) {
  if (node.attrs?.some(attr => attr.name === 'id' && attr.value === id)) return node;
  for (const child of node.childNodes || []) {
    const found = findById(child, id);
    if (found) return found;
  }
}

function markup(node) {
  if (!node) throw new Error('Missing battle room markup in AIBP');
  return serialize({ nodeName: '#document-fragment', childNodes: [node] });
}

export async function buildBattleRoom(staging, repo) {
  const pagePath = join(staging, 'aibp/index.html');
  const original = await readFile(pagePath, 'utf8');
  const document = parse(original);
  const room = markup(findById(document, 'battleRoom'));
  const board = markup(findById(document, 'battleMapControl'));
  const art = await readFile(join(staging, 'aibp/room-card-art.json'), 'utf8');
  const code = 'window.ATO_LIGHT_ROOM=true;window.ATO_ROOM_ART=' + art + ';\n'
    + (await Promise.all(scripts.map(path => readFile(join(repo, path), 'utf8')))).join('\n;\n');
  const runtime = await transform(code, { minify: true, target: 'es2022', legalComments: 'none' });
  const version = createHash('sha256').update(runtime.code).digest('hex').slice(0, 16);
  const filename = 'room-runtime-' + version + '.js';
  await writeFile(join(staging, 'aibp', filename), runtime.code);
  const css = (await Promise.all(styles.map(path => readFile(join(staging, 'aibp', path), 'utf8')))).join('\n');
  const compact = await transform(css, { loader: 'css', minify: true, legalComments: 'none' });
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ATO 在线战斗室</title>
<link rel="preload" as="script" href="${filename}">
<style>
:root{color-scheme:light dark;--line:#cdbca9;--panel:#faf7f1;--text:#342d24}
*{box-sizing:border-box}body{margin:0;background:#eee9e1;color:var(--text);font-family:system-ui,sans-serif}
button,select,input{font:inherit;color:inherit}button,select{background:var(--panel);border:1px solid var(--line);border-radius:5px}
button:not(:disabled){cursor:pointer}button:disabled{opacity:.5}
[hidden]{display:none!important}
${compact.code}
</style>
<script src="${filename}" defer></script></head>
<body class="aibp-room-only">
<button id="battleRoomToggle" hidden>在线战斗室</button>
<a id="cloudBattleProjection" href="../ss/?preview=aibp" hidden>版图投屏</a>
<div class="app"><main>${room}</main></div>
<template id="battleRoomBoardTemplate">${board}</template>
<noscript>请启用 JavaScript 后打开战斗室。</noscript>
</body></html>`;
  await writeFile(join(staging, 'aibp/room.html'), html);

  // Existing invitations continue to work without loading the full host console.
  const redirect = `<script>
(()=>{const u=new URL(location.href),q=u.searchParams,h=new URLSearchParams(u.hash.slice(1));
if(/^[a-f0-9]{32}$/.test(q.get("battle")||"")&&!q.has("theatreBattle")&&(h.has("invite")||h.has("view"))){
const t=new URL("room.html",u);t.search=u.search;t.hash=u.hash;location.replace(t.href);}})();
</script>`;
  const inventory = await readFile(join(staging, 'api/aibp-image-index.php'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const bootstrap = '<script>window.ATO_LIGHT_ROOM=true;window.ATO_DEFER_FULL_CARD_IMAGES=true;'
    + (inventory ? 'window.ATO_HOST_IMAGE_INDEX=' + inventory.replace(/<\/script/gi, '<\\/script') + ';' : '') + '</script>';
  const host = await optimizeHostScripts(staging, original.replace('<title>AIBP Apostle Viewer</title>',
    '<title>AIBP Apostle Viewer</title>' + bootstrap));
  await writeFile(pagePath, host.replace('<title>AIBP Apostle Viewer</title>', '<title>AIBP Apostle Viewer</title>\n' + redirect));
  const headerPath = join(staging, '_headers');
  const headers = await readFile(headerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  await writeFile(headerPath, headers + '\n/aibp/room-runtime-*\n  Cache-Control: public, max-age=31536000, immutable\n');
  console.log(`Battle room: ${scripts.length} scripts → one runtime (${runtime.code.length} bytes), HTML ${Buffer.byteLength(html)} bytes`);
}

async function optimizeHostScripts(staging, original) {
  const document = parse(original);
  let before = 0;
  let after = 0;
  async function optimize(parent) {
    const nodes = parent.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.tagName !== 'script') {
        if (node.childNodes) await optimize(node);
        continue;
      }
      const src = node.attrs.find(attr => attr.name === 'src')?.value;
      if (!src) {
        const type = node.attrs.find(attr => attr.name === 'type')?.value;
        if (type && type !== 'text/javascript') continue;
        const source = node.childNodes.map(child => child.value || '').join('');
        if (!source.trim()) continue;
        const compact = await transform(source, { target: 'es2022', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' });
        node.childNodes = [{ nodeName: '#text', value: compact.code.replace(/<\/script/gi, '<\\/script'), parentNode: node }];
        continue;
      }
      if (node.attrs.some(attr => !['src', 'defer'].includes(attr.name))) continue;
      const deferred = node.attrs.some(attr => attr.name === 'defer');
      const entries = [];
      let last = i;
      for (let j = i; j < nodes.length; j++) {
        const candidate = nodes[j];
        if (candidate.nodeName === '#comment' || (candidate.nodeName === '#text' && !candidate.value.trim())) continue;
        const attrs = candidate.attrs || [];
        const path = attrs.find(attr => attr.name === 'src')?.value;
        if (candidate.tagName !== 'script' || !path || attrs.some(attr => !['src', 'defer'].includes(attr.name))
            || deferred !== attrs.some(attr => attr.name === 'defer') || /^[a-z]+:|^\/\//i.test(path)) break;
        const pathname = new URL(path, 'https://build.invalid/aibp/index.html').pathname;
        let source;
        try { source = await readFile(join(staging, pathname), 'utf8'); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          // The Pages package omits the original story source data. English
          // labels already have their standalone dictionaries in assets/.
          if (pathname !== '/story/data/english-source-data.js') break;
          source = '';
        }
        entries.push({ node: candidate, source });
        last = j;
      }
      if (!entries.length) continue;
      before += entries.length;
      if (entries.length === 1 && entries[0].source) {
        after++;
        continue;
      }
      const source = entries.map(entry => entry.source).join('\n;\n');
      const compact = await transform(source, { target: 'es2022', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' });
      const hash = createHash('sha256').update(compact.code).digest('hex').slice(0, 16);
      const filename = 'host-runtime-' + hash + '.js';
      await writeFile(join(staging, 'aibp', filename), compact.code);
      node.attrs.find(attr => attr.name === 'src').value = filename;
      const removed = new Set(entries.slice(1).map(entry => entry.node));
      parent.childNodes = parent.childNodes.filter(child => !removed.has(child));
      nodes.splice(i + 1, last - i, ...nodes.slice(i + 1, last + 1).filter(child => !removed.has(child)));
      after++;
    }
  }
  await optimize(document);
  const headerPath = join(staging, '_headers');
  const headers = await readFile(headerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  await writeFile(headerPath, headers + '\n/aibp/host-runtime-*\n  Cache-Control: public, max-age=31536000, immutable\n');
  console.log('AIBP script requests: ' + before + ' → ' + after);
  return serialize(document);
}
