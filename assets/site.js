/* AppBacked — shared page logic (growth-partner model). Every feature checks that its elements exist. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Deal model. TBD: every constant is a placeholder for the owner to confirm.
  // We spend our own money and team on the app's growth; the developer pays nothing upfront.
  // Revenue above the baseline (average of the last 3 months) is split 50/50 for 24 months.
  // After that, all of it is the developer's, including the users we paid for.
  // ---------------------------------------------------------------------------
  const MODEL = {
    budgetMult: 6,       // growth budget = up to 6x monthly net revenue
    min: 5000,
    max: 250000,
    split: 0.5,          // our share of revenue above the baseline
    term: 24,            // months
    after: 6,            // months shown after the term ends
    testShare: 0.1,      // month 1 test budget, on us
    spendMonths: 10,     // budget deployed over months 1-10, only while it pays back
    tau: 5,              // months for a paid cohort to earn most of its value
    scenarios: {
      cautious: { label: 'Cautious', roas: 1.3, lift: 0.10, hint: 'Ads barely pay back. Store page and paywall fixes do the work.' },
      base: { label: 'Base', roas: 2.0, lift: 0.25, hint: 'What we plan for: ads pay back in about a year, fixes lift today’s revenue by a quarter.' },
      strong: { label: 'Strong', roas: 2.8, lift: 0.40, hint: 'Ads pay back fast and the fixes land well.' },
    },
  };

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
  const round500 = n => Math.round(n / 500) * 500;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function compute(st) {
    const sc = MODEL.scenarios[st.sc] || MODEL.scenarios.base;
    const R = st.r, T = MODEL.term, H = MODEL.term + MODEL.after;
    const B = clamp(round500(R * MODEL.budgetMult), MODEL.min, MODEL.max);
    const spend = new Array(H + 1).fill(0);
    spend[1] = Math.round(B * MODEL.testShare);
    for (let m = 2; m <= MODEL.spendMonths; m++) spend[m] = (B - spend[1]) / (MODEL.spendMonths - 1);
    const c = a => sc.roas * (1 - Math.exp(-a / MODEL.tau));
    let ours = 0, yours = 0, after = 0, recoup = 0, maxTotal = 0, g24 = 0;
    const months = [];
    for (let m = 1; m <= H; m++) {
      let paid = 0;
      for (let k = 1; k <= m; k++) paid += spend[k] * (c(m - k + 1) - c(m - k));
      const lift = R * sc.lift * Math.min(1, m / 4);
      const g = paid + lift;
      const inTerm = m <= T;
      const o = inTerm ? g * MODEL.split : 0;
      if (inTerm) { ours += o; yours += g - o; if (!recoup && ours >= B) recoup = m; if (m === T) g24 = g; } else after += g;
      months.push({ m, base: R, yours: g - o, ours: o, after: !inTerm, spend: spend[m] });
      maxTotal = Math.max(maxTotal, R + g);
    }
    return { B, test: spend[1], ours, yours, after, recoup, months, maxTotal, ret: ours / B, rev24: R + g24, mult: (R + g24) / R, sc };
  }
  window.AppBackedModel = { MODEL, compute };

  // number tween
  const shown = new WeakMap();
  function money(el, v) {
    if (!el) return;
    const from = shown.has(el) ? shown.get(el) : v;
    shown.set(el, v);
    if (reduce || from === v) { el.textContent = fmt(v); return; }
    const t0 = performance.now(), d = 520;
    const tick = now => {
      if (shown.get(el) !== v) return;
      const p = Math.min(1, (now - t0) / d), k = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (v - from) * k);
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(v);
    };
    requestAnimationFrame(tick);
    setTimeout(() => { if (shown.get(el) === v) el.textContent = fmt(v); }, d + 80);
  }
  function fillRange(el) { if (el) el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }

  function chart(host, o) {
    const bars = host.children;
    while (bars.length > o.months.length) host.lastChild.remove();
    o.months.forEach((mo, i) => {
      let b = bars[i];
      if (!b) { b = document.createElement('div'); b.className = 'b'; b.innerHTML = '<i class="base"></i><i class="yours"></i><i class="ours"></i>'; host.appendChild(b); }
      const total = mo.base + mo.yours + mo.ours;
      b.style.height = (total / o.maxTotal * 100) + '%';
      b.children[0].style.height = (mo.base / total * 100) + '%';
      b.children[1].style.height = (mo.yours / total * 100) + '%';
      b.children[2].style.height = (mo.ours / total * 100) + '%';
      b.classList.toggle('after', mo.after);
      b.classList.toggle('spend', mo.spend > 0);
      b.title = `Month ${mo.m}: today's revenue ${fmt(mo.base)}, your growth ${fmt(mo.yours)}, our share ${fmt(mo.ours)}${mo.spend ? `, our spend ${fmt(mo.spend)}` : ''}`;
    });
  }
  function verdictHtml(o) {
    if (o.recoup) return `We earn back our ${fmt(o.B)} in month ${o.recoup}. By month 24 you've made <b>${fmt(o.yours)} you didn't have</b>, and the users we paid for keep paying you after we leave.`;
    return `In this scenario we never earn back our ${fmt(o.B)}. <b>That's our risk, not yours.</b> You still keep ${fmt(o.yours)} of new revenue and every user we paid for.`;
  }

  // ---------------------------------------------------------------------------
  // state (URL shareable, also hands the estimate from the calculator to /apply/)
  // ---------------------------------------------------------------------------
  const q = new URLSearchParams(location.search);
  const st = {
    r: clamp(+q.get('r') || 8000, 1000, 100000),
    sc: MODEL.scenarios[q.get('sc')] ? q.get('sc') : 'base',
    app: null,
  };
  function stateParams() {
    const p = { r: st.r, sc: st.sc };
    if (st.app && st.app.id) p.app = st.app.id;
    return new URLSearchParams(p).toString();
  }

  // ---------------------------------------------------------------------------
  // render everything that exists on this page
  // ---------------------------------------------------------------------------
  const el = {
    r: $('#c-r'), rOut: $('#c-r-out'), chart: $('#chart'), verdict: $('#verdict'), hint: $('#sc-hint'),
    hr: $('#offer-r'), hrOut: $('#offer-r-out'), dock: $('#dock-num'),
  };

  function render() {
    const o = compute(st);
    $$('[data-sc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sc === st.sc)));
    if (el.hint) el.hint.textContent = o.sc.hint;
    if (el.r) el.r.value = st.r;
    if (el.hr) el.hr.value = st.r;
    [el.r, el.hr].forEach(fillRange);
    if (el.rOut) el.rOut.textContent = fmt(st.r);
    if (el.hrOut) el.hrOut.textContent = fmt(st.r);
    $$('[data-money="budget"]').forEach(n => money(n, o.B));
    $$('[data-money="yours"]').forEach(n => money(n, o.yours));
    $$('[data-money="rev24"]').forEach(n => money(n, o.rev24));
    $$('[data-out]').forEach(n => {
      const v = {
        budget: fmt(o.B), yours: fmt(o.yours), ours: fmt(o.ours), ret: o.ret.toFixed(2) + '×', rev24: fmt(o.rev24),
        mult: '×' + o.mult.toFixed(2), recoup: o.recoup ? 'Month ' + o.recoup : 'Not in 24 months', test: fmt(o.test),
        after: fmt(o.after), revenue: fmt(st.r), scenario: o.sc.label,
      }[n.dataset.out];
      if (v != null) n.textContent = v;
    });
    if (el.chart) chart(el.chart, o);
    if (el.verdict) el.verdict.innerHTML = verdictHtml(o);
    if (el.dock && (el.r || el.hr)) el.dock.textContent = 'Up to ' + fmt(o.B) + ' growth budget';
    $$('[data-apply-url]').forEach(a => { a.href = a.dataset.applyUrl + '?' + stateParams(); });
    $$('[data-keep-state]').forEach(a => { a.href = a.getAttribute('href').split('?')[0] + '?' + stateParams() + '#share-card'; });
    const est = $('#a-est');
    if (est) est.value = JSON.stringify({ revenue: st.r, budget: o.B, scenario: st.sc, app: st.app && st.app.name });
    const rev = $('#a-rev');
    if (rev && !rev.dataset.touched && (q.has('r') || st.touched)) rev.value = st.r < 3000 ? '$1k–3k' : st.r < 10000 ? '$3k–10k' : st.r < 30000 ? '$10k–30k' : st.r < 100000 ? '$30k–100k' : '$100k+';
  }

  $$('[data-sc]').forEach(b => b.addEventListener('click', () => { st.sc = b.dataset.sc; render(); }));
  el.r && el.r.addEventListener('input', () => { st.r = +el.r.value; st.touched = true; render(); });
  el.hr && el.hr.addEventListener('input', () => { st.r = +el.hr.value; st.touched = true; render(); });
  const revSel = $('#a-rev'); revSel && revSel.addEventListener('change', () => { revSel.dataset.touched = '1'; });

  const shareBtn = $('#share');
  shareBtn && shareBtn.addEventListener('click', async () => {
    const u = new URL(location.href);
    u.search = stateParams(); u.hash = '';
    try { await navigator.clipboard.writeText(u.toString()); shareBtn.textContent = 'Link copied'; }
    catch (_) { shareBtn.textContent = 'Copy failed. Use the address bar.'; history.replaceState(null, '', u); }
    setTimeout(() => { shareBtn.textContent = 'Copy link to this estimate'; }, 2200);
  });

  render();

  // ---------------------------------------------------------------------------
  // scenario cards (How it works): same app, three futures
  // ---------------------------------------------------------------------------
  $$('[data-scenario]').forEach(box => {
    const o = compute({ r: 10000, sc: box.dataset.scenario });
    const host = $('.chart', box); if (host) chart(host, o);
    const v = $('.scn-verdict', box); if (v) v.innerHTML = verdictHtml(o);
    const f = $('.scn-f', box); if (f) f.textContent = fmt(o.B);
    const p = $('.scn-p', box); if (p) p.textContent = fmt(o.yours);
  });

  // ---------------------------------------------------------------------------
  // app lookup (App Store via the public iTunes API, Google Play by package id)
  // ---------------------------------------------------------------------------
  const note = $('#paste-note');
  const pasteIn = $('#paste-in');
  const ratingsFmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

  async function lookup(raw) {
    const s = raw.trim();
    if (!s) throw new Error('empty');
    const ios = s.match(/(?:apps|itunes)\.apple\.com\/(?:([a-z]{2})\/)?.*?id(\d{6,})/i) || (/^\d{6,}$/.test(s) ? [s, 'us', s] : null);
    if (ios) {
      const cc = (ios[1] || 'us').toLowerCase();
      const r = await fetch(`https://itunes.apple.com/lookup?id=${ios[2]}&country=${cc}`).then(x => x.json());
      if (!r.results || !r.results[0]) throw new Error('notfound');
      return fromItunes(r.results[0]);
    }
    const gp = s.match(/play\.google\.com\/store\/apps\/details\?(?:.*&)?id=([\w.]+)/i) || s.match(/^gp:([\w.]+)$/);
    if (gp) {
      const pkg = gp[1];
      return { id: 'gp:' + pkg, store: 'play', name: pkg, sub: 'Google Play · reviewed by hand', icon: null, url: `https://play.google.com/store/apps/details?id=${pkg}`, raw: null };
    }
    if (/^https?:\/\//i.test(s)) throw new Error('badurl');
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(s)}&entity=software&limit=8&country=us`).then(x => x.json());
    const res = r.results || [];
    if (!res.length) throw new Error('notfound');
    // the search API always returns something; trust it only when the name matches what was typed
    const norm = t => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
    const qn = norm(s), words = qn.split(' ').filter(w => w.length > 1);
    const fit = a => { const n = norm(a.trackName || ''); return n === qn ? 3 : n.includes(qn) ? 2 : words.length && words.every(w => n.includes(w)) ? 1 : 0; };
    const ranked = res.map(a => [fit(a), a]).sort((x, y) => y[0] - x[0]);
    if (ranked[0][0] > 0) return fromItunes(ranked[0][1]);
    const near = res.filter(a => norm(a.trackName || '').split(' ').some(w => words.some(q => q.length > 2 && w.slice(0, 3) === q.slice(0, 3))));
    if (!near.length) throw new Error('notfound');
    const err = new Error('ambiguous');
    err.candidates = near.slice(0, 3).map(a => ({ id: String(a.trackId), name: a.trackName, icon: a.artworkUrl60 || a.artworkUrl100 }));
    throw err;
  }
  function fromItunes(a) {
    const rating = a.averageUserRating ? '★ ' + a.averageUserRating.toFixed(1) + ' · ' + ratingsFmt(a.userRatingCount || 0) + ' ratings' : a.primaryGenreName;
    return { id: String(a.trackId), store: 'ios', name: a.trackName, seller: a.sellerName, sub: `${a.sellerName} · ${rating}`, icon: a.artworkUrl512 || a.artworkUrl100, url: a.trackViewUrl && a.trackViewUrl.split('?')[0], genre: a.primaryGenreName, raw: a };
  }
  window.ABLookup = lookup; // shared with assets/audit.js
  // "Did you mean" buttons under a search field when a name search has no exact match
  window.ABPick = (noteEl, list, onPick) => {
    noteEl.classList.remove('err');
    noteEl.textContent = 'No exact match. Did you mean ';
    list.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pick'; b.textContent = c.name;
      b.addEventListener('click', () => onPick(c.id));
      noteEl.appendChild(b);
    });
  };

  // ---------------------------------------------------------------------------
  // Growth X-ray: honest signals from public store data, phrased as levers
  // ---------------------------------------------------------------------------
  function xray(app) {
    const a = app.raw;
    if (!a) return { score: 'Manual', items: [{ up: true, t: 'Google Play listing', d: 'We review Play listings by hand. You get the X-ray with your growth plan within 48 hours.' }] };
    const items = [];
    const langs = (a.languageCodesISO2A || []).length;
    items.push(langs <= 3 ? { up: true, t: `${langs} language${langs === 1 ? '' : 's'}`, d: 'Localized store pages are usually the cheapest growth there is.' }
      : langs < 10 ? { up: true, t: `${langs} languages`, d: 'Room to localize into more of the markets that already find you.' }
        : { up: false, t: `${langs} languages`, d: 'Well localized. Growth comes from conversion and pricing.' });
    const shots = (a.screenshotUrls || []).length;
    items.push(shots < 6 ? { up: true, t: `${shots} screenshot${shots === 1 ? '' : 's'}`, d: 'Most top apps show 6 to 10. The gallery sells the install.' }
      : { up: false, t: `${shots} screenshots`, d: 'Full gallery. We would test what the first three say.' });
    const ipad = (a.features || []).includes('iosUniversal');
    if (ipad && !(a.ipadScreenshotUrls || []).length) items.push({ up: true, t: 'No iPad gallery', d: 'Your app runs on iPad, but iPad users see no screenshots.' });
    const days = a.currentVersionReleaseDate ? Math.round((Date.now() - new Date(a.currentVersionReleaseDate)) / 864e5) : null;
    const ago = days === 0 ? 'Updated today' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
    if (days != null) items.push(days > 120 ? { up: true, t: ago, d: 'Fresh releases help ranking and conversion. Users notice.' }
      : { up: false, t: ago, d: 'Shipping regularly. Good.' });
    const r = a.averageUserRating || 0, n = a.userRatingCount || 0;
    if (n < 500) items.push({ up: true, t: `${ratingsFmt(n)} ratings`, d: 'A well-timed review prompt builds the social proof that converts.' });
    else if (r < 4.5) items.push({ up: true, t: `Rated ${r.toFixed(1)}`, d: 'Below 4.5 stars costs installs. Prompt timing and fixes move it.' });
    else items.push({ up: false, t: `Rated ${r.toFixed(1)} · ${ratingsFmt(n)}`, d: 'Strong social proof to build on.' });
    if (a.price > 0) items.push({ up: true, t: `Paid upfront · ${a.formattedPrice}`, d: 'A free trial with a subscription usually earns more per user.' });
    const ups = items.filter(i => i.up).length;
    const score = ups >= 3 ? 'High' : ups >= 1 ? 'Medium' : 'Low';
    items.sort((x, y) => (y.up ? 1 : 0) - (x.up ? 1 : 0));
    return { score, items: items.slice(0, 5) };
  }
  function showXray(app) {
    const box = $('#xray');
    if (!box) return;
    const x = xray(app);
    $('#xray-name').textContent = app.name;
    const sc = $('#xray-score');
    sc.textContent = x.score === 'Manual' ? 'Manual review' : x.score === 'Low' ? 'Strong page' : 'Upside: ' + x.score;
    sc.dataset.score = x.score.toLowerCase();
    const list = $('#xray-list');
    list.innerHTML = '';
    x.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = it.up ? 'up' : 'ok';
      li.style.setProperty('--d', (i * 0.12) + 's');
      li.innerHTML = '<b></b><span></span>';
      li.children[0].textContent = it.t;
      li.children[1].textContent = it.d;
      list.appendChild(li);
    });
    box.hidden = false;
    box.classList.remove('run'); void box.offsetWidth; box.classList.add('run');
    const more = $('#xray-more'); if (more && app.store === 'ios') more.href = more.getAttribute('href').split('?')[0] + '?app=' + encodeURIComponent(app.id);
    const trust = $('.hero .trust'); if (trust) trust.hidden = true;
    const xm = $('#xray-mail');
    if (xm) {
      xm.classList.remove('sent');
      const msg = $('#xm-msg'); if (msg) msg.hidden = true;
      const h = $('#xm-h'); if (h) h.firstChild.textContent = app.store === 'play' ? 'We review Google Play listings by hand. Where should we send the X-ray and a growth plan for ' : 'Get the full report and a growth plan for ';
    }
  }

  // X-ray: email the report right under the result (same endpoint as the apply form, with consent)
  const xmForm = $('#xray-mail');
  xmForm && xmForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (xmForm.website && xmForm.website.value) return;
    const email = $('#xm-email'), ok = $('#xm-ok'), msg = $('#xm-msg'), btn = $('button[type=submit]', xmForm);
    const good = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value.trim());
    email.parentElement.classList.toggle('bad', !good);
    if (!good) { email.focus(); return; }
    if (!ok.checked) { ok.focus(); ok.parentElement.style.color = '#FFB4A8'; return; }
    if (!st.app) return;
    const band = !st.touched ? '' : st.r < 1000 ? 'Under $1k' : st.r < 3000 ? '$1k–3k' : st.r < 10000 ? '$3k–10k' : st.r < 30000 ? '$10k–30k' : '$30k+';
    btn.disabled = true; msg.hidden = true; msg.classList.remove('err');
    try {
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'audit', source: 'xray', link: st.app.url, platform: st.app.store === 'play' ? 'Android' : 'iOS', revenue: band, contact: email.value.trim(), consent: 'yes' }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok || res.delivered === false) throw new Error(res.error || r.status);
      xmForm.classList.add('sent');
      msg.textContent = 'Sent. Check your inbox. If the app fits what we do, a growth plan follows within 48 hours.';
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = 'Could not send. Try again or write to hello@appbacked.com';
    } finally { msg.hidden = false; btn.disabled = false; }
  });
  $('#xm-ok') && $('#xm-ok').addEventListener('change', e => { e.target.parentElement.style.color = ''; });

  function showApp(app) {
    st.app = app;
    $$('[data-app-name]').forEach(n => { n.textContent = app.name; });
    $$('[data-app-sub]').forEach(n => { n.textContent = app.sub; });
    $$('[data-app-icon]').forEach(ic => {
      if (app.icon) { ic.innerHTML = ''; const im = new Image(); im.alt = ''; im.crossOrigin = 'anonymous'; im.src = app.icon; ic.appendChild(im); }
      else ic.innerHTML = `<span style="color:#fff;font-weight:800;font-size:20px">${app.name.charAt(0)}</span>`;
    });
    const chip = $('#offer .chip'); if (chip) chip.textContent = app.genre ? app.genre : 'Estimate';
    const link = $('#a-link'); if (link && app.url) link.value = app.url;
    const pf = $('#a-platform'); if (pf) pf.value = app.store === 'play' ? 'Android' : 'iOS';
    if (note) { note.classList.remove('err'); note.textContent = app.store === 'play' ? 'Got your Google Play link. We review Play listings by hand and send the X-ray with your plan.' : `Scanned ${app.name}. Slide to your monthly net revenue to size the budget.`; }
    showXray(app);
    const go = () => window.__backed && app.icon && window.__backed.setIcon(app.icon);
    if (window.__backed) go(); else window.addEventListener('backed-ready', go, { once: true });
    const card = $('#offer');
    if (card && card.animate && !reduce) card.animate([{ scale: 1 }, { scale: 1.035 }, { scale: 1 }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    render();
  }

  const pasteForm = $('#paste');
  pasteForm && pasteForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('.btn', pasteForm);
    btn.disabled = true;
    if (note) { note.classList.remove('err'); note.textContent = 'Scanning the store page…'; }
    try {
      const app = await lookup(pasteIn.value);
      showApp(app);
    } catch (err) {
      if (note && err.message === 'ambiguous') {
        window.ABPick(note, err.candidates, id => { pasteIn.value = ''; lookup(id).then(showApp).catch(() => {}); });
        return;
      }
      if (note) {
        note.classList.add('err');
        note.textContent = err.message === 'badurl' ? 'That link is not from the App Store or Google Play.'
          : err.message === 'empty' ? 'Paste a store link or type your app name.' : "Couldn't find that app. Paste the full App Store link.";
      }
    } finally { btn.disabled = false; }
  });

  if (q.get('app')) lookup(q.get('app')).then(showApp).catch(() => {});

  $$('[data-focus-paste]').forEach(a => a.addEventListener('click', e => {
    if (!pasteIn) return;
    e.preventDefault();
    scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(() => pasteIn.focus({ preventScroll: true }), reduce ? 0 : 450);
  }));

  // ---------------------------------------------------------------------------
  // share card: a 1200x630 PNG with the app's icon on the 3D tile
  // ---------------------------------------------------------------------------
  const cardBtn = $('#card-make');
  cardBtn && cardBtn.addEventListener('click', async () => {
    cardBtn.disabled = true;
    const label = cardBtn.firstChild.textContent;
    cardBtn.firstChild.textContent = 'Drawing… ';
    try {
      const url = await makeCard();
      const img = $('#card-img'), dl = $('#card-dl');
      img.src = url; img.hidden = false;
      dl.href = url; dl.download = 'appbacked-' + (st.app ? st.app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'estimate') + '.png';
      dl.hidden = false;
      const x = $('#card-x');
      if (x) {
        x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(`AppBacked would put ${fmt(compute(st).B)} of growth behind ${st.app ? st.app.name : 'my app'}. $0 upfront, a share of the growth only.`) + '&url=' + encodeURIComponent('https://appbacked.com/calculator/');
        x.hidden = false;
      }
    } catch (e) { console.error(e); const n = $('#card-note'); if (n) n.textContent = 'Could not draw the card in this browser.'; }
    cardBtn.disabled = false; cardBtn.firstChild.textContent = label;
  });

  async function makeCard() {
    const W = 1200, H = 630, o = compute(st);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#2230E6'; x.fillRect(0, 0, W, H);
    const n = document.createElement('canvas'); n.width = n.height = 200;
    const nx = n.getContext('2d'), id = nx.createImageData(200, 200);
    for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 140; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    nx.putImageData(id, 0, 0);
    x.save(); x.globalAlpha = 0.1; x.globalCompositeOperation = 'soft-light'; x.fillStyle = x.createPattern(n, 'repeat'); x.fillRect(0, 0, W, H); x.restore();
    if (window.__backed) {
      const shot = await loadImg(window.__backed.snapshot(700, 630, { zoom: 0.95, offset: { x: 0.15, y: 0.1 }, pose: { ry: -0.36, rx: 0.14 } }));
      x.drawImage(shot, 520, 0);
    }
    await Promise.all([document.fonts.load('800 80px "Funnel Display"'), document.fonts.load('500 20px "IBM Plex Mono"')]);
    const t = (s, px, py, o2) => {
      x.save(); x.fillStyle = o2.color || '#fff';
      x.font = `${o2.weight || 800} ${o2.size}px ${o2.mono ? '"IBM Plex Mono"' : '"Funnel Display"'}`;
      try { x.fontStretch = 'normal'; } catch (_) {}
      try { x.letterSpacing = (o2.ls != null ? o2.ls : (o2.mono ? 0.08 : -0.035) * o2.size) + 'px'; } catch (_) {}
      x.fillText(s, px, py); x.restore();
    };
    const name = st.app ? (st.app.name.length > 22 ? st.app.name.slice(0, 21) + '…' : st.app.name) : 'your app';
    if (st.app && st.app.icon) {
      try {
        const ic = await loadImg(st.app.icon, true);
        x.save(); roundRect(x, 60, 60, 64, 64, 15); x.clip(); x.drawImage(ic, 60, 60, 64, 64); x.restore();
        t(st.app.name.length > 26 ? st.app.name.slice(0, 25) + '…' : st.app.name, 142, 100, { size: 30, weight: 700, ls: -0.5 });
      } catch (_) { t('appbacked', 60, 100, { size: 34 }); }
    } else t('appbacked', 60, 100, { size: 34 });
    t('APPBACKED WOULD PUT', 64, 232, { mono: true, size: 20, weight: 500, color: 'rgba(255,255,255,.75)' });
    t(fmt(o.B), 56, 336, { size: o.B >= 1e6 ? 84 : 104 });
    t('behind ' + name + '.', 60, 414, { size: name.length > 12 ? 48 : 64, color: '#D9FF3D' });
    t('$0 UPFRONT · 50/50 ABOVE YOUR BASELINE · THEN 100% YOURS', 64, 530, { mono: true, size: 17, weight: 500, color: 'rgba(255,255,255,.85)' });
    t('APPBACKED.COM · INDICATIVE ESTIMATE', 64, 574, { mono: true, size: 16, weight: 500, color: 'rgba(255,255,255,.55)' });
    return c.toDataURL('image/png');
  }
  function loadImg(src, cors) { return new Promise((res, rej) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

  // ---------------------------------------------------------------------------
  // header, menu, dock, reveals
  // ---------------------------------------------------------------------------
  const hdr = $('#hdr'), dock = $('#dock'), firstHero = $('.hero, .phero'), stopAt = $('#apply-form') || $('.ftr');
  const burger = $('.burger'), menu = $('#menu');
  function setMenu(open) {
    if (!menu) return;
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  burger && burger.addEventListener('click', () => setMenu(menu.hidden));
  menu && $$('a', menu).forEach(a => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', e => {
    if (!menu || menu.hidden) return;
    if (e.key === 'Escape') { setMenu(false); burger.focus(); return; }
    if (e.key !== 'Tab') return;
    const f = [burger, ...$$('a, button', menu)];
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  });

  function onScroll() {
    if (hdr) hdr.classList.toggle('solid', scrollY > 24);
    if (dock && firstHero && stopAt) {
      const hb = firstHero.getBoundingClientRect().bottom, ab = stopAt.getBoundingClientRect().top;
      dock.classList.toggle('on', hb < 0 && ab > innerHeight * 0.6);
    }
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach((n, i) => { n.style.transitionDelay = (i % 4) * 0.07 + 's'; io.observe(n); });
  } else $('.rv').forEach(n => n.classList.add('in'));

  // guide table of contents: highlight the section being read
  const toc = $('.toc');
  if (toc && 'IntersectionObserver' in window) {
    const links = new Map($('a[href^="#"]', toc).map(a => [a.getAttribute('href').slice(1), a]));
    const tio = new IntersectionObserver(es => es.forEach(x => {
      if (!x.isIntersecting) return;
      links.forEach(a => a.classList.remove('on'));
      const a = links.get(x.target.id); if (a) a.classList.add('on');
    }), { rootMargin: '-20% 0px -70% 0px' });
    $('.prose h2[id]').forEach(h => tio.observe(h));
  }

  // ---------------------------------------------------------------------------
  // apply form
  // ---------------------------------------------------------------------------
  const form = $('#apply-form');
  if (form) {
    const okBox = $('#a-ok');
    okBox && okBox.addEventListener('change', () => { okBox.parentElement.style.color = ''; });
    if ((q.get('app') || q.has('r')) && $('#est')) $('#est').hidden = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (form.website && form.website.value) return; // honeypot
      const link = $('#a-link'), contact = $('#a-contact'), ok = $('#a-ok');
      const linkOk = /^(https?:\/\/)?(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)\/\S+/i.test(link.value.trim());
      $('#f-link').classList.toggle('bad', !linkOk);
      $('#f-contact').classList.toggle('bad', contact.value.trim().length < 3);
      if (!linkOk) { link.focus(); return; }
      if (contact.value.trim().length < 3) { contact.focus(); return; }
      if (!ok.checked) { ok.focus(); ok.parentElement.style.color = '#C42B1C'; return; }
      const data = Object.fromEntries(new FormData(form).entries());
      delete data.website;
      const btn = form.querySelector('button[type=submit]');
      const endpoint = form.dataset.endpoint;
      if (endpoint) {
        btn.disabled = true; btn.firstChild.textContent = 'Sending… ';
        try {
          const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'appbacked', ...data }) });
          if (!r.ok) throw new Error(r.status);
          const res = await r.json().catch(() => ({}));
          if (res.delivered === false) return mailto(data);
          form.classList.add('sent');
        } catch (_) {
          btn.disabled = false; btn.firstChild.textContent = 'Send my app ';
          const p = form.querySelector('.send-err'); if (p) p.hidden = false;
        }
      } else mailto(data);
    });
    // no inbox behind the endpoint yet: hand the details to the visitor's mail app
    function mailto(data) {
      const body = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
      location.href = `mailto:hello@appbacked.com?subject=${encodeURIComponent('AppBacked application')}&body=${encodeURIComponent(body)}`;
      form.classList.add('sent');
      const p = form.querySelector('.ok p'); if (p) p.textContent = 'Your email app should open with everything filled in. Hit send and your growth plan lands within 48 hours. Nothing opened? Email the same details to hello@appbacked.com.';
    }
  }
})();
