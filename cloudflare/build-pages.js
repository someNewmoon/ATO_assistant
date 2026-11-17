import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const staging = await mkdtemp(join(directory, '.pages-'));
try {
  for (const file of files) {
    const source = join(repo, file);
    const dest = join(staging, file);
    const info = await lstat(source);
    if (!info.isFile()) throw new Error(`Pages 源文件不是普通文件: ${file}`);
    if (info.size > 25 * 1024 * 1024) {
      throw new Error(`Pages 单文件大于 25 MiB: ${file}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(source, dest);
  }
  const gitVersion = execFileSync('git', ['describe', '--abbrev=0', '--match', 'v[0-9]*'], {
    cwd: repo, encoding: 'utf8',
  }).trim().replace(/^v/, '');
  await writeFile(join(staging, 'assets/update/app-version.js'), `window.ATO_APP_VERSION = ${JSON.stringify(gitVersion)};\n`);
  await writeFile(join(staging, '_routes.json'), JSON.stringify({
    version: 1, include: ['/api/health', '/api/campaign-state.php', '/api/app-update.php', '/briefing/api.php'], exclude: [],
  }));
  // Pages uses 404.html to distinguish multi-page sites from SPA fallback.
  await writeFile(join(staging, '404.html'), '<!doctype html><meta charset=utf-8><title>找不到页面</title><p>找不到页面</p><a href="/">返回主控台</a>');
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Pages: ${files.length} 个文件 → ${basename(output)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
