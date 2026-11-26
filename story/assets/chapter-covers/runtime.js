(() => {
  const directory = new URL("../story/assets/chapter-covers/", document.baseURI);
  const selections = new WeakMap();
  const images = new Map();
  let manifest;

  function loadManifest() {
    return manifest ||= fetch(new URL("manifest.json", directory))
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
  }

  function loadImage(url) {
    if (!images.has(url)) {
      const image = new Image();
      image.src = url;
      images.set(url, image.decode().then(() => true, () => false));
    }
    return images.get(url);
  }

  async function apply(target, cycle, chapterKey) {
    if (!target) return;
    const key = /^c[1-5]$/.test(cycle) && /^[a-z0-9-]+$/.test(chapterKey)
      ? `${cycle}/${chapterKey}` : "";
    if (selections.get(target)?.key === key) return;
    const selection = { key };
    selections.set(target, selection);
    target.classList.remove("has-chapter-cover");
    target.style.removeProperty("--chapter-cover-image");
    target.style.removeProperty("--chapter-cover-anchor");
    if (!key) return;

    const covers = (await loadManifest())?.cycles?.[cycle];
    const cover = covers && Object.hasOwn(covers, chapterKey) ? covers[chapterKey] : null;
    if (!cover || !/^c[1-5]\/[a-z0-9-]+\.(?:jpg|webp)$/.test(cover.image)) return;
    const url = new URL(cover.image, directory).href;
    if (selections.get(target) !== selection || !await loadImage(url) || selections.get(target) !== selection) return;
    const anchor = /^\d{1,3}% \d{1,3}%$/.test(cover.anchor) ? cover.anchor : "50% 50%";
    target.style.setProperty("--chapter-cover-image", `url(${JSON.stringify(url)})`);
    target.style.setProperty("--chapter-cover-anchor", anchor);
    target.classList.add("has-chapter-cover");
  }

  function showEntryId(title, id) {
    // Named openings use internal slugs for IDs. Only printed paragraph identifiers belong on the cover.
    if (typeof id !== "string" || !/^(?:\d+(?:[-.]\d+)*[a-z]?|[α-ω])$/i.test(id)) return false;
    const prefix = title.trimStart();
    return !prefix.startsWith(id) || !/^(?:$|[\s｜|：:·（）()—–-])/.test(prefix.slice(id.length));
  }

  window.ATO_STORY_CHAPTER_COVERS = { apply, showEntryId };
})();
