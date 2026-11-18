(() => {
  function open(authorizeAccess) {
    let access;
    const books = new Map();

    async function authorize() {
      const result = await authorizeAccess();
      if (!/^[a-f0-9]{20}$/.test(result.version) || !/^[A-Za-z0-9+/]{43}=$/.test(result.key)) {
        throw new Error('线上故事库配置无效。');
      }
      const rawKey = Uint8Array.from(atob(result.key), char => char.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      return { key, version: result.version, cycle: result.cycle, language: result.language, phase: result.phase, current: result.current, projection: result.projection };
    }

    function ready() {
      access ||= authorize().catch(error => { access = null; throw error; });
      return access;
    }

    async function fetchBytes(path, timeout) {
      const response = await fetch(path, {
        signal: AbortSignal.timeout(timeout), credentials: 'omit', cache: 'force-cache',
      });
      if (!response.ok) {
        const error = new Error('线上故事正文暂时无法读取。');
        error.status = response.status;
        throw error;
      }
      return new Uint8Array(await response.arrayBuffer());
    }

    async function fetchParts(base, placeholders, cycle) {
      const count = placeholders.parts[cycle];
      const parts = Array(count);
      let next = 0;
      async function read() {
        while (next < count) {
          const part = next++;
          const url = base + cycle + '-' + part + '.bin';
          try { parts[part] = await fetchBytes(url, 20000); }
          catch (error) {
            if (error.status === 404) throw error;
            parts[part] = await fetchBytes(url, 30000);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(count, 4) }, read));
      const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      return bytes;
    }

    async function fetchBook(cycle) {
      const { key, version } = await ready();
      const base = './library/' + version + '/';
      const parts = window.ATO_STORY_PARTS;
      const encrypted = parts?.version === version && parts.parts[cycle]
        ? await fetchParts(base, parts, cycle)
        : await fetchBytes(base + cycle + '.bin', 90000);
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
