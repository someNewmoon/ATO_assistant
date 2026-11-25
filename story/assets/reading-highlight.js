(() => {
  const name = 'story-narration-current';
  const enabled = window.CSS?.highlights && typeof window.Highlight === 'function';

  function clear() {
    if (enabled) CSS.highlights.delete(name);
  }

  function matchChunks(sources) {
    if (!enabled) return () => null;
    const nodes = sources.flatMap(source => {
      if (source.nodeType === Node.TEXT_NODE) return [source];
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const text = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) text.push(node);
      return text;
    });
    const raw = nodes.map(node => node.data).join('');
    const blank = text => ' '.repeat(text.length);
    const masked = raw
      .replace(/(^|\n)([ \t]*\d{1,2}[.．、])(?!\d)/g, (_, line, number) => line + blank(number))
      .replace(/(?:查看|前往|转至|跳至|继续阅读)\s*(?=[。！？；]|$)/g, blank)
      .replace(/（[^（）]*）|\([^()]*\)|【[^【】]*】|\[[^\[\]]*\]/g, blank);
    const points = [];
    let readable = '';
    let base = 0;
    for (const node of nodes) {
      for (let offset = 0; offset < node.length; offset += 1) {
        const char = masked[base + offset];
        if (/\s/.test(char)) continue;
        readable += char;
        points.push({ node, offset });
      }
      base += node.length;
    }

    let cursor = 0;
    return (chunk, spokenOffset = 0) => {
      const normalized = chunk.slice(spokenOffset).replace(/\s+/g, '');
      if (!normalized) return null;
      const start = readable.indexOf(normalized, cursor);
      if (start < 0) return null;
      cursor = start + normalized.length;
      return (from = 0, to = chunk.length) => {
        clear();
        const offset = index => chunk.slice(spokenOffset, Math.max(index, spokenOffset)).replace(/\s+/g, '').length;
        const ranges = [];
        let range;
        for (const point of points.slice(start + offset(from), start + offset(to))) {
          if (range && range.endContainer === point.node
              && !point.node.data.slice(range.endOffset, point.offset).trim()) {
            range.setEnd(point.node, point.offset + 1);
          } else {
            range = new Range();
            range.setStart(point.node, point.offset);
            range.setEnd(point.node, point.offset + 1);
            ranges.push(range);
          }
        }
        if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
      };
    };
  }

  window.ATO_STORY_READING_HIGHLIGHT = { clear, matchChunks };
})();
