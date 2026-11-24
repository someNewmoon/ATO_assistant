(() => {
  const width = 1140;
  const margin = 48;
  const contentWidth = width - margin * 2;
  const columns = 5;
  const gap = 16;
  const tileWidth = (contentWidth - gap * (columns - 1)) / columns;
  const rowHeight = 288;
  const sans = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  const serif = '"Songti SC", "Noto Serif CJK SC", serif';

  async function download(kits) {
    await document.fonts.ready;
    const assets = new Map();
    const sources = new Set(kits.flatMap(kit => [
      kit.avatar, kit.titan?.art, ...kit.patterns.map(card => card.art), ...kit.gear.map(card => card.art),
    ]).filter(Boolean));
    await Promise.all([...sources].map(async source => {
      const url = new URL(source, document.baseURI);
      if (url.origin !== location.origin) return;
      const image = new Image();
      image.src = url.href;
      try {
        await image.decode();
        assets.set(source, image);
      } catch {
        // The caption remains visible when a card scan is unavailable.
      }
    }));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法生成图片。');

    function text(value, x, y, maxWidth, { size = 22, color = '#292721', weight = 500, family = sans } = {}) {
      ctx.font = `${weight} ${size}px ${family}`;
      ctx.fillStyle = color;
      ctx.fillText(value, x, y, maxWidth);
    }

    function box(x, y, w, h, color, border) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fillStyle = color;
      ctx.fill();
      if (border) {
        ctx.strokeStyle = border;
        ctx.stroke();
      }
    }

    function art(source, x, y, w, h) {
      const image = assets.get(source);
      if (!image) return false;
      const ratio = Math.min(w / image.width, h / image.height);
      const iw = image.width * ratio;
      const ih = image.height * ratio;
      ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      return true;
    }

    function captionLines(value, w) {
      ctx.font = `650 20px ${sans}`;
      const lines = [''];
      for (const char of value) {
        const index = lines.length - 1;
        const next = lines[index] + char;
        if (lines[index] && ctx.measureText(next).width > w) lines.push(char);
        else lines[index] = next;
      }
      if (lines.length > 2) return [lines[0], lines[1].slice(0, -1) + '…'];
      return lines;
    }

    const isSquad = kits.length > 1;
    const gearRows = kit => Math.max(1, Math.ceil(kit.gear.length / columns));
    const hasTitan = kit => kit.titan?.art || kit.patterns.length;
    const memoryRows = kit => Math.ceil(kit.memories.length / 3);
    const height = kits.reduce((total, kit) => total + 172 + (hasTitan(kit) ? 314 : 0)
      + (kit.gear.length ? gearRows(kit) * rowHeight : 56)
      + (kit.memories.length ? 56 + memoryRows(kit) * 42 : 0) + 24, 142);
    const scale = Math.min(2, 8192 / height, Math.sqrt(15000000 / (width * height)));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.scale(canvas.width / width, canvas.height / height);
    ctx.fillStyle = '#f2ede3';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#203731';
    ctx.fillRect(0, 0, width, 102);
    ctx.fillStyle = '#b78c51';
    ctx.fillRect(0, 102, width, 4);
    text(isSquad ? '英雄配装总览' : '英雄配装', margin, 67, 720,
      { size: 42, color: '#fff6e2', weight: 700, family: serif });
    text('阿尔戈号 · 军械库', width - 244, 64, 196, { color: '#f0d6a2' });

    let y = 128;
    for (const kit of kits) {
      box(margin, y, contentWidth, 100, '#e1e6dd');
      box(margin + 16, y + 16, 68, 68, '#ced9cf');
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(margin + 16, y + 16, 68, 68, 12);
      ctx.clip();
      if (!art(kit.avatar, margin + 16, y + 16, 68, 68)) {
        text([...kit.name][0], margin + 34, y + 61, 38, { size: 32, family: serif });
      }
      ctx.restore();
      text(kit.name, margin + 104, y + 44, contentWidth - 136, { size: 32, weight: 700, family: serif });
      text(kit.titan?.name || kit.titanLabel, margin + 104, y + 76, contentWidth - 136, { color: '#476156' });
      y += 116;

      if (hasTitan(kit)) {
        text('泰坦面板与样式卡牌', margin, y + 24, contentWidth, { weight: 700 });
        const cards = [kit.titan?.art && kit.titan, ...kit.patterns].filter(Boolean);
        const panelWidth = kit.titan?.art && cards.length > 1 ? 450 : contentWidth / cards.length;
        let x = margin;
        cards.forEach((card, index) => {
          const w = index === 0 ? panelWidth : (contentWidth - panelWidth) / (cards.length - 1);
          box(x, y + 42, w - 8, 250, '#fcf8f0', '#d6c7b1');
          art(card.art, x + 8, y + 52, w - 24, 202);
          text(card.name, x + 12, y + 279, w - 32, { size: 18, weight: 650 });
          x += w;
        });
        y += 314;
      }

      text('已分配装备', margin, y + 24, contentWidth, { weight: 700 });
      y += 42;
      kit.gear.forEach((card, index) => {
        const x = margin + (index % columns) * (tileWidth + gap);
        const top = y + Math.floor(index / columns) * rowHeight;
        box(x, top, tileWidth, rowHeight - gap, '#fcf8f0', '#d6c7b1');
        text(card.category, x + 12, top + 26, tileWidth - 68, { size: 16, color: '#5d655b' });
        box(x + tileWidth - 58, top + 9, 46, 25, '#e1e6dd');
        text('×' + card.quantity, x + tileWidth - 50, top + 27, 32, { size: 16, weight: 700 });
        if (!art(card.art, x + 10, top + 41, tileWidth - 20, 174)) {
          box(x + 10, top + 41, tileWidth - 20, 174, '#eae3d5');
          text('暂无卡图', x + 24, top + 135, tileWidth - 48, { color: '#655d4e' });
        }
        captionLines(card.name, tileWidth - 24).forEach((line, lineIndex) => {
          text(line, x + 12, top + 239 + lineIndex * 23, tileWidth - 24, { size: 20, weight: 650 });
        });
      });
      if (!kit.gear.length) text('未分配装备', margin, y + 22, contentWidth, { color: '#655d4e' });
      y += kit.gear.length ? gearRows(kit) * rowHeight : 56;

      if (kit.memories.length) {
        text('旧忆卡牌', margin, y + 24, contentWidth, { weight: 700 });
        const columnWidth = (contentWidth - gap * 2) / 3;
        kit.memories.forEach((memory, index) => {
          const x = margin + (index % 3) * (columnWidth + gap);
          const top = y + 38 + Math.floor(index / 3) * 42;
          box(x, top, columnWidth, 34, '#eae3d5');
          text(memory, x + 10, top + 24, columnWidth - 20, { size: 18 });
        });
        y += 56 + memoryRows(kit) * 42;
      }
      y += 38;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图片生成失败，请重试。');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const name = (isSquad ? '英雄配装总览' : kits[0].name + '的配装').replace(/[\\/:*?"<>|]/g, '_');
    link.download = `ATO-${name}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.ATO_LOADOUT_IMAGE = { download };
})();
