import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aibpImageIndex, collectHostedArt, roomCardArt } from './hosted-card-art.js';
import { buildBattleRoom } from './build-battle-room.js';
import { buildHostedStory } from './build-hosted-story.js';
import { storyScanFilename } from './worker/story-scans.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repo = join(directory, '..');
const output = join(directory, 'public');
const directories = new Set(['aibp', 'api', 'assets', 'briefing', 'hero', 'map', 'record', 'ss', 'story', 'technology', 'theatre']);
const extensions = new Set(['.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2']);
const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
  .split('\0')
  .filter(file => file === 'index.html' || file === 'LICENSE' || (
    directories.has(file.split('/')[0]) && extensions.has(extname(file).toLowerCase())
    && !file.split('/').some(part => part.startsWith('.') || ['tests', 'tools'].includes(part))
  ));

const imageRoot = process.env.ATO_CARD_ART_DIR ? resolve(process.env.ATO_CARD_ART_DIR) : '';
const hosted = imageRoot ? await collectHostedArt(imageRoot) : [];
if (imageRoot && hosted.length === 0) throw new Error('ATO_CARD_ART_DIR 中没有可发布卡图。');
const sourceFiles = new Map(files.map(file => [file, join(repo, file)]));
for (const path of hosted) if (!sourceFiles.has(path)) sourceFiles.set(path, join(imageRoot, path));
if (sourceFiles.size + 9 > 20000) throw new Error('Pages 免费版文件数上限为 20,000。');

const staging = await mkdtemp(join(directory, '.pages-'));
try {
  for (const [file, source] of sourceFiles) {
    const dest = join(staging, file);
    const info = await lstat(source);
    if (!info.isFile()) throw new Error(`Pages 源文件不是普通文件: ${file}`);
    if (info.size > 25 * 1024 * 1024) {
      throw new Error(`Pages 单文件大于 25 MiB: ${file}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(source, dest);
  }
  const paths = [...sourceFiles.keys()].sort();
  const { images: gearCards } = JSON.parse(await readFile(join(repo, 'technology/gear_card_images.json'), 'utf8'));
  await writeFile(join(staging, 'aibp/room-card-art.json'), JSON.stringify(roomCardArt(paths, gearCards)));
  if (hosted.length) {
    await writeFile(join(staging, 'api/aibp-image-index.php'), JSON.stringify(aibpImageIndex(paths)));
    await writeFile(join(staging, '_headers'), [
      '/*.svg',
      "  Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      '  X-Content-Type-Options: nosniff',
      '/api/aibp-image-index.php',
      '  Content-Type: application/json; charset=utf-8',
      '',
    ].join('\n'));
  }
  // The source directory may contain a secret. Copy only the five encrypted books.
  const storyRoot = process.env.ATO_STORY_LIBRARY_DIR
    || (imageRoot && join(dirname(imageRoot), '线上故事加密库'));
  if (storyRoot) {
    const version = (await readFile(join(storyRoot, 'publish-version'), 'utf8').catch(error => {
      if (!process.env.ATO_STORY_LIBRARY_DIR && error.code === 'ENOENT') return '';
      throw error;
    })).trim();
    if (version) {
      if (!/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid story library version.');
      const parts = {};
      const dest = join(staging, 'story/library', version);
      await mkdir(dest, { recursive: true });
      for (const cycle of ['c1', 'c2', 'c3', 'c4', 'c5']) {
        const name = cycle + '.bin';
        const encrypted = await readFile(join(storyRoot, version, name));
        await writeFile(join(dest, name), encrypted);
        const size = 128 * 1024;
        parts[cycle] = Math.ceil(encrypted.length / size);
        for (let part = 0; part < parts[cycle]; part++) {
          await writeFile(join(dest, cycle + '-' + part + '.bin'), encrypted.subarray(part * size, (part + 1) * size));
        }
      }
      const scanRoot = process.env.ATO_STORY_SCAN_DIR || join(dirname(storyRoot), '官方扫描图库');
      const scanIndex = await readFile(join(scanRoot, 'index.json')).catch(error => {
        if (!process.env.ATO_STORY_SCAN_DIR && error.code === 'ENOENT') return null;
        throw error;
      });
      const scans = new Set();
      if (scanIndex) {
        for (const book of Object.values(JSON.parse(scanIndex))) {
          for (const { file } of Object.values(book)) {
            if (!storyScanFilename.test(file)) throw new Error('Invalid story scan name.');
            scans.add(file);
          }
        }
        const scanDest = join(staging, 'story/scans');
        await mkdir(scanDest, { recursive: true });
        for (const file of scans) await copyFile(join(scanRoot, file), join(scanDest, file));
        await writeFile(join(scanDest, 'index.json'), scanIndex);
        console.log('官方扫描图 · ' + scans.size);
      }
      if (sourceFiles.size + 10 + scans.size + Object.values(parts).reduce((sum, count) => sum + count, 0) > 20000) {
        throw new Error('Pages 免费版文件数上限为 20,000。');
      }
      await buildHostedStory(staging, { version, parts, scanIndex: Boolean(scanIndex) });
    }
  }
  await buildBattleRoom(staging, repo);
  const gitVersion = execFileSync('git', ['describe', '--abbrev=0', '--match', 'v[0-9]*'], {
    cwd: repo, encoding: 'utf8',
  }).trim().replace(/^v/, '');
  await writeFile(join(staging, 'assets/update/app-version.js'), `window.ATO_APP_VERSION = ${JSON.stringify(gitVersion)};\n`);
  await writeFile(join(staging, '_routes.json'), JSON.stringify({
    version: 1, include: ['/api/health', '/api/campaign-state.php', '/api/battle-room/*', '/api/app-update.php', '/briefing/api.php'], exclude: [],
  }));
  // Pages uses 404.html to distinguish multi-page sites from SPA fallback.
  await writeFile(join(staging, '404.html'), '<!doctype html><meta charset=utf-8><title>找不到页面</title><p>找不到页面</p><a href="/">返回主控台</a>');
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Pages: ${sourceFiles.size} 个源文件（${hosted.length} 个供发布的素材）→ ${basename(output)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
