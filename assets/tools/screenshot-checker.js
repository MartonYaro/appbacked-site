// App Store and Google Play screenshot size checker. Runs in the browser; files never leave the device.
(function () {
  const drop = document.getElementById('sc-drop');
  const input = document.getElementById('sc-input');
  const out = document.getElementById('sc-out');
  if (!drop || !input || !out) return;

  // Apple's accepted sizes (portrait; landscape is the swap where Apple accepts it). Source: Apple screenshot specifications.
  const P = (w, h, cls, dev, key) => ({ w, h, cls, dev, key: key || null, rot: true });
  const L = (w, h, cls, dev) => ({ w, h, cls, dev, key: null, rot: false });
  const APPLE = [
    P(1320, 2868, 'iPhone · Dynamic Island, large', '6.9-inch', 'large'),
    P(1290, 2796, 'iPhone · Dynamic Island, large', '6.7-inch', 'large'),
    P(1260, 2736, 'iPhone · Dynamic Island, large', 'iPhone Air', 'large'),
    P(1284, 2778, 'iPhone · Face ID, large', '6.5-inch', 'large'),
    P(1242, 2688, 'iPhone · Face ID, large', '6.5-inch', 'large'),
    P(1206, 2622, 'iPhone · Dynamic Island, medium', '6.3-inch', 'medium'),
    P(1179, 2556, 'iPhone · Dynamic Island, medium', '6.1-inch'),
    P(1170, 2532, 'iPhone · Face ID, medium', '6.1-inch'),
    P(1125, 2436, 'iPhone · Face ID, medium', '5.8-inch'),
    P(1080, 2340, 'iPhone · Face ID, medium', '5.4-inch'),
    P(1242, 2208, 'iPhone · Home Button, large', '5.5-inch'),
    P(750, 1334, 'iPhone · Home Button, medium', '4.7-inch'),
    P(640, 1136, 'iPhone · Home Button, 4"', '4-inch'),
    P(640, 1096, 'iPhone · Home Button, 4" (no status bar)', '4-inch'),
    P(640, 960, 'iPhone · Home Button, 3.5"', '3.5-inch'),
    P(640, 920, 'iPhone · Home Button, 3.5" (no status bar)', '3.5-inch'),
    P(1398, 2034, 'iPhone Duo · outer display', 'iPhone Duo'),
    P(2007, 2853, 'iPhone Duo · inner display', 'iPhone Duo'),
    P(2064, 2752, 'iPad · 13-inch', '13-inch', 'ipad'),
    P(2048, 2732, 'iPad · 13-inch / 12.9-inch', '13-inch, 12.9-inch', 'ipad'),
    P(1668, 2420, 'iPad · 11-inch', '11-inch'),
    P(1668, 2388, 'iPad · 11-inch', '11-inch'),
    P(1640, 2360, 'iPad · 11-inch', '11-inch'),
    P(1488, 2266, 'iPad · 11-inch', '11-inch'),
    P(1668, 2224, 'iPad · 10.5-inch', '10.5-inch'),
    P(1536, 2048, 'iPad · 9.7-inch', '9.7-inch'),
    P(768, 1024, 'iPad · 9.7-inch', '9.7-inch'),
    L(1280, 800, 'Mac', '16:10'), L(1440, 900, 'Mac', '16:10'), L(2560, 1600, 'Mac', '16:10'), L(2880, 1800, 'Mac', '16:10'),
    L(1920, 1080, 'Apple TV', 'HD'), L(3840, 2160, 'Apple TV / Apple Vision Pro', '4K'),
    L(422, 514, 'Apple Watch', 'Ultra 4, Ultra 3'), L(410, 502, 'Apple Watch', 'Ultra 2, Ultra'), L(416, 496, 'Apple Watch', 'Series 10–12'),
    L(396, 484, 'Apple Watch', 'Series 7–9'), L(368, 448, 'Apple Watch', 'Series 4–6, SE'), L(312, 390, 'Apple Watch', 'Series 1–3'),
  ];

  function appleMatches(w, h) {
    const res = [];
    for (const s of APPLE) {
      if (s.w === w && s.h === h) res.push({ s, land: false });
      else if (s.rot && s.w === h && s.h === w) res.push({ s, land: true });
    }
    return res;
  }
  function nearestApple(w, h) {
    let best = null;
    for (const s of APPLE) {
      for (const [a, b, land] of [[s.w, s.h, false], [s.h, s.w, true]]) {
        if (land && !s.rot) continue;
        const d = Math.abs(a - w) + Math.abs(b - h);
        if (!best || d < best.d) best = { s, land, d, a, b };
      }
    }
    return best;
  }
  function play(w, h) {
    const short = Math.min(w, h), long = Math.max(w, h);
    const ok = short >= 320 && long <= 3840 && long <= 2 * short;
    const r = long / short;
    const ratio169 = Math.abs(r - 16 / 9) < 0.01;
    const promo = ok && ratio169 && short >= 1080;
    return { ok, promo, ratio169 };
  }

  // PNG: colour type 4 or 6 = alpha channel; a tRNS chunk = transparency. Apple rejects both.
  function pngAlpha(buf) {
    const b = new Uint8Array(buf);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!sig.every((v, i) => b[i] === v)) return null;
    const colorType = b[25];
    if (colorType === 4 || colorType === 6) return 'alpha channel';
    let p = 8;
    const dv = new DataView(buf);
    while (p + 8 <= b.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'tRNS') return 'transparency (tRNS)';
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    return '';
  }
  function dims(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { reject(new Error('not an image')); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function check(files) {
    const rows = [];
    const have = { large: false, medium: false, ipad: false, playPromo: 0 };
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const fmtOk = ['png', 'jpg', 'jpeg'].includes(ext) || ['image/png', 'image/jpeg'].includes(f.type);
      let d;
      try { d = await dims(f); } catch (e) { rows.push({ f, err: 'Not a readable image' }); continue; }
      let alpha = '';
      if (ext === 'png' || f.type === 'image/png') { try { alpha = pngAlpha(await f.slice(0, 1 << 20).arrayBuffer()) || ''; } catch (e) { alpha = ''; } }
      const m = appleMatches(d.w, d.h);
      const clean = fmtOk && !alpha;
      if (clean) m.forEach(x => { if (x.s.key) have[x.s.key] = true; });
      const g = play(d.w, d.h);
      if (g.promo && clean) have.playPromo++;
      rows.push({ f, d, fmtOk, alpha, m, near: m.length ? null : nearestApple(d.w, d.h), g });
    }
    render(rows, have, files.length);
  }

  function render(rows, have, n) {
    const chip = (ok, text) => `<span class="chip ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${esc(text)}</span>`;
    const sum = `<div class="tool-sum">
      ${chip(have.large, 'iPhone large (6.9″ or 6.5″)')}
      ${chip(have.medium, 'iPhone 6.3″ (Dynamic Island, medium)')}
      ${chip(have.ipad, 'iPad 13″ (only if your app runs on iPad)')}
      ${chip(have.playPromo >= 4, `Google Play promotion: ${have.playPromo} of 4 frames`)}
    </div>`;
    const body = rows.map(r => {
      if (r.err) return `<tr><td>${esc(r.f.name)}</td><td colspan="3"><span class="st no">✗ ${esc(r.err)}</span></td></tr>`;
      const issues = [];
      if (!r.fmtOk) issues.push('Use PNG or JPEG');
      if (r.alpha) issues.push(`PNG has ${r.alpha}: export without alpha`);
      let apple;
      if (r.m.length) {
        apple = r.m.map(x => `<span class="st ${issues.length ? 'no' : 'ok'}">${issues.length ? '✗' : '✓'} ${esc(x.s.cls)}</span><small>${esc(x.s.dev)}${x.land ? ' · landscape' : ''}</small>`).join('');
      } else {
        const nb = r.near;
        apple = `<span class="st no">✗ Not an accepted size</span><small>Nearest: ${nb.a} × ${nb.b} (${esc(nb.s.cls)}), off by ${Math.abs(nb.a - r.d.w)} × ${Math.abs(nb.b - r.d.h)} px</small>`;
      }
      const gp = r.g.ok
        ? `<span class="st ok">✓ Accepted</span><small>${r.g.promo ? 'Promotion-ready: 16:9 or 9:16, 1080 px+' : (r.g.ratio169 ? 'Under 1080 px on the short side: not promotion-ready' : 'Not 16:9 or 9:16: accepted, not promotion-ready')}</small>`
        : `<span class="st no">✗ Rejected</span><small>Each side 320–3,840 px, long side at most 2× the short side</small>`;
      return `<tr><td>${esc(r.f.name)}<small>${r.d.w} × ${r.d.h} px</small></td><td>${apple}</td><td>${gp}</td><td>${issues.length ? issues.map(i => `<span class="st no">${esc(i)}</span>`).join(' ') : '<span class="st ok">✓ None</span>'}</td></tr>`;
    }).join('');
    out.innerHTML = `${sum}<div class="tbl"><table><thead><tr><th>File</th><th>App Store</th><th>Google Play</th><th>File problems</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="paste-note" style="color:var(--muted)">${n} file${n === 1 ? '' : 's'} checked in your browser. Nothing was uploaded.</p>`;
    out.hidden = false;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files.length) check([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const fs = [...(e.dataTransfer && e.dataTransfer.files || [])]; if (fs.length) check(fs); });
})();
