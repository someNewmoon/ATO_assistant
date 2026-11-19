import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { storyScanFilename } from './worker/story-scans.js';

const [source, library, destination] = process.argv.slice(2);
if (!source || !library || !destination) {
  throw new Error('Usage: node pack-story-scans.mjs <extracted story/data> <encrypted library> <scan export>');
}
const { key } = JSON.parse(await readFile(join(library, 'worker-secret.json'), 'utf8'));
const master = Buffer.from(key, 'base64');
if (master.length !== 32) throw new Error('Invalid story library key.');
const sourceData = (await readFile(join(source, 'storybook-official-data.js'), 'utf8')).trim();
const { books } = JSON.parse(sourceData.replace(/^window\.STORYBOOK_OFFICIAL_DATA\s*=\s*/, '').replace(/;$/, ''));
await mkdir(destination, { recursive: true, mode: 0o700 });

const index = {};
for (const book of books) {
  if (!/^c[1-5]$/.test(book.id)) continue;
  const scans = Object.create(null);
  for (const entry of book.entries) {
    const scan = entry.officialScan;
    if (!scan?.src) continue;
    const name = /^\.\/data\/ato-storybook-key-scans\/(c[1-5]-[A-Za-z0-9_-]+)\.jpg$/.exec(scan.src)?.[1];
    if (!name?.startsWith(book.id + '-') || typeof entry.key !== 'string') throw new Error('Invalid scan source: ' + scan.src);
    const jpeg = await readFile(join(source, 'ato-storybook-key-scans', name + '.jpg'));
    if (jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg.length + 28 > 25 * 1024 * 1024) throw new Error('Invalid scan image: ' + name);
    const revision = createHmac('sha256', master).update(jpeg).digest('hex').slice(0, 20);
    const file = name + '.' + revision + '.bin';
    if (!storyScanFilename.test(file)) throw new Error('Invalid scan name: ' + file);
    const scanKey = createHmac('sha256', master).update('story-scan:' + file).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', scanKey, iv);
    cipher.setAAD(Buffer.from(file));
    await writeFile(join(destination, file), Buffer.concat([iv, cipher.update(jpeg), cipher.final(), cipher.getAuthTag()]));
    scans[entry.key] = { file, status: scan.status };
  }
  index[book.id] = scans;
  console.log(book.id + ' · ' + Object.keys(scans).length + ' scans');
}
await writeFile(join(destination, 'index.json'), JSON.stringify(index));
