(function () {
  const toggle = document.querySelector("#storyRulesToggle");
  toggle?.addEventListener("click", () => {
    const hidden = document.body.classList.toggle("story-rule-highlights-off");
    toggle.setAttribute("aria-pressed", String(!hidden));
  });

  const topics = /(?:好感度?|声望|外交|阵营|亲密度|阿尔戈号|船体|船员|怒气|愤怒|凶险|末日|进度|命运|知识|进展|希望标记|灾[厄祸]|悖论|凝固时光|猜忌|陌生人|资源|军备|船材|石筑|神浆|泰坦|回忆|标记|矩阵|装备|卡牌|favo[u]r|diplomacy|(?:argo )?(?:hull|crew|fate|knowledge)|progress|(?:hope|doom) tokens?|paradox|resource|ambrosia|titan|matrix)/i;
  const change = /(?:获得|拿取|抽取|失去|消耗|支付|放置|移除|增加|减少|提升|降低|恢复|标记|记录|[+＋−-]\s*\d|\b(?:gain|lose|add|remove|spend|mark|draw|discard|increase|decrease|recover)\b)/i;
  const checks = /(?:投掷|掷(?:一[枚颗个])?\s*(?:\d*\s*[dD]\s*\d+|骰)|[dD]\s*(?:10|20)\b|属性判定|检定(?=[^，。；！？]{1,30}[（(]\s*\d)|进行[^，。；]{0,12}(?:检定|测试|判定)|(?:判定|检定|测试)(?:结果|成功|失败|为)|(?:至少|大于|小于|不低于)[^，。；]{0,4}\d|\b(?:roll\b|make\s+(?:an?\s+)?\w+\s+(?:check|test)|test\s+(?:passes|fails)|on\s+(?:a\s+)?(?:success|failure)))/i;
  const instruction = /(?:(?:前往|转至|跳至|阅读|读取|继续阅读|查看|记录)\s*(?:第\s*)?\[?(?:\d{3,}|[A-Z]{1,3}\d{2,})(?!\w)|\b(?:go\s+to|read|proceed\s+to)\s*\[?(?:\d{3,}|[A-Z]{1,3}\d{2,})(?!\w)|(?:获得|失去)\s*(?:\d+\s*[枚点个]?\s*)?(?:希望|灾[祸厄])(?=[，。；、。\s，！？]|$)|(?:标记|勾选)\s*(?:[A-Z]\d{1,2}|矩阵)|\b(?:gain|lose)\s+(?:\d+\s+)?(?:hope|doom)\b)/i;
  const sentence = /[^\n。！？；.!?;]+[。！？；.!?;]?/g;

  const diplomacy = /(?:外交|diplomacy)/i;
  const linkedModifier = /^(?:如果|若|当|另有|额外|每|获得|失去|支付|消耗|(?:and )?if\b|for each\b)[^。！？\n]*?(?:[+＋−-]\s*\d|[加减]\s*\d)/i;
  const inlineSkip = ".supplement-scan, .battle-gallery, .entity-tooltip, script, style, [hidden]";
  const numberedLine = /(^|\n)[ \t]*(\d{1,2})[.．、](?!\d)/g;
  const checkThreshold = /(?:检定|判定|测试)[^，。；！？]{0,34}[（(]\s*\d+\s*[+＋]\s*[）)]/;

  function classify(text, afterCheck = false) {
    const value = text.trim();
    if (diplomacy.test(value) && (change.test(value) || checks.test(value))) return "diplomacy";
    if (checks.test(value) || checkThreshold.test(value) ||
        (afterCheck && linkedModifier.test(value))) return "check";
    if (instruction.test(text) || (change.test(text) && topics.test(text))) return "result";
    return "";
  }

  function optionGroups(source) {
    const numbered = [...source.matchAll(numberedLine)];
    const options = [];
    for (let i = 0; i + 1 < numbered.length; i++) {
      if (Number(numbered[i][2]) !== 1 || Number(numbered[i + 1][2]) !== 2) continue;
      let last = i + 1;
      while (last + 1 < numbered.length && Number(numbered[last + 1][2]) === Number(numbered[last][2]) + 1) last++;
      for (let j = i; j <= last; j++) {
        const start = numbered[j].index + numbered[j][1].length;
        const endLimit = numbered[j + 1]?.index ?? source.length;
        let end = endLimit;
        if (j === last) {
          const tail = source.slice(start, endLimit);
          for (const gap of tail.matchAll(/\n[ \t]*\n/g)) {
            const next = tail.slice(gap.index + gap[0].length).trimStart();
            if (/^(?:成功|失败|平局|若|如果|否则|查看|前往|转至|跳至|继续阅读|获得|失去|放置|标记)/.test(next)) continue;
            end = start + gap.index;
            break;
          }
        }
        end = start + source.slice(start, end).trimEnd().length;
        options.push({ start, end, number: numbered[j][2] });
      }
      i = last;
    }
    return options;
  }

  function wrapRanges(scope, findRanges, makeCard) {
    const blocks = "address, article, aside, blockquote, div, dl, figure, h1, h2, h3, h4, hr, ol, p, section, table, ul";
    let run = [];

    function process() {
      if (!run.length) return;
      const nodes = [];
      for (const node of run) {
        if (node.nodeType === Node.TEXT_NODE) nodes.push(node);
        else {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text; text = walker.nextNode()) nodes.push(text);
        }
      }
      let source = "";
      const segments = nodes.filter(node => node.length).map(node => {
        const start = source.length;
        source += node.data;
        return { node, start, end: source.length };
      });
      const position = (offset, atStart) => {
        const segment = segments.find(part => atStart ? part.end > offset : part.end >= offset);
        return [segment.node, offset - segment.start];
      };
      for (const item of findRanges(source).reverse()) {
        const { start, end } = item;
        const range = document.createRange();
        range.setStart(...position(start, true));
        range.setEnd(...position(end, false));
        const card = makeCard(item);
        card.append(range.extractContents());
        range.insertNode(card);
      }
      run = [];
    }

    for (const node of [...scope.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches(blocks + ", " + inlineSkip)) process();
      else run.push(node);
    }
    process();
  }

  const outcomeMarker = /(^|[\n。！？；])[ \t　]*(?:([0-9０-９]{1,2}(?:[ \t　]*(?:[-–—~～－至到][ \t　]*[0-9０-９]{1,2}|[+＋]))?)[ \t　]*(?:人|名|位)?[ \t　]*)?(成功|失败)[：:]/g;

  function outcomeRanges(source) {
    const markers = [...source.matchAll(outcomeMarker)];
    return markers.map((marker, index) => {
      const start = marker.index + marker[1].length;
      let end = markers[index + 1]?.index ?? source.length;
      if (markers[index + 1]?.[1] && markers[index + 1][1] !== "\n") end++;
      const text = source.slice(start, end);
      const separator = text.search(/\n[ \t　]*\n/);
      if (separator >= 0) end = start + separator;
      const count = marker[2]?.normalize("NFKC").replace(/[\s　]/g, "").replace(/[-–—~至到]/g, "–");
      return {
        start, end: start + source.slice(start, end).trimEnd().length,
        kind: marker[3] === "成功" ? "success" : "failure",
        count,
        headingLength: marker[0].length - marker[1].length
      };
    });
  }

  function decorate(root) {
    const scope = root.querySelector(":scope > .story-html") ?? root;
    if (!root.querySelector(".story-choice-card")) {
      wrapRanges(scope, optionGroups, ({ number }) => {
        const card = document.createElement("div");
        card.className = "story-choice-card";
        card.dataset.option = number;
        return card;
      });
    }
    if (!root.querySelector(".story-outcome")) {
      const containers = [scope, ...scope.querySelectorAll("p, li, td, blockquote, .story-choice-card, .battle-block")];
      for (const container of containers) {
        if (container.closest(inlineSkip)) continue;
        wrapRanges(container, outcomeRanges, ({ kind, count, headingLength }) => {
          const card = document.createElement("span");
          card.className = "story-outcome";
          card.dataset.storyOutcome = kind;
          if (count) card.dataset.outcomeCount = count;
          card.dataset.outcomeHeadingLength = String(headingLength);
          return card;
        });
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const blocks = new Map();
    const skipped = "button, select, input, .story-rule-mark, .story-outcome, " + inlineSkip;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (element.closest(skipped)) continue;
      const block = element.closest("p, li, td, th, h3, h4, blockquote, .story-choice-card, .battle-block, .story-text, .story-body");
      const key = block && root.contains(block) ? block : element;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(node);
    }
    for (const nodes of blocks.values()) {
      const source = nodes.map(node => node.data).join("");
      let afterCheck = false;
      const marks = [...source.matchAll(sentence)].flatMap(match => {
        const kind = classify(match[0], afterCheck);
        afterCheck = kind === "check";
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
          if (offset + left === start) mark.dataset.ruleStart = "";
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

  function cleanNarration(text) {
    return text
      .replace(numberedLine, "$1")
      .replace(/(?:查看|前往|转至|跳至|继续阅读)\s*(?=[。！？；]|$)/g, "")
      .trim();
  }

  function narrationPlan(root) {
    const plan = [];
    let text = "";
    let group;
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.data;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches(inlineSkip + ", .story-rule-mark, button, select, input")) {
        if (node.matches('.story-rule-mark[data-rule-kind="check"]')) group = undefined;
        text += " ";
        return;
      }
      if (node.matches(".story-outcome")) {
        const prose = cleanNarration(text);
        if (prose) {
          plan.push(prose);
          group = undefined;
        }
        text = "";
        const { storyOutcome: kind, outcomeCount: count, outcomeHeadingLength } = node.dataset;
        if (!group || Boolean(group[0].count) !== Boolean(count) ||
            group.some(option => option.kind === kind && option.count === count)) {
          group = [];
          plan.push(group);
        }
        const result = kind === "success" ? "成功" : "失败";
        const countLabel = count?.replace(/\+$/, "人及以上").replace(/^([\d–]+)$/, "$1 人");
        const label = count ? countLabel + result : "读" + result;
        const speech = count
          ? countLabel.replace(/–/g, "到") + result + "：" + node.textContent.slice(Number(outcomeHeadingLength)).trim()
          : node.textContent.trim();
        group.push({ kind, count, label, speech });
        return;
      }
      const blockBreak = node.matches("p, br, li, blockquote, .story-choice-card");
      if (blockBreak) text += "\n";
      for (const child of node.childNodes) visit(child);
      if (blockBreak) text += "\n";
    }
    for (const child of root.childNodes) visit(child);
    const ending = cleanNarration(text);
    if (ending) plan.push(ending);
    return plan;
  }

  let activeNarration;

  function cancelNarration() {
    activeNarration?.abort();
  }

  function chooseOutcome(options, signal, individualFailure = false) {
    const dialog = document.createElement("dialog");
    dialog.className = "story-narration-choice";
    dialog.setAttribute("aria-labelledby", "story-narration-choice-title");
    dialog.innerHTML = '<form method="dialog"><h2 id="story-narration-choice-title">选择检定结果</h2>'
      + '<p>朗读已暂停。接下来要读哪一项？</p><div class="story-narration-actions"></div></form>';
    if (options.every(option => option.kind === "success" && option.count)) {
      dialog.querySelector("h2").textContent = "选择成功人数";
    } else if (individualFailure) {
      dialog.querySelector("h2").textContent = "个人检定失败";
    }
    const actions = dialog.querySelector(".story-narration-actions");
    const buttons = options.map((option, index) => ({
      value: String(index), kind: option.count ? "count" : option.kind,
      label: individualFailure ? "读个人失败" : option.label
    }));
    buttons.push({ value: "skip", label: options.length > 1 ? "都跳过" : "跳过" });
    for (const { value, kind, label } of buttons) {
      const button = document.createElement("button");
      button.type = "submit";
      button.value = value;
      if (kind) button.dataset.kind = kind;
      button.textContent = label;
      actions.append(button);
    }
    return new Promise(resolve => {
      const abort = () => dialog.close("");
      signal.addEventListener("abort", abort, { once: true });
      dialog.addEventListener("close", () => {
        signal.removeEventListener("abort", abort);
        resolve(signal.aborted ? "" : dialog.returnValue);
        dialog.remove();
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  async function playNarration(plan, speak) {
    cancelNarration();
    const session = new AbortController();
    activeNarration = session;
    try {
      for (const [index, part] of plan.entries()) {
        if (session.signal.aborted) return;
        if (typeof part === "string") {
          if (!await speak(part)) return;
          continue;
        }
        const next = plan[index + 1];
        const individualFailure = part.length === 1 && part[0].kind === "failure" &&
          !part[0].count && Array.isArray(next) && next.every(option => option.count);
        const choice = await chooseOutcome(part, session.signal, individualFailure);
        if (!choice || session.signal.aborted) return;
        if (choice !== "skip") {
          const selected = part[Number(choice)];
          if (!selected || !await speak(selected.speech)) return;
        }
      }
    } finally {
      if (activeNarration === session) activeNarration = undefined;
    }
  }

  window.ATO_STORY_RULE_HIGHLIGHTS = { decorate, narrationPlan, playNarration, cancelNarration };
})();
