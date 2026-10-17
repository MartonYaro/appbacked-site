// POST /api/apply: a developer sends their app from appbacked.com/apply/.
// 1. validate, rate-limit, honeypot   2. look up the app and run the same audit as /app-store-audit/
// 3. email the developer a first look in our voice (if they left an email)   4. email the lead to us
// Email goes through Resend when RESEND_API_KEY is set; without it the lead is only logged.
// Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, LEADS_TO. Zero dependencies (Node 18+ fetch).
const fs = require('fs');
const path = require('path');

const MAIL_FROM = process.env.MAIL_FROM || 'Yaro at AppBacked <hello@appbacked.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'ceo@appbacked.com';
const LEADS_TO = process.env.LEADS_TO || 'info@appbacked.com';
const SITE = 'https://appbacked.com';
const STORE_RE = /^(https?:\/\/)?(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)\/\S+/i;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;

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

const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

async function lookupApp(link) {
  const ios = link.match(/\/id(\d{5,})/);
  if (!ios) {
    const play = link.match(/[?&]id=([\w.]+)/);
    return play ? { store: 'play', id: play[1], name: play[1] } : null;
  }
  for (const country of ['us', 'gb']) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${ios[1]}&country=${country}`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.results && j.results[0]) return { store: 'ios', id: ios[1], name: j.results[0].trackName, data: j.results[0], country };
    } catch (_) { /* try next storefront */ }
  }
  return { store: 'ios', id: ios[1], name: 'your app' };
}

function firstLook(app, root) {
  const a = loadAudit(root);
  if (!app || !app.data || !a) return null;
  const list = a.checks(app.data);
  const scored = list.filter(c => c.w > 0);
  const order = { bad: 0, warn: 1, good: 2 };
  const fixes = scored.filter(c => c.s !== 'good').sort((x, y) => order[x.s] - order[y.s] || y.w - x.w).slice(0, 3);
  const good = scored.filter(c => c.s === 'good').sort((x, y) => y.w - x.w).slice(0, 2);
  return { score: a.score(list), fixes, good };
}

const label = s => s >= 85 ? 'A strong page' : s >= 70 ? 'Solid, with gaps' : s >= 50 ? 'Leaving installs on the table' : 'Lots of upside';

function developerEmail(d, app, look) {
  const name = app && app.name && app.name !== 'your app' ? app.name : 'your app';
  const subject = look ? `${name}: a first look from AppBacked` : `We got ${name}`;
  const scoreHtml = look ? `
    <tr><td style="padding:0 32px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F4F2EC;border-radius:12px">
        <tr><td style="padding:20px 22px">
          <div style="font:500 11px/1.4 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:#2230E6">Store page score</div>
          <div style="font:800 40px/1.1 Arial,sans-serif;color:#14151F;margin-top:6px">${look.score}<span style="font-size:18px;color:#4A4D5C">/100</span></div>
          <div style="font:400 14px/1.5 Arial,sans-serif;color:#4A4D5C;margin-top:2px">${esc(label(look.score))}. Based on public App Store data.</div>
        </td></tr>
      </table>
    </td></tr>
    ${look.fixes.length ? `<tr><td style="padding:16px 32px 0;font:700 16px/1.4 Arial,sans-serif;color:#14151F">What we'd look at first</td></tr>
    ${look.fixes.map(f => `<tr><td style="padding:10px 32px 0;font:400 14px/1.55 Arial,sans-serif;color:#14151F"><b>${esc(f.t)}</b> <span style="color:#4A4D5C">(${esc(f.v)})</span><br><span style="color:#4A4D5C">${esc(f.fix)}</span></td></tr>`).join('')}` : ''}
    ${look.good.length ? `<tr><td style="padding:16px 32px 0;font:400 14px/1.55 Arial,sans-serif;color:#4A4D5C">Already good: ${look.good.map(g => esc(g.t.toLowerCase())).join(' and ')}.</td></tr>` : ''}` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#E9E7E0">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#E9E7E0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#FBFAF6;border-radius:16px;overflow:hidden">
  <tr><td style="background:#2230E6;padding:26px 32px">
    <img src="${SITE}/brand/png/appbacked-lockup-on-blue.png" width="150" alt="AppBacked" style="display:block;border:0;width:150px;height:auto">
    <div style="font:800 26px/1.15 Arial,sans-serif;color:#F4F2EC;margin-top:18px">We got <span style="color:#D9FF3D">${esc(name)}</span>.</div>
  </td></tr>
  <tr><td style="padding:26px 32px 18px;font:400 15px/1.6 Arial,sans-serif;color:#14151F">Thanks for sending it. ${look ? 'While a person on our team reviews it, here is what the same audit we run on every app shows.' : 'A person on our team is reviewing it now.'}</td></tr>
  ${scoreHtml}
  <tr><td style="padding:22px 32px 0;font:700 16px/1.4 Arial,sans-serif;color:#14151F">What happens next</td></tr>
  <tr><td style="padding:8px 32px 0;font:400 14px/1.6 Arial,sans-serif;color:#14151F">Within 48 hours you get a written reply: the budget we'd put in, the channels and what we'd fix first. Or a straight no, with the reason.</td></tr>
  <tr><td style="padding:12px 32px 0;font:400 14px/1.6 Arial,sans-serif;color:#14151F">It speeds things up if you reply with your monthly revenue trend and what you've already tried for growth.</td></tr>
  <tr><td style="padding:22px 32px 28px;font:400 14px/1.6 Arial,sans-serif;color:#14151F">Yaro<br><span style="color:#4A4D5C">Founder, AppBacked</span></td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #DCD8CC;font:400 12px/1.5 Arial,sans-serif;color:#4A4D5C">You're getting this because you sent ${esc(name)} at appbacked.com. One email about your application, nothing else. <a href="${SITE}/legal/privacy/" style="color:#2230E6">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `We got ${name}.`, '',
    `Thanks for sending it.${look ? ' While a person on our team reviews it, here is what our audit shows.' : ''}`, '',
    ...(look ? [`Store page score: ${look.score}/100. ${label(look.score)}.`, '', ...(look.fixes.length ? ['What we\'d look at first:', ...look.fixes.map(f => `- ${f.t} (${f.v}): ${f.fix}`), ''] : [])] : []),
    'What happens next: within 48 hours you get a written reply with the budget we\'d put in, the channels and what we\'d fix first. Or a straight no, with the reason.', '',
    'It speeds things up if you reply with your monthly revenue trend and what you\'ve already tried for growth.', '',
    'Yaro', 'Founder, AppBacked', SITE,
  ].join('\n');
  return { subject, html, text };
}

function leadEmail(d, app, look) {
  const rows = [
    ['App', app && app.name ? app.name : '?'], ['Link', d.link], ['Platform', d.platform], ['Revenue', d.revenue],
    ['Bottleneck', d.bottleneck], ['Contact', d.contact], ['Estimate', d.estimate], ['Message', d.message],
    ['Audit', look ? `${look.score}/100; ${look.fixes.map(f => f.t).join(', ')}` : 'n/a'],
    ['Store data', app && app.data ? `${app.data.userRatingCount || 0} ratings, ${(app.data.averageUserRating || 0).toFixed(1)}★, ${(app.data.languageCodesISO2A || []).length} languages, ${app.data.primaryGenreName}, ${app.country}` : 'n/a'],
  ];
  const html = `<table cellpadding="6" style="font:14px Arial,sans-serif;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v || '—')}</td></tr>`).join('')}</table>`;
  const text = rows.map(([k, v]) => `${k}: ${v || '—'}`).join('\n');
  return { subject: `New application: ${app && app.name ? app.name : d.link}${d.revenue ? ' · ' + d.revenue : ''}`, html, text };
}

async function sendMail(msg) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApply(req, res, root) {
  const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return json(429, { ok: false, error: 'Too many requests, try again later.' });
  let d;
  try { d = JSON.parse(await readBody(req)); } catch (_) { return json(400, { ok: false, error: 'Bad request.' }); }
  if (d.website) return json(200, { ok: true }); // honeypot: pretend success
  d = {
    link: clip(d.link, 300), platform: clip(d.platform, 20), revenue: clip(d.revenue, 30), bottleneck: clip(d.bottleneck, 60),
    contact: clip(d.contact, 120), estimate: clip(d.estimate, 80), message: clip(d.message, 2000),
  };
  if (!STORE_RE.test(d.link)) return json(400, { ok: false, error: 'Paste a link to apps.apple.com or play.google.com.' });
  if (d.contact.length < 3) return json(400, { ok: false, error: 'We need a way to reach you.' });

  const app = await lookupApp(d.link).catch(() => null);
  const look = firstLook(app, root);
  const lead = leadEmail(d, app, look);
  console.log('[apply]', JSON.stringify({ at: new Date().toISOString(), app: app && app.name, link: d.link, revenue: d.revenue, contact: d.contact, score: look && look.score }));

  const email = EMAIL_RE.test(d.contact) ? d.contact : null;
  const jobs = [sendMail({ from: MAIL_FROM, to: [LEADS_TO], subject: lead.subject, html: lead.html, text: lead.text, ...(email ? { reply_to: email } : {}) })];
  if (email) {
    const m = developerEmail(d, app, look);
    jobs.push(sendMail({ from: MAIL_FROM, to: [email], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text }));
  }
  const results = await Promise.allSettled(jobs);
  results.forEach(r => { if (r.status === 'rejected') console.error('[apply] mail failed', r.reason && r.reason.message); });
  // delivered = the lead reached our inbox; when false the page falls back to the visitor's mail app
  const delivered = results[0].status === 'fulfilled' && !results[0].value.skipped;
  return json(200, { ok: true, delivered });
}

module.exports = { handleApply, developerEmail, leadEmail, firstLook, lookupApp };
