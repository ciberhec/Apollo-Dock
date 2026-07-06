const https = require('https');

const TIMEOUT_MS = 6000;

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    try {
      const url = new URL(urlStr);
      const req = https.get({
        hostname: url.hostname,
        path: url.pathname + url.search,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'ApolloD/2', 'Accept': 'application/json' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolved = true;
          resolve(httpGet(res.headers.location));
          return;
        }
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { resolved = true; resolve(data); });
      });
      req.on('timeout', () => { req.destroy(); if (!resolved) reject(new Error('timeout')); });
      req.on('error', (e) => { if (!resolved) reject(e); });
    } catch (e) {
      reject(e);
    }
  });
}

function tryJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function validDate(d) {
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t;
}

// ── RDAP via IANA bootstrap ──────────────────────────────────────────────────
let rdapBootstrap = null;

async function getBootstrap() {
  if (rdapBootstrap) return rdapBootstrap;
  const raw = await httpGet('https://data.iana.org/rdap/dns.json');
  const data = tryJson(raw);
  if (!data?.services) return null;
  rdapBootstrap = data;
  return data;
}

async function queryRDAP(domain) {
  try {
    const bootstrap = await getBootstrap();
    if (!bootstrap) return null;
    const tld = domain.split('.').pop().toLowerCase();
    let server = null;
    for (const [tlds, urls] of bootstrap.services) {
      if (tlds.map(t => t.toLowerCase()).includes(tld)) { server = urls[0]; break; }
    }
    if (!server) return null;
    const base = server.endsWith('/') ? server : server + '/';
    const raw = await httpGet(`${base}domain/${encodeURIComponent(domain)}`);
    const data = tryJson(raw);
    if (!data?.events) return null;
    const ev = data.events.find(e => e.eventAction === 'registration');
    if (!ev) return null;
    const date = validDate(ev.eventDate);
    return date ? { date, source: 'RDAP' } : null;
  } catch { return null; }
}

// ── crt.sh ───────────────────────────────────────────────────────────────────
async function queryCrtSh(domain) {
  try {
    const raw = await httpGet(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`);
    const data = tryJson(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    const dates = data
      .map(c => validDate(c.not_before))
      .filter(Boolean)
      .sort((a, b) => a - b);
    return dates.length ? { date: dates[0], source: 'crt.sh' } : null;
  } catch { return null; }
}

// ── Wayback Machine ──────────────────────────────────────────────────────────
async function queryWayback(domain) {
  try {
    const raw = await httpGet(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&limit=1&fl=timestamp&from=19900101`
    );
    const data = tryJson(raw);
    // Response: [["timestamp"], ["20051203103542"]] — header row + first result
    if (!Array.isArray(data) || data.length < 2) return null;
    const ts = data[1][0];
    if (!ts || ts.length < 8) return null;
    const date = validDate(`${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`);
    return date ? { date, source: 'Wayback Machine' } : null;
  } catch { return null; }
}

// ── HackerTarget WHOIS ───────────────────────────────────────────────────────
async function queryHackerTarget(domain) {
  try {
    const raw = await httpGet(`https://api.hackertarget.com/whois/?q=${encodeURIComponent(domain)}`);
    if (typeof raw !== 'string') return null;
    const patterns = [
      /creation date:\s*(.+)/i,
      /created:\s*(.+)/i,
      /registered on:\s*(.+)/i,
      /registration date:\s*(.+)/i,
      /created date:\s*(.+)/i,
      /domain registered:\s*(.+)/i,
    ];
    for (const pat of patterns) {
      const m = raw.match(pat);
      if (m) {
        const date = validDate(m[1].trim().split('\n')[0].trim());
        if (date) return { date, source: 'HackerTarget' };
      }
    }
    return null;
  } catch { return null; }
}

// ── CIRCL Passive DNS ────────────────────────────────────────────────────────
async function queryCIRCL(domain) {
  try {
    const raw = await httpGet(`https://www.circl.lu/pdns/query/${encodeURIComponent(domain)}`);
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const records = raw.trim().split('\n')
      .map(l => tryJson(l))
      .filter(Boolean)
      .filter(r => r.time_first);
    if (!records.length) return null;
    records.sort((a, b) => a.time_first - b.time_first);
    const date = validDate(new Date(records[0].time_first * 1000).toISOString());
    return date ? { date, source: 'CIRCL Passive DNS' } : null;
  } catch { return null; }
}

// ── DNS SOA serial ───────────────────────────────────────────────────────────
async function querySOASerial(domain) {
  try {
    const raw = await httpGet(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=SOA`);
    const data = tryJson(raw);
    if (!data?.Answer) return null;
    const soa = data.Answer.find(r => r.type === 6);
    if (!soa?.data) return null;
    // SOA data: "ns1.example.com. admin.example.com. 2023110501 3600 900 604800 300"
    const serial = soa.data.split(' ')[2];
    if (!serial || serial.length !== 10) return null;
    const s = serial.toString();
    if (!/^\d{10}$/.test(s)) return null;
    const y = s.slice(0,4), mo = s.slice(4,6), d = s.slice(6,8);
    const year = parseInt(y);
    if (year < 1990 || year > 2030) return null;
    const date = validDate(`${y}-${mo}-${d}`);
    return date ? { date, source: 'SOA Serial' } : null;
  } catch { return null; }
}

// ── Synthesize ───────────────────────────────────────────────────────────────
function formatAge(date) {
  const ageDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (ageDays < 30) return `${ageDays} day${ageDays !== 1 ? 's' : ''}`;
  if (ageDays < 365) {
    const mo = Math.floor(ageDays / 30);
    return `${mo} month${mo !== 1 ? 's' : ''}`;
  }
  const yrs = Math.floor(ageDays / 365);
  const mo  = Math.floor((ageDays % 365) / 30);
  const yStr = `${yrs} year${yrs !== 1 ? 's' : ''}`;
  return mo > 0 ? `${yStr}, ${mo} month${mo !== 1 ? 's' : ''}` : yStr;
}

function classifyAge(date) {
  const ageDays = (Date.now() - date.getTime()) / 86400000;
  if (ageDays < 182) return 'new';
  if (ageDays < 365) return 'young';
  return 'established';
}

async function lookupDomainAge(domain) {
  const results = await Promise.allSettled([
    queryRDAP(domain),
    queryCrtSh(domain),
    queryWayback(domain),
    queryHackerTarget(domain),
    queryCIRCL(domain),
    querySOASerial(domain),
  ]);

  const hits = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => a.date - b.date);

  if (hits.length === 0) {
    return { bucket: 'unknown', ageText: null, sources: [], confidence: 0 };
  }

  const earliest = hits[0];
  return {
    bucket: classifyAge(earliest.date),
    ageText: formatAge(earliest.date),
    earliestDate: earliest.date.toISOString().split('T')[0],
    sources: hits.map(h => h.source),
    confidence: hits.length,
  };
}

module.exports = { lookupDomainAge };
