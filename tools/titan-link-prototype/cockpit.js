const steps = [
  { label: '宣告鲸刀', phase: 0, hint: '从左侧武器槽宣告鲸刀，或直接按下方按钮。' },
  { label: '投掷攻击骰', phase: 0, hint: '鲸刀已宣告。投掷白色关键骰与数字骰。' },
  { label: '确认 2 次命中', phase: 0, hint: '预设投掷结果。确认两次命中，进入第一能力时段。' },
  { label: '揭示部位牌', phase: 1, hint: '先处理第一能力时段，可点击下方标记演示放入克拉托斯池。', pool: '第一能力时段' },
  { label: '投掷威力骰', phase: 2, hint: '2 次命中各提供 1 枚红威力骰，另带入 1 枚泰坦基础红威力骰。' },
  { label: '确认伤口与骇物响应', phase: 2, hint: '预设威力骰已落盘。按部位牌核对威力及骇物响应。' },
  { label: '清池并进入第二能力时段', phase: 2, hint: '本次演示按伤口结算。清理克拉托斯池中的旧标记。' },
  { label: '完成第二能力时段', phase: 3, hint: '可演示把本次标记放进池里，然后结束这次攻击。', pool: '第二能力时段' },
  { label: '再试一次', phase: 3, hint: '这次攻击已完成。' }
];
const marks = {
  opening: '伺机', break: '破势', diversion: '分神', rouse: '激励',
  black: '破坏', fire: '火焰', hope: '希望'
};
const fromPower = new URLSearchParams(location.search).get('step') === 'power';
const $ = id => document.getElementById(id);
const pool = document.querySelector('.pool');
const phaseItems = [...document.querySelectorAll('.phases li')];
const markButtons = {};
const markCounts = {};
let step = fromPower ? 4 : 0;
let knocked = false;

function element(tag, label, className) {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  if (className) node.className = className;
  return node;
}
function art(file, description = '') {
  const image = element('img');
  image.src = './art/' + file;
  image.alt = description;
  return image;
}
function attackDie(file, value, landing) {
  const die = element('div', '', landing ? 'die landed' : 'die');
  die.append(art(file), element('span', value));
  return die;
}
function powerDice(name, count, resolved, values) {
  const group = element('div', '', 'dice-group');
  const dice = element('div');
  for (let i = 0; i < count; i++) {
    dice.append(resolved ? attackDie('red.webp', values[i], true) : art('red.webp', '红威力骰'));
  }
  group.append(element('strong', name + ' · ' + count), dice);
  return group;
}

for (const [key, title] of Object.entries(marks)) {
  const button = element('button', '', 'token');
  button.type = 'button';
  const count = element('b', '0');
  button.append(art(key + '.webp'), element('span', title), count);
  button.addEventListener('click', () => {
    if (knocked || !steps[step].pool) return;
    markCounts[key]++;
    drawMarks();
  });
  markCounts[key] = 0;
  markButtons[key] = { button, count, title };
  $('tokens').append(button);
}

function drawMarks() {
  const enabled = !!steps[step].pool && !knocked;
  for (const [key, {button, count, title}] of Object.entries(markButtons)) {
    count.textContent = String(markCounts[key]);
    button.disabled = !enabled;
    button.setAttribute('aria-label', title + '，当前 ' + markCounts[key] + (enabled ? '，点击添加' : ''));
  }
}

function paint({ animate = false, renderDice = true } = {}) {
  const current = steps[step];
  document.body.classList.toggle('knocked', knocked);
  $('posture').textContent = knocked ? '起身' : '模拟击倒';
  $('stance').textContent = knocked ? '击倒' : step === 8 ? '攻击完成' : '行动中';
  $('rage').textContent = step === 0 ? '1' : '2';
  $('weapon-status').textContent = step > 0 ? '已宣告' : '待宣告';
  $('weapon').setAttribute('aria-pressed', String(step > 0));
  $('weapon').disabled = knocked || step > 0;
  phaseItems.forEach((li, index) => {
    if (index === current.phase) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  $('hint').textContent = knocked ? '泰坦已击倒。点击「起身」继续演示。' : current.hint;
  $('next').textContent = current.label;
  $('next').disabled = knocked;
  $('pool-window').textContent = current.pool || '';
  pool.classList.toggle('live', !!current.pool && !knocked);
  const revealed = step >= 4;
  const bp = $('bp');
  const bpFile = revealed ? './art/bp-face.jpg' : './art/bp-back.jpg';
  if (bp.getAttribute('src') !== bpFile) {
    bp.src = bpFile;
    bp.alt = revealed ? '已揭示的追击者部位牌' : '追击者部位牌背面';
    bp.classList.toggle('revealed', animate && revealed);
  }
  $('bp-status').textContent = revealed ? '已揭示' : '命中后揭示';
  if (renderDice) {
    const dice = $('dice');
    dice.replaceChildren();
    if (step === 2 || step === 3) {
      dice.append(attackDie('crit-8.svg','关键骰 8',animate), attackDie('d10-7.svg','7',animate), attackDie('d10-3.svg','3',animate));
    } else if (step >= 4 && step <= 6) {
      const result = step >= 5;
      dice.append(powerDice('鲸刀',2,result,['1 威力','2 威力']), powerDice('泰坦基础',1,result,['1 威力']));
    }
  }
  drawMarks();
}

function clearPool() {
  for (const key of Object.keys(markCounts)) markCounts[key] = 0;
}
function reset() {
  step = 0;
  knocked = false;
  clearPool();
  paint();
}
function advance() {
  if (knocked) return;
  if (step === steps.length - 1) {
    reset();
    return;
  }
  step++;
  if (step === 7) clearPool();
  paint({ animate: true });
  if (step === 1) {
    const meter = $('rage-meter');
    meter.classList.add('pulse');
    window.setTimeout(() => meter.classList.remove('pulse'), 500);
  }
}

$('next').addEventListener('click', advance);
$('weapon').addEventListener('click', advance);
$('reset').addEventListener('click', reset);
$('posture').addEventListener('click', () => {
  knocked = !knocked;
  paint({ renderDice: false });
});
paint();

function showView(view) {
  const board = view === 'board';
  document.body.dataset.view = board ? 'board' : 'dice';
  $('board-view').hidden = !board;
  $('dice-view').hidden = board;
  for (const link of document.querySelectorAll('.battle-nav [data-view]')) {
    if (link.dataset.view === document.body.dataset.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

const viewUrl = new URL(location.href);
showView(viewUrl.searchParams.get('view'));
for (const link of document.querySelectorAll('a[data-view]')) {
  link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showView(link.dataset.view);
    viewUrl.searchParams.set('view', link.dataset.view);
    history.replaceState(null, '', viewUrl);
    if (window.scrollY) window.scrollTo(0, 0);
  });
}

const pose = viewUrl.searchParams.get('pose');
const poseImages = { link: 'pose-link.jpg', brace: 'pose-brace.jpg', strike: 'pose-strike.jpg' };
if (Object.hasOwn(poseImages, pose)) {
  document.body.style.setProperty('--pose-image', 'url("../../aibp/images/titan-link/' + poseImages[pose] + '")');
  document.body.style.setProperty('--pose-scale', '65%');
  document.body.style.setProperty('--pose-focus', '38%');
}
