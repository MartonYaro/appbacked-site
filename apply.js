// POST /api/apply: a developer sends their app (apply form), or asks for the audit report by email (audit page, home X-ray).
// 1. guards: same-origin JSON only, honeypot, per-IP limit   2. look up the app and run the same audit as /app-store-audit/
// 3. email the lead to us (always)   4. email the developer, only when the app resolved and the send caps allow it
// Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, LEADS_TO, SITE_ORIGIN, ORIGIN_TOKEN (set by a Cloudflare transform rule),
//      LEADS_FILE (JSONL on a volume), MAX_VISITOR_MAILS_PER_HOUR, MAX_VISITOR_MAILS_PER_DAY, MAX_MAILS_PER_RECIPIENT_PER_DAY.
// Zero dependencies (Node 18+ fetch).
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');

const MAIL_FROM = process.env.MAIL_FROM || 'Yaro at AppBacked <hello@appbacked.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'ceo@appbacked.com';
const LEADS_TO = process.env.LEADS_TO || 'info@appbacked.com';
const SITE = process.env.SITE_ORIGIN || 'https://appbacked.com';
const LEADS_FILE = process.env.LEADS_FILE || (fs.existsSync('/data') ? '/data/leads.jsonl' : '');
const CAP_HOUR = +(process.env.MAX_VISITOR_MAILS_PER_HOUR || 30);
const CAP_DAY = +(process.env.MAX_VISITOR_MAILS_PER_DAY || 120);
const CAP_RECIPIENT = +(process.env.MAX_MAILS_PER_RECIPIENT_PER_DAY || 2);
const CONSENT_V = '2026-10-17'; // bump whenever a checkbox text changes
const FOUNDER = { name: 'Yaroslav Marton', title: 'Founder, AppBacked', place: 'Italy', linkedin: 'https://www.linkedin.com/in/yaroslav-marton-28aa59241/' };

const STORE_RE = /^(https?:\/\/)?(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)\/\S+/i;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const PLAY_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;
const ENUM = {
  platform: ['iOS', 'Android', 'Both'],
  revenue: ['Under $1k', '$1k–3k', '$3k–10k', '$10k–30k', '$30k–100k', '$100k+', '$30k+'],
  monetization: ['Subscriptions', 'One-time purchases', 'Ads', 'Paid download', 'Mixed'],
  live6: ['Yes', 'No'],
  stack: ['RevenueCat', 'Adapty', 'Qonversion', 'Own backend', 'None yet', 'Other'],
  bottleneck: ['Not enough installs', "Installs don't convert", 'Paywall and pricing', 'Not sure'],
  source: ['appbacked', 'xray', 'audit'],
};

// same scoring as the public audit: reuse checks() and score() from assets/audit.js
let audit = null;
function loadAudit(root) {
  if (audit !== null) return audit;
  try {
    const src = fs.readFileSync(path.join(root, 'assets', 'audit.js'), 'utf8');
    const body = src.slice(src.indexOf('  function checks(a)'), src.indexOf('  const grade'));
    const k = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
    audit = new Function('DAY', 'k', 'GUIDE', body + '; return { checks, score };')(864e5, k, { shots: [], langs: [] });
  } catch (e) {
    console.error('audit load failed', e.message);
    audit = false;
  }
  return audit;
}

// --- limits -------------------------------------------------------------------------------------
const HOUR = 3600e3, DAY = 864e5;
const hits = new Map();      // ip bucket -> timestamps (requests)
const accepted = new Map();  // ip bucket -> timestamps (valid submissions)
const sent = new Map();      // recipient -> timestamps (visitor emails)
const global = [];           // timestamps of visitor emails
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some(t => now - t < HOUR)) hits.delete(k);
  for (const [k, v] of accepted) if (!v.some(t => now - t < HOUR)) accepted.delete(k);
  for (const [k, v] of sent) if (!v.some(t => now - t < DAY)) sent.delete(k);
  while (global.length && now - global[0] > DAY) global.shift();
}, 600e3).unref();

// IPv6 by /64 so one home prefix is one bucket; IPv4-mapped addresses unwrapped
function ipKey(ip) {
  ip = String(ip || '').trim().replace(/^::ffff:/i, '');
  if (!ip.includes(':')) return ip;
  const [head] = ip.split('%');
  const parts = head.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return full.slice(0, 4).map(h => h.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}
function clientIp(req) {
  const token = process.env.ORIGIN_TOKEN;
  const viaEdge = !token || req.headers['x-origin-token'] === token;
  const edgeIp = viaEdge ? req.headers['cf-connecting-ip'] : '';
  return ipKey(edgeIp || req.socket.remoteAddress || '');
}
// raw requests: 30/h per bucket (typos and retries are fine); valid submissions: 5/h
function limited(key, store = hits, max = 30) {
  const now = Date.now(), list = (store.get(key) || []).filter(t => now - t < HOUR);
  list.push(now);
  store.set(key, list);
  return list.length > max;
}
// returns a reason when a visitor email must be skipped, else ''
function mailCap(email) {
  const now = Date.now();
  while (global.length && now - global[0] > DAY) global.shift();
  if (global.filter(t => now - t < HOUR).length >= CAP_HOUR) return 'hourly cap';
  if (global.length >= CAP_DAY) return 'daily cap';
  const list = (sent.get(email) || []).filter(t => now - t < DAY);
  if (list.length >= CAP_RECIPIENT) return 'recipient cap';
  return '';
}
function countMail(email) {
  const now = Date.now();
  global.push(now);
  sent.set(email, [...(sent.get(email) || []), now]);
}
async function hasMx(email) {
  const domain = email.split('@')[1];
  try {
    const mx = await Promise.race([dns.resolveMx(domain), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return Array.isArray(mx) && mx.length > 0;
  } catch (_) { return false; }
}

// --- helpers ------------------------------------------------------------------------------------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const pick = (v, list) => (list.includes(v) ? v : '');
const mask = s => (s.includes('@') ? s.replace(/^(.).*(@.*)$/, '$1***$2') : s.slice(0, 2) + '***');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

async function lookupApp(link) {
  const ios = link.match(/\/id(\d{5,})/);
  if (!ios) {
    const play = link.match(/[?&]id=([\w.]+)/);
    return play && PLAY_ID_RE.test(play[1]) && play[1].length <= 150 ? { store: 'play', id: play[1], name: 'your Google Play app' } : null;
  }
  const one = country => fetch(`https://itunes.apple.com/lookup?id=${ios[1]}&country=${country}`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.json()).then(j => { if (j.results && j.results[0]) return { store: 'ios', id: ios[1], name: j.results[0].trackName, data: j.results[0], country }; throw new Error('none'); });
  try { return await Promise.any(['us', 'gb'].map(one)); } catch (_) { return { store: 'ios', id: ios[1], name: 'your app' }; }
}

function firstLook(app, root) {
  const a = loadAudit(root);
  if (!app || !app.data || !a) return null;
  const list = a.checks(app.data);
  const scored = list.filter(c => c.w > 0);
  const order = { bad: 0, warn: 1, good: 2 };
  const open = scored.filter(c => c.s !== 'good').sort((x, y) => order[x.s] - order[y.s] || y.w - x.w);
  return { score: a.score(list), fixes: open.slice(0, 3), open, good: scored.filter(c => c.s === 'good').sort((x, y) => y.w - x.w).slice(0, 2) };
}

const label = s => s >= 85 ? 'Strong page' : s >= 70 ? 'Good, with gaps' : s >= 50 ? 'Below most pages we check' : 'Most of the checklist is open';

// --- emails -------------------------------------------------------------------------------------
const P = 'font:400 14px/1.6 Arial,sans-serif;color:#14151F';
const MUTED = 'font:400 14px/1.6 Arial,sans-serif;color:#4A4D5C';
const H3 = 'font:700 16px/1.4 Arial,sans-serif;color:#14151F';
const row = (style, inner, pad = '12px 32px 0') => `  <tr><td style="padding:${pad};${style}">${inner}</td></tr>\n`;

function wrap(subject, preheader, headline, rows) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head><body style="margin:0;background:#E9E7E0">
<div style="display:none;max-height:0;overflow:hidden;color:#E9E7E0">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#E9E7E0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#FBFAF6;border-radius:16px;overflow:hidden">
  <tr><td style="background:#2230E6;padding:26px 32px">
    <img src="${SITE}/brand/png/appbacked-lockup-on-blue.png" width="150" alt="AppBacked" style="display:block;border:0;width:150px;height:auto">
    <div style="font:800 26px/1.15 Arial,sans-serif;color:#F4F2EC;margin-top:18px">${headline}</div>
  </td></tr>
${rows}  <tr><td style="padding:22px 32px 28px;${P}">${esc(FOUNDER.name)}<br><span style="color:#4A4D5C">${esc(FOUNDER.title)} · ${esc(FOUNDER.place)} · <a href="${FOUNDER.linkedin}" style="color:#4A4D5C">LinkedIn</a></span></td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #DCD8CC;font:400 12px/1.5 Arial,sans-serif;color:#4A4D5C">You asked for this at appbacked.com. At most three emails about this app, no newsletter. Reply "stop" and we won't write again. <a href="${SITE}/legal/privacy/" style="color:#2230E6">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
}
const textFooter = ['', FOUNDER.name, `${FOUNDER.title} · ${FOUNDER.place}`, FOUNDER.linkedin, '', 'You asked for this at appbacked.com. At most three emails about this app, no newsletter. Reply "stop" and we won\'t write again.', `Privacy: ${SITE}/legal/privacy/`];

function scoreBlock(look) {
  return `  <tr><td style="padding:0 32px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F4F2EC;border-radius:12px"><tr><td style="padding:20px 22px">
        <div style="font:500 11px/1.4 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:#2230E6">Store page score</div>
        <div style="font:800 40px/1.1 Arial,sans-serif;color:#14151F;margin-top:6px">${look.score}<span style="font-size:18px;color:#4A4D5C">/100</span></div>
        <div style="font:400 14px/1.5 Arial,sans-serif;color:#4A4D5C;margin-top:2px">${esc(label(look.score))}. From public App Store data.</div>
      </td></tr></table>
    </td></tr>\n`;
}
const itemRows = items => items.map(f => row(P, `<b>${esc(f.t)}</b> <span style="color:#4A4D5C">(${esc(f.v)})</span><br><span style="color:#4A4D5C">${esc(f.fix)}</span>`, '10px 32px 0')).join('');
const itemText = items => items.map(f => `- ${f.t} (${f.v}): ${f.fix}`);
const ASK = 'Two things make my reply specific: roughly how revenue has moved over the last six months, and what you\'ve already tried. Just reply to this email.';
const NEXT = 'Within 48 hours you get a written reply: fit yes or no, what I\'d fix first and an indicative budget. Firm numbers come after a short call and a look at your reports. Or a straight no, with the reason.';

// kind: 'apply' (application) | 'audit' (report by email). Returns null when nothing should be sent.
function developerEmail(d, app, look, kind = 'apply') {
  if (!app) return null;
  const applyUrl = `${SITE}/apply/${app.id && app.store === 'ios' ? '?app=' + encodeURIComponent(app.id) : ''}`;
  const reportUrl = app.store === 'ios' ? `${SITE}/app-store-audit/?app=${encodeURIComponent(app.id)}` : '';
  const name = app.store === 'ios' && app.data ? app.name : null;

  // Google Play, or an iOS app the lookup could not score: short, honest, no untrusted text in the subject or headline
  if (!look) {
    if (app.store !== 'play' && kind === 'audit') return null; // iOS not found: nothing to report, lead only
    const subject = kind === 'audit' ? 'Your Google Play report: I\'ll do this one by hand' : 'Got your app. I reply within 48 hours';
    const body = app.store === 'play'
      ? 'Google Play listings aren\'t in the public lookup our automatic check uses, so I\'ll go through the listing myself.'
      : 'The automatic check couldn\'t find this one in the US or UK App Store, so I\'ll look at the listing myself.';
    const next = kind === 'audit' ? 'You\'ll get the report within 48 hours.' : NEXT;
    const html = wrap(subject, next, kind === 'audit' ? 'Your report is coming.' : 'Got it.', row(P, esc(body), '26px 32px 0') + row(P, esc(next)) + row(P, esc(ASK)));
    const text = [kind === 'audit' ? 'Your report is coming.' : 'Got it.', '', body, '', next, '', ASK, ...textFooter].join('\n');
    return { subject, html, text };
  }

  const audit = kind === 'audit';
  const items = audit ? look.open.slice(0, 6) : look.fixes;
  const subject = audit ? `Your App Store audit: ${name} (${look.score}/100)` : `${name}: ${look.score}/100 and what I'd fix first`;
  const preheader = (items[0] ? `${items[0].t}: ${items[0].v}. ` : '') + (audit ? 'Full report inside.' : 'I reply within 48 hours.');
  const intro = audit
    ? 'Here is the report you asked for. It reads your public App Store page the way a visitor sees it.'
    : 'Thanks for sending it. I read every application myself, usually the same day. Meanwhile, here is what our automatic store-page check found:';
  const ps = `P.S. If the app already makes money, we can do these on our budget and take a share only of what grows above today's revenue. Two minutes to apply: ${applyUrl}. I reply within 48 hours, yes or no.`;
  const rows = row(P, esc(intro), '26px 32px 18px') + scoreBlock(look)
    + (items.length ? row(H3, audit ? 'What to fix, in order' : 'What I\'d look at first', '16px 32px 0') + itemRows(items) : '')
    + (look.good.length ? row(MUTED, `Already good: ${look.good.map(g => esc(g.t.toLowerCase())).join(' and ')}.`, '16px 32px 0') : '')
    + (audit
      ? row(P, `Full 11-point report, with the why for each: <a href="${reportUrl}" style="color:#2230E6">${esc(reportUrl.replace('https://', ''))}</a>`, '18px 32px 0')
        + row(MUTED, esc(ps).replace(esc(applyUrl), `<a href="${applyUrl}" style="color:#2230E6">${esc(applyUrl.replace('https://', ''))}</a>`), '18px 32px 0')
      : row(H3, 'What happens next', '22px 32px 0') + row(P, esc(NEXT), '8px 32px 0') + row(P, esc(ASK)));
  const html = wrap(subject, preheader, audit ? `Your audit for <span style="color:#D9FF3D">${esc(name)}</span>` : `Got <span style="color:#D9FF3D">${esc(name)}</span>.`, rows);
  const text = [
    audit ? `Your audit for ${name}` : `Got ${name}.`, '', intro, '',
    `Store page score: ${look.score}/100. ${label(look.score)}.`, '',
    ...(items.length ? [audit ? 'What to fix, in order:' : 'What I\'d look at first:', ...itemText(items), ''] : []),
    ...(audit ? [`Full 11-point report: ${reportUrl}`, '', ps] : ['What happens next: ' + NEXT, '', ASK]),
    ...textFooter,
  ].join('\n');
  return { subject, html, text };
}

function leadEmail(d, app, look, kind, consent, visitorMail) {
  const appName = app ? (app.store === 'ios' && app.data ? app.name : app.store === 'play' ? `Google Play · ${app.id}` : `App Store id ${app.id} (not found)`) : 'unknown app';
  const rows = [
    ['Source', kind === 'audit' ? (d.source === 'xray' ? 'Home X-ray' : 'Audit report request') : 'Application form'],
    ['App', appName], ['Link', d.link], ['Platform', d.platform], ['Revenue', d.revenue], ['Earns via', d.monetization],
    ['Live 6+ months', d.live6], ['Based in', d.country], ['Stack', d.stack], ['Tried / ad spend', d.tried],
    ['Bottleneck', d.bottleneck], ['Message', d.message], ['Email', d.contact], ['LinkedIn / X', d.profile], ['Estimate', d.estimate],
    ['Audit', look ? `${look.score}/100; ${look.fixes.map(f => f.t).join(', ')}` : 'n/a'],
    ['Store data', app && app.data ? `${app.data.userRatingCount || 0} ratings, ${(app.data.averageUserRating || 0).toFixed(1)}★, ${(app.data.languageCodesISO2A || []).length} languages, ${app.data.primaryGenreName}, since ${String(app.data.releaseDate || '').slice(0, 10)}, ${app.country}` : 'n/a'],
    ['Visitor email', visitorMail], ['Consent', consent],
  ].filter(([, v]) => v);
  const html = `<table cellpadding="6" style="font:14px Arial,sans-serif;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const subject = clip(`${kind === 'audit' ? 'New audit lead' : 'New application'}: ${appName}${d.revenue ? ' · ' + d.revenue : ''}`, 120);
  return { subject, html, text };
}

// --- sending ------------------------------------------------------------------------------------
async function sendMail(msg, idem) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true };
  const once = () => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(10000),
  });
  let r;
  try { r = await once(); } catch (e) { await new Promise(res => setTimeout(res, 800)); r = await once(); }
  if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 800)); r = await once(); }
  if (!r.ok) throw new Error(`resend ${r.status}`);
  return r.json();
}

function readBody(req, res, max = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"Too large."}'); reject(new Error('too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApply(req, res, root) {
  const json = (status, obj) => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); } };
  // same-origin JSON only: a third-party page cannot post through its visitors' browsers
  const host = String(req.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const allowedOrigins = new Set([SITE, `http://${host}`, `https://${host}`]);
  if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) return json(415, { ok: false, error: 'Send JSON.' });
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin) && !local) return json(403, { ok: false, error: 'Forbidden.' });
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return json(403, { ok: false, error: 'Forbidden.' });
  if (+req.headers['content-length'] > 20000) return json(413, { ok: false, error: 'Too large.' });
  const ipk = clientIp(req);
  if (limited(ipk)) return json(429, { ok: false, error: 'Too many requests, try again later.' });

  let d;
  try { d = JSON.parse(await readBody(req, res)); } catch (_) { return json(400, { ok: false, error: 'Bad request.' }); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return json(400, { ok: false, error: 'Bad request.' });
  if (d.website) return json(200, { ok: true, delivered: true }); // honeypot: pretend success
  const kind = d.kind === 'audit' ? 'audit' : 'apply';
  if (d.consent !== 'yes' && d.consent !== true) return json(400, { ok: false, error: 'Please tick the box so we can reply about your app.' });
  const form = kind === 'audit' ? (d.source === 'xray' ? 'home X-ray form' : 'audit report form') : 'apply form';
  const consent = `yes; ${new Date().toISOString()}; ${form}; text v${CONSENT_V}${req.headers['cf-ipcountry'] ? '; ' + req.headers['cf-ipcountry'] : ''}`;
  d = {
    link: clip(d.link, 300), platform: pick(clip(d.platform, 20), ENUM.platform), revenue: pick(clip(d.revenue, 30), ENUM.revenue),
    monetization: pick(clip(d.monetization, 30), ENUM.monetization), live6: pick(clip(d.live6, 5), ENUM.live6), country: clip(d.country, 60),
    stack: pick(clip(d.stack, 20), ENUM.stack), tried: clip(d.tried, 2000), bottleneck: pick(clip(d.bottleneck, 60), ENUM.bottleneck),
    contact: clip(d.contact, 120), profile: clip(d.profile, 160), estimate: clip(d.estimate, 80), message: clip(d.message, 2000), source: pick(clip(d.source, 20), ENUM.source),
  };
  if (!STORE_RE.test(d.link)) return json(400, { ok: false, error: 'Paste a link to apps.apple.com or play.google.com.' });
  if (!EMAIL_RE.test(d.contact)) return json(400, { ok: false, error: 'Enter a valid email.' });
  const email = d.contact.toLowerCase();
  if (limited(ipk, accepted, 5)) return json(429, { ok: false, error: 'Too many requests, try again later.' });

  const app = await lookupApp(d.link).catch(() => null);
  const look = firstLook(app, root);
  const m = developerEmail(d, app, look, kind);
  let skip = !m ? 'nothing to send (app not found)' : mailCap(email);
  if (!skip && !(await hasMx(email))) skip = 'no MX for domain';
  const lead = leadEmail(d, app, look, kind, consent, skip ? `skipped: ${skip}` : `sent: ${m.subject}`);

  // durable copy first, then mail
  const record = { at: new Date().toISOString(), kind, form, app: app && (app.name || app.id), link: d.link, revenue: d.revenue, monetization: d.monetization, live6: d.live6, country: d.country, stack: d.stack, tried: d.tried, bottleneck: d.bottleneck, message: d.message, email, profile: d.profile, estimate: d.estimate, score: look && look.score, consent, visitorMail: skip ? `skipped: ${skip}` : 'sent' };
  let stored = false;
  if (LEADS_FILE) { try { fs.appendFileSync(LEADS_FILE, JSON.stringify(record) + '\n'); stored = true; } catch (e) { console.error('[apply] leads file', e.message); } }
  console.log('[apply]', JSON.stringify({ at: record.at, kind, form, app: record.app, score: record.score, contact: mask(email), visitorMail: record.visitorMail, stored }));

  const idem = sha(`${kind}|${d.link}|${email}|${Math.floor(Date.now() / HOUR)}`).slice(0, 40);
  const jobs = [sendMail({ from: MAIL_FROM, to: [LEADS_TO], reply_to: email, subject: lead.subject, html: lead.html, text: lead.text }, 'lead-' + idem)];
  if (!skip) {
    countMail(email);
    jobs.push(sendMail({ from: MAIL_FROM, to: [email], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text, headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=stop>` } }, 'dev-' + idem));
  }
  const results = await Promise.allSettled(jobs);
  results.forEach((r, i) => { if (r.status === 'rejected') console.error('[apply] mail failed', i === 0 ? 'lead' : 'visitor', String(r.reason && r.reason.message).slice(0, 120)); });
  const leadOk = results[0].status === 'fulfilled' && !results[0].value.skipped;
  // delivered: we have the lead somewhere durable; when false the apply page falls back to the visitor's mail app
  return json(200, { ok: true, delivered: leadOk || stored, emailed: !skip && !!results[1] && results[1].status === 'fulfilled' && !results[1].value.skipped });
}

module.exports = { handleApply, developerEmail, leadEmail, firstLook, lookupApp, ENUM };
