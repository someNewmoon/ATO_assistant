const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/voyage-return.js'), 'utf8');
const first = '9413ef42-bec8-4f9f-84d0-9ce3f6fdb082';
const next = '3403f34e-ac29-4c53-92d2-a72d02a66c9c';
const table = 'table-' + 'a'.repeat(32);
const online = 'online-' + 'b'.repeat(32) + '-2';

function voyageHelper(options = {}) {
  const store = new Map();
  const context = vm.createContext({
    URL,
    window: options.window || {},
    document: options.document,
    location: options.location || new URL('http://localhost/aibp/?storyReturn=%2Fstory%2F%3Fentry%3D0001%26token%3Dprivate'),
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
  });
  vm.runInContext(source, context);
  return context.window.ATO_VOYAGE;
}

test('same-day encounters keep separate battle identities and settled results', () => {
  const voyage = voyageHelper();
  const timeline = voyage.create({ encounter: '49:timeline' }, first);
  const nemesis = voyage.create({ encounter: '49:nemesis' }, next);
  assert.equal(voyage.bind(timeline, table), true);
  assert.equal(voyage.bind(timeline, online), false);
  assert.equal(voyage.bind(nemesis, online), true);
  assert.equal(voyage.settle(timeline, online, 'loot'), false);
  assert.equal(voyage.settle(timeline, table, 'loot'), true);
  assert.equal(voyage.settle(timeline, table, 'skip'), true);
  assert.equal(voyage.read(timeline.id).result, 'loot');
  assert.equal(voyage.read(nemesis.id).result, undefined);
  assert.equal(voyage.read(nemesis.id).battle, online);
});

test('battle and voyage links keep source context and omit authorization parameters', () => {
  const voyage = voyageHelper();
  const entry = voyage.create({ encounter: '49:timeline' }, first);
  voyage.bind(entry, online);
  const resume = new URL(voyage.resumeUrl(voyage.read(first)));
  assert.equal(resume.searchParams.get('battle'), 'b'.repeat(32));
  assert.equal(resume.searchParams.get('voyage'), first);
  assert.equal(resume.searchParams.get('storyReturn'), '/story/?entry=0001');
  assert.equal(voyage.storyUrl('https://example.invalid/story/?entry=0001'), '');
  assert.equal(voyage.storyUrl('/record/'), '');
  assert.equal(voyage.returnUrl(entry), 'http://localhost/index.html?returnVoyage=' + first);
});

test('records return to a same-origin paragraph after saving and keep its voyage', async () => {
  const location = new URL('http://localhost/hero/');
  location.searchParams.set('returnStory', '/story/index.html?entry=0002&key=c1-0-1&token=private');
  location.searchParams.set('voyage', first);
  const calls = [];
  let click;
  const anchor = {
    addEventListener: (_, handler) => { click = handler; },
    setAttribute() {},
    removeAttribute() {},
  };
  const voyage = voyageHelper({
    location,
    document: { querySelectorAll: () => [anchor] },
    window: { ATO_PAGE_ROUTER: { focusOrNavigate: href => calls.push(href) } },
  });
  voyage.create({ step: 'story' }, first);
  voyage.wireReturn('.back-to-console', async () => { calls.push('saved'); return true; }, { toStory: true });
  assert.equal(anchor.href, 'http://localhost/story/index.html?entry=0002&key=c1-0-1&voyage=' + first);
  await click({ button: 0, preventDefault() {} });
  assert.deepEqual(calls, ['saved', anchor.href]);
});
