import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [source, destination, ...squads] = process.argv.slice(2);
if (!source || !destination || !squads.length || !squads.every(id => /^[a-f0-9]{32}$/.test(id))) {
  throw new Error('Usage: node import-story-library.mjs <extracted app/story/data> <private export directory> <authorized squad ID> [...]');
}

async function readBookData(name, variable) {
  const raw = await readFile(join(source, name), 'utf8');
  const prefix = new RegExp('^window\\.' + variable + '\\s*=\\s*');
  const text = raw.trim();
  if (!prefix.test(text)) throw new Error('Unexpected file format: ' + name);
  return JSON.parse(text.replace(prefix, '').replace(/;$/, ''));
}

const fan = await readBookData('storybook-data.js', 'STORYBOOK_DATA');
const official = await readBookData('storybook-official-data.js', 'STORYBOOK_OFFICIAL_DATA');
const cycles = ['c1','c2','c3','c4','c5'];
const fingerprint = createHash('sha256');
const books = new Map();
for (const cycle of cycles) {
  const fanBook = fan.books.find(book => book.id === cycle);
  const officialBook = official.books.find(book => book.id === cycle);
  if (!fanBook?.entries?.length || !officialBook?.entries?.some(entry => entry.officialText?.trim())) {
    throw new Error('Incomplete source data for ' + cycle);
  }
  // This import covers text. Scan files are not part of the online library.
  const officialEntries = officialBook.entries.map(({ officialScan, ...entry }) => entry);
  const payload = Buffer.from(JSON.stringify({ fan: fanBook, official: { ...officialBook, entries: officialEntries } }));
  fingerprint.update(payload);
  books.set(cycle, gzipSync(payload));
}

await mkdir(destination, { recursive: true, mode: 0o700 });
const secretPath = join(destination, 'worker-secret.json');
let previous;
try { previous = JSON.parse(await readFile(secretPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = previous ? Buffer.from(previous.key, 'base64') : randomBytes(32);
if (key.length !== 32) throw new Error('Unexpected encryption key length.');
const version = fingerprint.update(key).digest('hex').slice(0, 20);
const output = join(destination, version);
await mkdir(output, { recursive: true });
for (const [cycle, payload] of books) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(version + '/' + cycle));
  const encrypted = Buffer.concat([iv, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  await writeFile(join(output, cycle + '.bin'), encrypted);
  console.log(cycle + ' · ' + encrypted.length + ' bytes');
}
await writeFile(secretPath, JSON.stringify({ version, key: key.toString('base64'), squads }), { mode: 0o600 });
await writeFile(join(destination, 'publish-version'), version + '\n');
