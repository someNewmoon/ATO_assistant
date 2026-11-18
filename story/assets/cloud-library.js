(() => {
  function open(api, id, token) {
    let access;
    const books = new Map();

    async function authorize() {
      const result = await api.request(id, 'library', token, undefined, { timeout: 22000 });
      if (!/^[a-f0-9]{20}$/.test(result.version) || !/^[A-Za-z0-9+/]{43}=$/.test(result.key)) {
        throw new Error('线上故事库配置无效。');
      }
      const rawKey = Uint8Array.from(atob(result.key), char => char.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      return { key, version: result.version, cycle: result.cycle, language: result.language, phase: result.phase, current: result.current };
    }

    function ready() {
      access ||= authorize().catch(error => { access = null; throw error; });
      return access;
    }

    async function fetchBook(cycle) {
      const { key, version } = await ready();
      const response = await fetch('./library/' + version + '/' + cycle + '.bin', {
        signal: AbortSignal.timeout(90000), credentials: 'omit',
      });
      if (!response.ok) throw new Error('线上故事正文暂时无法读取。');
      const encrypted = new Uint8Array(await response.arrayBuffer());
      if (encrypted.length < 29) throw new Error('故事正文文件不完整。');
      const compressed = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: encrypted.slice(0, 12),
        additionalData: new TextEncoder().encode(version + '/' + cycle),
      }, key, encrypted.slice(12));
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const book = await new Response(stream).json();
      if (book.fan?.id !== cycle || book.official?.id !== cycle) throw new Error('线上故事集编号不符。');
      return book;
    }

    function load(cycle) {
      if (!/^c[1-5]$/.test(cycle)) throw new Error('此故事集未收录在原 EXE 正文中。');
      if (!books.has(cycle)) {
        books.set(cycle, fetchBook(cycle).catch(error => { books.delete(cycle); throw error; }));
      }
      return books.get(cycle);
    }

    return { ready, load };
  }

  window.ATO_CLOUD_STORY_LIBRARY = { open };
})();
