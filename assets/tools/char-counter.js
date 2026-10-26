// App Store and Google Play metadata character counter. Runs in the browser; nothing is sent anywhere.
(function () {
  const root = document.getElementById('cc');
  if (!root) return;
  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const chars = s => (seg ? [...seg.segment(s)].length : Array.from(s).length);
  const enc = new TextEncoder();
  const bytes = s => enc.encode(s).length;

  // Limits: Apple App Store Connect and Google Play Console help pages.
  const FIELDS = {
    apple: [
      { id: 'name', label: 'App name', max: 30, unit: 'chars', hint: 'The strongest ranking field. Brand plus one keyword.' },
      { id: 'subtitle', label: 'Subtitle', max: 30, unit: 'chars', hint: 'Indexed for search and shown under the name.' },
      { id: 'keywords', label: 'Keywords', max: 100, unit: 'bytes', hint: 'Comma-separated, no spaces needed. Counted in bytes: Japanese, Chinese and Korean use 3 bytes per character.', area: false },
      { id: 'promo', label: 'Promotional text', max: 170, unit: 'chars', hint: 'Shown above the description; can change without a new version.', area: true },
      { id: 'desc', label: 'Description', max: 4000, unit: 'chars', hint: 'Not used for App Store search, but read by people close to installing.', area: true },
      { id: 'whatsnew', label: "What's New", max: 4000, unit: 'chars', hint: 'Release notes for this version.', area: true },
    ],
    google: [
      { id: 'gname', label: 'App name', max: 30, unit: 'chars', hint: 'Google Play title limit.' },
      { id: 'gshort', label: 'Short description', max: 80, unit: 'chars', hint: 'Shown on the store listing; indexed for search.', area: true },
      { id: 'gdesc', label: 'Full description', max: 4000, unit: 'chars', hint: 'Google Play indexes it for search, so use your keywords naturally.', area: true },
    ],
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const form = root.querySelector('.cc-form');
  let platform = 'apple';
  const values = {};

  function words(s) { return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); }
  function keywordTips() {
    const kw = values.keywords || '';
    if (!kw.trim()) return '';
    const tips = [];
    const parts = kw.split(',');
    const spaces = parts.slice(1).filter(p => /^\s/.test(p)).length;
    if (spaces) tips.push(`<li class="warn">${spaces} space${spaces === 1 ? '' : 's'} after commas: ${spaces} byte${spaces === 1 ? '' : 's'} you can reuse.</li>`);
    const terms = parts.map(p => p.trim().toLowerCase()).filter(Boolean);
    const dup = terms.filter((t, i) => terms.indexOf(t) !== i);
    if (dup.length) tips.push(`<li class="warn">Repeated keywords: ${esc([...new Set(dup)].join(', '))}.</li>`);
    const inTitle = new Set([...words(values.name || ''), ...words(values.subtitle || '')]);
    const repeat = [...new Set(terms.flatMap(t => words(t)).filter(w => inTitle.has(w)))];
    if (repeat.length) tips.push(`<li class="warn">Already in the name or subtitle: ${esc(repeat.join(', '))}. Apple combines these fields, so repeating a word here wastes space.</li>`);
    const left = 100 - bytes(kw);
    tips.push(left >= 0 ? `<li>${left} byte${left === 1 ? '' : 's'} left for more keywords.</li>` : `<li class="warn">${-left} byte${left === -1 ? '' : 's'} over: App Store Connect won't save this.</li>`);
    return `<ul class="cc-tips">${tips.join('')}</ul>`;
  }
  function count(f) {
    const v = values[f.id] || '';
    return f.unit === 'bytes' ? bytes(v) : chars(v);
  }
  function updateCounter(f) {
    const el = form.querySelector(`[data-cnt="${f.id}"]`);
    const n = count(f);
    el.textContent = `${n} / ${f.max} ${f.unit === 'bytes' ? 'bytes' : 'characters'}`;
    el.classList.toggle('over', n > f.max);
    if (f.id === 'keywords' || f.id === 'name' || f.id === 'subtitle') {
      const t = form.querySelector('[data-tips="keywords"]');
      if (t) t.innerHTML = keywordTips();
    }
  }
  function draw() {
    form.innerHTML = FIELDS[platform].map(f => {
      const tag = f.area
        ? `<textarea id="cc-${f.id}" data-f="${f.id}" spellcheck="true">${esc(values[f.id] || '')}</textarea>`
        : `<input id="cc-${f.id}" data-f="${f.id}" type="text" value="${esc(values[f.id] || '')}" autocomplete="off">`;
      return `<div class="cc-field"><label for="cc-${f.id}">${esc(f.label)} <span class="cnt" data-cnt="${f.id}" aria-live="polite"></span></label>${tag}<p class="hint">${esc(f.hint)}</p>${f.id === 'keywords' ? '<div data-tips="keywords"></div>' : ''}</div>`;
    }).join('');
    FIELDS[platform].forEach(updateCounter);
  }
  form.addEventListener('input', e => {
    const id = e.target.dataset.f;
    if (!id) return;
    values[id] = e.target.value;
    const f = FIELDS[platform].find(x => x.id === id);
    if (f) updateCounter(f);
    if (id === 'name' || id === 'subtitle') updateCounter(FIELDS.apple.find(x => x.id === 'keywords'));
  });
  root.querySelectorAll('.cc-tabs button').forEach(b => b.addEventListener('click', () => {
    platform = b.dataset.p;
    root.querySelectorAll('.cc-tabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
})();
