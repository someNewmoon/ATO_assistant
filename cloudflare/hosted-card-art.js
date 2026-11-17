import { readFile, readdir } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';

const roots = ['aibp', 'assets', 'hero', 'map', 'record', 'ss', 'story', 'technology'];
const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const activeSvg = /<!\s*(?:doctype|entity)|<\s*(?:[\w.-]+:)?(?:script|foreignobject|iframe|object|embed|animate|set)\b|\s(?:[\w.-]+:)?on[\w-]+\s*=|javascript:/i;

export async function collectHostedArt(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || /[\\%?#]/.test(entry.name)) continue;
      const path = posix.join(directory, entry.name);
      // Original storybook pages are outside the card-art publication.
      if (path === 'story/data') continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const extension = extname(path).toLowerCase();
        if (!supported.has(extension)) continue;
        if (extension === '.svg' && activeSvg.test(await readFile(join(root, path), 'utf8'))) {
          throw new Error('SVG 包含主动内容，无法作为静态卡图发布: ' + path);
        }
        files.push(path);
      }
    }
  }
  for (const directory of roots) await walk(directory);
  return files.sort();
}

export function aibpImageIndex(files) {
  const base = 'aibp/';
  const index = new Set(files.filter(path =>
    /^aibp\/ps\/(?:[A-Z][A-Z0-9_]+|other(?:\/trait)?)\/[^/]+\.(?:jpg|jpeg|png)$/i.test(path)
  ).map(path => path.slice(base.length)));
  const images = [...index].filter(path => !path.endsWith('.preview.jpg'));
  const previews = Object.fromEntries(images.filter(path => index.has(path + '.preview.jpg'))
    .map(path => [path, path + '.preview.jpg']));
  return { ok: true, version: 2, images, previews };
}

export function roomCardArt(files, gearCards) {
  const paths = new Set(files);
  const equipment = Object.fromEntries(Object.entries(gearCards)
    .map(([id, path]) => [id, 'technology/' + path])
    .filter(([id, path]) => /^[A-Z]J\d+$/.test(id) && paths.has(path)));
  const titans = files.filter(path => /^technology\/images\/titans\/tt_[a-z0-9_]+\.png$/.test(path));
  return { equipment, titans };
}
