(function () {
  const toggle = document.querySelector("#storyRulesToggle");
  toggle?.addEventListener("click", () => {
    const hidden = document.body.classList.toggle("story-rule-highlights-off");
    toggle.setAttribute("aria-pressed", String(!hidden));
  });

  const topics = /(?:好感度?|声望|外交|阵营|亲密度|阿尔戈号|船体|船员|命运|知识|进展|希望标记|灾[厄祸]|悖论|凝固时光|猜忌|陌生人|资源|军备|船材|石筑|神浆|泰坦|回忆|标记|矩阵|装备|卡牌|favo[u]r|diplomacy|(?:argo )?(?:hull|crew|fate|knowledge)|progress|(?:hope|doom) tokens?|paradox|resource|ambrosia|titan|matrix)/i;
  const change = /(?:获得|拿取|抽取|失去|消耗|支付|放置|移除|增加|减少|提升|降低|恢复|标记|记录|[+＋−-]\s*\d|\b(?:gain|lose|add|remove|spend|mark|draw|discard|increase|decrease|recover)\b)/i;
  const checks = /(?:投掷|掷(?:一[枚颗个])?\s*(?:\d*\s*[dD]\s*\d+|骰)|[dD]\s*(?:10|20)\b|属性判定|进行[^，。；]{0,12}(?:检定|测试|判定)|(?:判定|检定|测试)(?:结果|成功|失败|为)|(?:至少|大于|小于|不低于)[^，。；]{0,4}\d|\b(?:roll\b|make\s+(?:an?\s+)?\w+\s+(?:check|test)|test\s+(?:passes|fails)|on\s+(?:a\s+)?(?:success|failure)))/i;
  const instruction = /(?:(?:前往|转至|跳至|阅读|读取|继续阅读|记录)\s*(?:第\s*)?\[?(?:\d{3,}|[A-Z]{1,3}\d{2,})(?!\w)|\b(?:go\s+to|read|proceed\s+to)\s*\[?(?:\d{3,}|[A-Z]{1,3}\d{2,})(?!\w)|(?:获得|失去)\s*(?:\d+\s*[枚点个]?\s*)?(?:希望|灾[祸厄])(?=[，。；、。\s，！？]|$)|(?:标记|勾选)\s*(?:[A-Z]\d{1,2}|矩阵)|\b(?:gain|lose)\s+(?:\d+\s+)?(?:hope|doom)\b)/i;
  const sentence = /[^\n。！？；.!?;]+[。！？；.!?;]?/g;

  function classify(text) {
    if (checks.test(text.trim())) return "check";
    if (instruction.test(text) || (change.test(text) && topics.test(text))) return "result";
    return "";
  }

  function decorate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const blocks = new Map();
    const skipped = "button, select, input, script, style, .story-rule-mark, .supplement-scan, .battle-gallery, .entity-tooltip";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (element.closest(skipped)) continue;
      const block = element.closest("p, li, td, th, h3, h4, blockquote, .battle-block, .story-text");
      const key = block && root.contains(block) ? block : element;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(node);
    }
    for (const nodes of blocks.values()) {
      const source = nodes.map(node => node.data).join("");
      const marks = [...source.matchAll(sentence)].flatMap(match => {
        const kind = classify(match[0]);
        return kind ? [{ start: match.index, end: match.index + match[0].length, kind }] : [];
      });
      let offset = 0;
      let current = 0;
      for (const node of nodes) {
        const end = offset + node.length;
        while (current < marks.length && marks[current].end <= offset) current++;
        let from = 0;
        const replacement = document.createDocumentFragment();
        for (let i = current; i < marks.length && marks[i].start < end; i++) {
          const { start, end: until, kind } = marks[i];
          const left = Math.max(0, start - offset);
          const right = Math.min(node.length, until - offset);
          const content = node.data.slice(left, right);
          if (!content.trim()) continue;
          replacement.append(node.data.slice(from, left));
          const mark = document.createElement("mark");
          mark.className = "story-rule-mark";
          mark.dataset.ruleKind = kind;
          mark.textContent = content;
          replacement.append(mark);
          from = right;
        }
        if (from) {
          replacement.append(node.data.slice(from));
          node.replaceWith(replacement);
        }
        offset = end;
      }
    }
  }

  window.ATO_STORY_RULE_HIGHLIGHTS = { decorate };
})();
