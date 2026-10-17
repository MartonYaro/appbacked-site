/* AppBacked — free App Store audit. Scores a store page from public iTunes data and ranks what
   to fix first. Uses window.ABLookup from site.js. Runs only where #audit-form exists. */
(function () {
  'use strict';
  const $ = (s, p) => (p || document).querySelector(s);
  const form = $('#audit-form');
  if (!form) return;
  const input = $('#audit-in'), note = $('#audit-note'), report = $('#report');
  const ROOT = report ? report.dataset.root || '../' : '../';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DAY = 864e5;
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
  const GUIDE = {
    shots: ['guides/app-store-screenshot-sizes/', 'Screenshot sizes and the 10-slot playbook'],
    langs: ['guides/app-store-localization/', 'Which App Store languages to add first'],
  };

  // Each check: group, weight (share of 100), status good | warn | bad | info, what we saw, why it matters, what to do.
  function checks(a) {
    const out = [];
    const add = c => out.push(c);

    const name = a.trackName || '';
    const descriptive = /\s[–—:|-]\s|:\s/.test(name) || name.trim().split(/\s+/).length >= 3;
    if (name.length > 30) add({ g: 'Search', w: 8, s: 'warn', t: 'App name', v: `${name.length} characters`, why: 'Apple allows 30 characters for the name. Names over the limit come from older listings and get cut off in search.', fix: 'Trim it to 30 characters: brand first, one keyword after a dash.' });
    else if (!descriptive && name.length <= 20) add({ g: 'Search', w: 8, s: 'warn', t: 'App name', v: `“${name}”, ${name.length} of 30 characters`, why: 'The name is the strongest ranking field on the App Store, and right now it carries only the brand.', fix: `You have ${30 - name.length} free characters. Add what the app does after a dash: “${name} – …”.` });
    else add({ g: 'Search', w: 8, s: 'good', t: 'App name', v: `“${name}”, ${name.length} of 30 characters`, why: 'Brand plus a descriptive phrase: good use of the strongest ranking field.', fix: 'Test which keyword in the name brings the most impressions, then keep the winner.' });

    const langs = (a.languageCodesISO2A || []).length;
    const lv = `${langs} language${langs === 1 ? '' : 's'}`;
    // big App Store languages the app doesn't speak yet, in rough order of reach
    const have = new Set((a.languageCodesISO2A || []).map(c => c.toUpperCase()));
    const missing = [['ES', 'Spanish'], ['PT', 'Portuguese'], ['FR', 'French'], ['DE', 'German'], ['JA', 'Japanese'], ['KO', 'Korean'], ['ZH', 'Chinese'], ['IT', 'Italian'], ['NL', 'Dutch'], ['TR', 'Turkish']]
      .filter(([c]) => !have.has(c)).map(([, n]) => n).slice(0, 4);
    const list = missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0];
    if (langs >= 10) add({ g: 'Search', w: 14, s: 'good', t: 'Languages', v: lv, why: 'Each localized store page gets its own name, subtitle, keywords and screenshots, so every language is a new set of searches.', fix: missing.length ? `Check the store pages are localized too, not only the app. Still missing: ${list}.` : 'Check that the store pages are localized too, not only the app.', guide: GUIDE.langs });
    else if (langs >= 4) add({ g: 'Search', w: 14, s: 'warn', t: 'Languages', v: lv, why: 'Each localized store page gets its own name, subtitle, keywords and screenshots. Most apps still miss big markets.', fix: missing.length ? `Start with countries that already download you. Big languages you don’t cover yet: ${list}.` : 'Localize the store pages for the countries that already download you.', guide: GUIDE.langs });
    else add({ g: 'Search', w: 14, s: 'bad', t: 'Languages', v: lv, why: 'With so few languages, most of the world searches in a language your page doesn’t speak. Localization is usually the cheapest growth an app can buy.', fix: 'Start with Spanish (Mexico), French and Portuguese (Brazil): Apple supports them in the US App Store too, not only abroad.', guide: GUIDE.langs });

    const shots = (a.screenshotUrls || []).length;
    const sv = `${shots} of 10 iPhone screenshots`;
    if (shots >= 8) add({ g: 'Store page', w: 14, s: 'good', t: 'iPhone screenshots', v: sv, why: 'A full gallery. Most visitors decide from the first three, so that is where tests pay off.', fix: 'A/B test the first three frames with Product Page Optimization.', guide: GUIDE.shots });
    else if (shots >= 5) add({ g: 'Store page', w: 14, s: 'warn', t: 'iPhone screenshots', v: sv, why: 'Apple allows 10 per device size. Empty slots are free space to answer objections and show features.', fix: 'Fill all 10. Keep the first three about the outcome, with one short caption each.', guide: GUIDE.shots });
    else add({ g: 'Store page', w: 14, s: 'bad', t: 'iPhone screenshots', v: sv, why: 'The gallery is what sells the install, and yours shows less than half of what Apple allows.', fix: 'Design a 10-frame gallery: outcome first, then the three features people pay for, then proof.', guide: GUIDE.shots });

    const universal = (a.features || []).includes('iosUniversal');
    const ipad = (a.ipadScreenshotUrls || []).length;
    if (universal) {
      if (ipad === 0) add({ g: 'Store page', w: 7, s: 'bad', t: 'iPad gallery', v: 'No iPad screenshots', why: 'Your app is built for iPad, but iPad shoppers see no iPad screenshots.', fix: 'Add iPad 13-inch screenshots (2064 × 2752 or 2048 × 2732). Apple scales them down for smaller iPads.', guide: GUIDE.shots });
      else if (ipad < 5) add({ g: 'Store page', w: 7, s: 'warn', t: 'iPad gallery', v: `${ipad} iPad screenshot${ipad === 1 ? '' : 's'}`, why: 'iPad users get a thinner pitch than iPhone users.', fix: 'Bring the iPad gallery up to the iPhone story, laid out for the bigger screen.', guide: GUIDE.shots });
      else add({ g: 'Store page', w: 7, s: 'good', t: 'iPad gallery', v: `${ipad} iPad screenshots`, why: 'iPad shoppers get a proper gallery.', fix: 'Keep it in step with the iPhone gallery when you test new frames.' });
    }

    const desc = (a.description || '').trim();
    const firstLine = desc.split(/\n/)[0] || '';
    if (desc.length >= 1000) add({ g: 'Store page', w: 4, s: 'good', t: 'Description', v: `${k(desc.length)} characters`, why: 'Enough room to answer questions for people who tap “more”. Google also indexes your App Store web page.', fix: firstLine.length > 170 ? 'Shorten the first sentence: only about three lines show before “more”.' : 'Keep the first three lines about the outcome, not the company.' });
    else add({ g: 'Store page', w: 4, s: desc.length >= 500 ? 'warn' : 'bad', t: 'Description', v: `${k(desc.length)} characters`, why: 'The App Store doesn’t rank on the description, but people who tap “more” are close to installing, and Google indexes the page.', fix: 'Write 1,500 to 3,000 characters: outcome, top features, proof, pricing, support.' });

    const n = a.userRatingCount || 0, r = a.averageUserRating || 0;
    if (n >= 20) {
      if (r >= 4.5) add({ g: 'Trust', w: 12, s: 'good', t: 'Star rating', v: `${r.toFixed(1)} stars`, why: 'Stars sit next to your icon in search results. 4.5 and up reads as safe.', fix: 'Keep the review prompt after success moments so the average holds.' });
      else if (r >= 4.0) add({ g: 'Trust', w: 12, s: 'warn', t: 'Star rating', v: `${r.toFixed(1)} stars`, why: 'Stars sit next to your icon in search results, and under 4.5 people start comparing.', fix: 'Fix the top complaint in recent reviews, then ask for ratings right after a win, never on launch.' });
      else add({ g: 'Trust', w: 12, s: 'bad', t: 'Star rating', v: `${r.toFixed(1)} stars`, why: 'Under 4 stars costs installs on every search result and every ad you run.', fix: 'Find the one-star pattern in recent reviews, ship the fix, reply to reviews, then prompt happy users.' });
    }
    if (n >= 1000) add({ g: 'Trust', w: 10, s: 'good', t: 'Number of ratings', v: `${k(n)} ratings`, why: 'Plenty of social proof.', fix: 'Reply to recent negative reviews: replies are public and people read them.' });
    else if (n >= 100) add({ g: 'Trust', w: 10, s: 'warn', t: 'Number of ratings', v: `${k(n)} ratings`, why: 'Enough to show a score, not enough to feel like a safe choice.', fix: 'Use Apple’s in-app rating prompt after a success moment. It can show up to three times a year per user.' });
    else add({ g: 'Trust', w: 10, s: 'bad', t: 'Number of ratings', v: `${k(n)} rating${n === 1 ? '' : 's'}`, why: 'Too few ratings to reassure anyone, and nothing to show next to your icon in search.', fix: 'Add Apple’s in-app rating prompt after the first real win in the app.' });

    const days = a.currentVersionReleaseDate ? Math.round((Date.now() - new Date(a.currentVersionReleaseDate)) / DAY) : null;
    if (days != null) {
      const dv = days === 0 ? 'Updated today' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
      if (days <= 60) add({ g: 'Freshness', w: 10, s: 'good', t: 'Last update', v: dv, why: 'Shipping regularly. It also gives you regular release notes to talk to users.', fix: 'Use each release to test one store page change.' });
      else if (days <= 180) add({ g: 'Freshness', w: 10, s: 'warn', t: 'Last update', v: dv, why: 'A few months without a release. Visitors check the date, and gaps usually mean the store page isn’t being tested either.', fix: 'Ship a small update at least monthly, and change one thing on the store page with it.' });
      else add({ g: 'Freshness', w: 10, s: 'bad', t: 'Last update', v: dv, why: 'Half a year or more without an update makes an app look abandoned, especially next to active competitors.', fix: 'Ship an update with current iOS support and a fresh gallery.' });
    }

    const notes = (a.releaseNotes || '').trim();
    const generic = notes.length < 60 || /^(bug fixes|minor|performance|improvements|small|we update|thanks for using)/i.test(notes);
    add(generic
      ? { g: 'Freshness', w: 5, s: 'warn', t: 'Release notes', v: notes ? `“${notes.slice(0, 60)}${notes.length > 60 ? '…' : ''}”` : 'Empty', why: 'Release notes show on your page and in every user’s update list. Generic text wastes that.', fix: 'Lead with one thing users will notice, in one sentence.' }
      : { g: 'Freshness', w: 5, s: 'good', t: 'Release notes', v: `${notes.length} characters`, why: 'Specific notes tell visitors the app is alive and improving.', fix: 'Keep leading with the change people will feel.' });

    if (a.price > 0) add({ g: 'Money', w: 6, s: 'warn', t: 'Pricing model', v: `Paid upfront, ${a.formattedPrice}`, why: 'A price tag stops most people before they try the app.', fix: 'Test a free download with a free trial and a subscription or one-time unlock.' });
    else add({ g: 'Money', w: 6, s: 'good', t: 'Pricing model', v: 'Free to download', why: 'No price wall before people try the app. Revenue comes from in-app purchases.', fix: 'The paywall is where the money is: test the offer, trial length and timing.' });

    const mb = +(a.fileSizeBytes || 0) / 1048576;
    if (mb) add(mb > 200
      ? { g: 'Money', w: 5, s: 'warn', t: 'Download size', v: `${Math.round(mb)} MB`, why: 'Over 200 MB, iPhones on cellular ask before downloading by default, and some people walk away.', fix: 'Move large assets to on-demand downloads and get the app under 200 MB.' }
      : { g: 'Money', w: 5, s: 'good', t: 'Download size', v: `${Math.round(mb)} MB`, why: 'Small enough to download anywhere without a prompt.', fix: 'Keep an eye on it as you add content.' });

    if (a.minimumOsVersion) add({ g: 'Facts', w: 0, s: 'info', t: 'Requires', v: `iOS ${a.minimumOsVersion} or later`, why: 'Higher minimums mean fewer devices can install.', fix: '' });
    if (a.primaryGenreName) add({ g: 'Facts', w: 0, s: 'info', t: 'Category', v: a.primaryGenreName + (a.genres && a.genres[1] ? ` · ${a.genres[1]}` : ''), why: '', fix: '' });
    if (a.releaseDate) add({ g: 'Facts', w: 0, s: 'info', t: 'On the App Store since', v: new Date(a.releaseDate).getFullYear(), why: '', fix: '' });
    return out;
  }

  function score(list) {
    const scored = list.filter(c => c.w > 0);
    const total = scored.reduce((s, c) => s + c.w, 0);
    const got = scored.reduce((s, c) => s + c.w * (c.s === 'good' ? 1 : c.s === 'warn' ? 0.5 : 0), 0);
    return total ? Math.round(got / total * 100) : 0;
  }
  const grade = s => s >= 85 ? ['Strong page', 'Little left to fix. Growth comes from paid users and pricing.']
    : s >= 70 ? ['Solid, with gaps', 'A few fixes would lift conversion without spending a dollar on ads.']
      : s >= 50 ? ['Leaving installs on the table', 'Fix the top items before buying traffic. Every ad dollar converts better after.']
        : ['Big upside', 'Your store page is holding the app back. This is the cheapest growth you will find.'];

  const STATUS = { good: 'Good', warn: 'Improve', bad: 'Fix first', info: '' };
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

  function ring(host, s) {
    host.style.setProperty('--p', reduce ? s : 0);
    host.querySelector('b').textContent = reduce ? s : '0';
    if (reduce) return;
    const t0 = performance.now(), dur = 1100;
    const tick = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = Math.round(s * e); host.style.setProperty('--p', v); host.querySelector('b').textContent = v; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  let current = null;
  function render(app) {
    const a = app.raw;
    current = app;
    const list = checks(a);
    const s = score(list);
    const [gt, gd] = grade(s);

    // hero card
    const card = $('#audit-card');
    if (card) {
      card.classList.add('live');
      $('[data-a-name]', card).textContent = app.name;
      $('[data-a-sub]', card).textContent = app.seller || '';
      const ic = $('[data-a-icon]', card); ic.innerHTML = ''; if (app.icon) { const im = new Image(); im.alt = ''; im.src = app.icon; ic.appendChild(im); }
      ring($('.ring', card), s);
      $('[data-a-grade]', card).textContent = gt;
      const ul = $('[data-a-top]', card); ul.innerHTML = '';
      list.filter(c => c.w).sort((x, y) => (x.s === 'good') - (y.s === 'good') || y.w - x.w).slice(0, 4).forEach(c => {
        const li = el('li', c.s); li.append(el('b', null, c.t), el('span', null, c.v)); ul.appendChild(li);
      });
      $('[data-a-chip]', card).textContent = 'Live';
    }

    if (!report) return;
    $('#rep-name').textContent = app.name;
    $('#rep-sub').textContent = [app.seller, a.primaryGenreName, a.averageUserRating ? `★ ${a.averageUserRating.toFixed(1)} · ${k(a.userRatingCount || 0)} ratings` : ''].filter(Boolean).join(' · ');
    const ric = $('#rep-icon'); ric.innerHTML = ''; if (app.icon) { const im = new Image(); im.alt = ''; im.src = app.icon; ric.appendChild(im); }
    ring($('#rep-ring'), s);
    $('#rep-grade').textContent = gt;
    $('#rep-gdesc').textContent = gd;

    const first = $('#rep-first'); first.innerHTML = '';
    const todo = list.filter(c => c.s === 'bad' || c.s === 'warn').sort((x, y) => (x.s === 'warn') - (y.s === 'warn') || y.w - x.w).slice(0, 3);
    if (!todo.length) first.appendChild(el('li', null, 'Nothing urgent. Your next lever is paid user acquisition and paywall tests.'));
    todo.forEach(c => { const li = el('li'); li.append(el('b', null, c.t + '. '), document.createTextNode(c.fix)); first.appendChild(li); });

    const groups = $('#rep-groups'); groups.innerHTML = '';
    const order = ['Search', 'Store page', 'Trust', 'Freshness', 'Money', 'Facts'];
    order.forEach(g => {
      const items = list.filter(c => c.g === g);
      if (!items.length) return;
      const box = el('div', 'rep-group' + (g === 'Facts' ? ' facts' : ''));
      box.appendChild(el('h3', null, g === 'Facts' ? 'Facts' : g));
      items.forEach(c => {
        const row = el('div', 'rep-row ' + c.s);
        const head = el('div', 'rr-h');
        head.append(el('span', 'rr-t', c.t));
        if (STATUS[c.s]) head.append(el('span', 'rr-s', STATUS[c.s]));
        row.append(head, el('div', 'rr-v', String(c.v)));
        if (c.why) row.append(el('p', 'rr-why', c.why));
        if (c.fix && c.s !== 'info') { const p = el('p', 'rr-fix'); p.append(el('b', null, 'Do this: '), document.createTextNode(c.fix)); row.append(p); }
        if (c.guide && c.s !== 'good') { const g2 = el('a', 'rr-guide', c.guide[1] + ' →'); g2.href = ROOT + c.guide[0]; row.append(g2); }
        box.appendChild(row);
      });
      groups.appendChild(box);
    });

    const rmApp = $('[data-rm-app]'); if (rmApp) rmApp.textContent = app.name;
    const rm = $('#rep-mail'); if (rm) rm.classList.remove('sent');
    const calc = $('#rep-calc'); if (calc) calc.href = `${ROOT}calculator/?app=${encodeURIComponent(app.id)}#math`;
    const apply = $('#rep-apply'); if (apply) apply.href = `${ROOT}apply/?app=${encodeURIComponent(app.id)}`;
    report.hidden = false;
    history.replaceState(null, '', `?app=${encodeURIComponent(app.id)}`);
    portfolio(a);
  }

  // other apps by the same developer: free cross-promotion
  function portfolio(a) {
    const box = $('#rep-port'); if (!box || !a.artistId) return;
    box.hidden = true;
    fetch(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=software&limit=50`).then(r => r.json()).then(r => {
      const apps = (r.results || []).filter(x => x.wrapperType === 'software' && x.trackId !== a.trackId);
      if (!apps.length) return;
      $('[data-port-n]', box).textContent = apps.length;
      const row = $('[data-port-list]', box); row.innerHTML = '';
      apps.slice(0, 8).forEach(x => { const im = new Image(); im.alt = x.trackName; im.title = x.trackName; im.src = x.artworkUrl100 || x.artworkUrl60; row.appendChild(im); });
      box.hidden = false;
    }).catch(() => {});
  }

  async function run(q, scroll) {
    const btn = $('.btn', form);
    btn.disabled = true;
    note.classList.remove('err');
    note.textContent = 'Reading the store page…';
    try {
      const app = await window.ABLookup(q);
      if (!app.raw) { note.textContent = 'Google Play pages are reviewed by hand. Apply and we’ll send the audit with your growth plan.'; return; }
      render(app);
      note.textContent = `Audited ${app.name}. Full report below.`;
      if (scroll && report) setTimeout(() => report.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }), reduce ? 0 : 900);
    } catch (err) {
      if (err.message === 'ambiguous' && window.ABPick) { window.ABPick(note, err.candidates, id => run(id, true)); return; }
      note.classList.add('err');
      note.textContent = err.message === 'badurl' ? 'That link is not from the App Store.' : err.message === 'empty' ? 'Paste an App Store link or type the app name.' : 'Couldn’t find that app. Try the full App Store link.';
    } finally { btn.disabled = false; }
  }

  form.addEventListener('submit', e => { e.preventDefault(); run(input.value, true); });
  document.querySelectorAll('[data-try]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.try; run(b.dataset.try, true); }));
  const copy = $('#rep-copy');
  copy && copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); copy.firstChild.textContent = 'Link copied '; } catch (e) { copy.firstChild.textContent = 'Copy the address bar '; }
    setTimeout(() => { copy.firstChild.textContent = 'Copy link to this report '; }, 2200);
  });
  const again = $('#rep-again');
  again && again.addEventListener('click', () => { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); setTimeout(() => input.focus({ preventScroll: true }), reduce ? 0 : 500); });

  // email the report: same endpoint as the apply form, with consent
  const mail = $('#rep-mail');
  mail && mail.addEventListener('submit', async e => {
    e.preventDefault();
    if (mail.website && mail.website.value) return;
    const email = $('#rm-email'), ok = $('#rm-ok'), btn = $('button[type=submit]', mail), err = $('.send-err', mail);
    const good = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value.trim());
    $('#rm-f-email').classList.toggle('bad', !good);
    if (!good) { email.focus(); return; }
    if (!ok.checked) { ok.focus(); ok.parentElement.style.color = '#C42B1C'; return; }
    if (!current || !current.raw) return;
    btn.disabled = true; err.hidden = true;
    const body = { kind: 'audit', source: 'audit', link: current.raw.trackViewUrl || `https://apps.apple.com/app/id${current.raw.trackId}`, platform: 'iOS', revenue: $('#rm-rev').value, contact: email.value.trim(), consent: 'yes' };
    try {
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok || res.delivered === false) throw new Error(res.error || r.status);
      mail.classList.add('sent');
    } catch (_) { err.hidden = false; } finally { btn.disabled = false; }
  });
  $('#rm-ok') && $('#rm-ok').addEventListener('change', e => { e.target.parentElement.style.color = ''; });

  const start = new URLSearchParams(location.search).get('app');
  if (start) { input.value = /^\d+$/.test(start) ? '' : start; run(start, false); }
})();
