const dns = require('dns').promises;

const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 's1', 's2', 'default', 'mail', 'k1', 'dkim', 'smtp'];

const DNSBLS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net'
];

// Naive list of common compound TLDs so we treat `co.uk`, `com.mx`, etc. as a single suffix
// instead of stripping them too aggressively. Not a full PSL but covers the cases we see.
const COMPOUND_TLDS = new Set([
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.il',
  'com.au', 'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.tr', 'com.tw', 'com.cn', 'com.sg',
  'org.uk', 'gov.uk', 'ac.uk',
  'net.au', 'gov.au', 'org.au',
  'ne.jp', 'or.jp', 'ac.jp'
]);

function getRootDomain(domain) {
  const parts = String(domain || '').toLowerCase().split('.');
  if (parts.length < 2) return domain;
  const lastTwo = parts.slice(-2).join('.');
  if (COMPOUND_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function isSubdomain(domain) {
  return getRootDomain(domain) !== domain;
}

async function lookupTxt(name) {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((parts) => parts.join(''));
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
    throw err;
  }
}

async function getSpf(domain) {
  const records = await lookupTxt(domain).catch(() => []);
  const spf = records.find((r) => r.toLowerCase().startsWith('v=spf1'));
  return spf || null;
}

async function getDmarc(domain) {
  const records = await lookupTxt(`_dmarc.${domain}`).catch(() => []);
  const dmarc = records.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
  return dmarc || null;
}

async function getDkim(domain) {
  for (const selector of DKIM_SELECTORS) {
    try {
      const host = `${selector}._domainkey.${domain}`;
      const records = await lookupTxt(host);
      const dkim = records.find((r) => /v=dkim1/i.test(r) || /p=/i.test(r));
      if (dkim) {
        return { selector, record: dkim };
      }
    } catch {
      // continue to next selector
    }
  }
  return null;
}

async function getMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

async function getNs(domain) {
  try {
    return await dns.resolveNs(domain);
  } catch {
    return [];
  }
}

async function getA(domain) {
  try {
    return await dns.resolve4(domain);
  } catch {
    return [];
  }
}

function reverseIp(ip) {
  return ip.split('.').reverse().join('.');
}

async function checkBlacklist(ip) {
  const reversed = reverseIp(ip);
  const results = [];
  await Promise.all(
    DNSBLS.map(async (bl) => {
      const host = `${reversed}.${bl}`;
      try {
        const addrs = await dns.resolve4(host);
        if (addrs && addrs.length > 0) {
          results.push({ blacklist: bl, listed: true, response: addrs[0] });
        }
      } catch {
        results.push({ blacklist: bl, listed: false });
      }
    })
  );
  return results;
}

async function checkAllBlacklists(ips) {
  const allResults = [];
  for (const ip of ips) {
    const results = await checkBlacklist(ip);
    results.forEach((r) => allResults.push({ ip, ...r }));
  }
  return allResults;
}

// Email security gateways sit in front of the real mailbox provider and rewrite
// the MX records so only the gateway is visible. Detecting one is the trigger
// to go look for the real backend with the helpers below.
const GATEWAY_PATTERNS = [
  { name: 'Barracuda', patterns: ['barracudanetworks.com', 'barracuda.com'] },
  { name: 'Mimecast', patterns: ['mimecast.com', 'mimecast.co.uk', 'mimecast-offshore.com', 'mimecast.co.za'] },
  { name: 'Proofpoint', patterns: ['pphosted.com', 'ppe-hosted.com', 'mxlogic.net', 'proofpoint.com'] },
  { name: 'Cisco IronPort', patterns: ['iphmx.com', 'iron.tools'] }
];

function detectGateway(mxRecords) {
  const mxJoined = mxRecords.map((m) => m.exchange.toLowerCase()).join(' ');
  for (const g of GATEWAY_PATTERNS) {
    if (g.patterns.some((p) => mxJoined.includes(p))) return g.name;
  }
  return null;
}

// When a gateway is detected, these helpers look for independent signals in
// other DNS records to identify the real mailbox provider behind it.

const BACKEND_SPF_INCLUDES = [
  { pattern: 'spf.protection.outlook.com', infers: 'Microsoft 365' },
  { pattern: '_spf.google.com', infers: 'Google Workspace' },
  { pattern: 'spf.mail.zoho.com', infers: 'Zoho Mail' }
];

function inferBackendFromSpf(spf) {
  if (!spf) return null;
  const lower = spf.toLowerCase();
  for (const b of BACKEND_SPF_INCLUDES) {
    if (lower.includes(b.pattern)) {
      return { source: 'spf', value: b.pattern, infers: b.infers };
    }
  }
  return null;
}

async function getAutodiscoverCname(domain) {
  try {
    const records = await dns.resolveCname(`autodiscover.${domain}`);
    return records || [];
  } catch {
    return [];
  }
}

function inferBackendFromAutodiscover(autodiscoverRecords) {
  if (!autodiscoverRecords || autodiscoverRecords.length === 0) return null;
  const joined = autodiscoverRecords.join(' ').toLowerCase();
  if (joined.includes('outlook.com')) {
    return { source: 'autodiscover', value: autodiscoverRecords.join(', '), infers: 'Microsoft 365' };
  }
  return null;
}

async function getMsTenantTxt(domain) {
  const txts = await lookupTxt(domain).catch(() => []);
  const ms = txts.find((t) => /^MS=ms\d+/i.test(t));
  return ms || null;
}

function inferBackendFromMsTenant(msTenantTxt) {
  if (!msTenantTxt) return null;
  return { source: 'ms-tenant', value: msTenantTxt, infers: 'Microsoft 365' };
}

function inferBackendFromDkim(dkim) {
  if (!dkim) return null;
  const sel = dkim.selector;
  if (sel === 'google') return { source: 'dkim-selector', value: sel, infers: 'Google Workspace' };
  if (sel === 'selector1' || sel === 'selector2') return { source: 'dkim-selector', value: sel, infers: 'Microsoft 365' };
  return null;
}

function buildMailFlow({ gateway, spf, dkim, autodiscover, msTenant }) {
  if (!gateway) return null;

  const signals = [
    inferBackendFromSpf(spf),
    inferBackendFromAutodiscover(autodiscover),
    inferBackendFromMsTenant(msTenant),
    inferBackendFromDkim(dkim)
  ].filter(Boolean);

  // Tally votes per inferred backend so we can spot agreement vs. conflict.
  const counts = {};
  signals.forEach((s) => { counts[s.infers] = (counts[s.infers] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  let backend = null;
  let confidence = null;
  if (entries.length > 0) {
    backend = entries[0][0];
    if (entries.length > 1) confidence = 'low';
    else if (entries[0][1] >= 2) confidence = 'high';
    else confidence = 'medium';
  }

  return { gateway, backend, confidence, signals };
}

function detectProvider(mxRecords, nsRecords) {
  const mxJoined = mxRecords.map((m) => m.exchange.toLowerCase()).join(' ');
  const nsJoined = nsRecords.map((n) => n.toLowerCase()).join(' ');

  if (mxJoined.includes('google.com') || mxJoined.includes('googlemail.com')) return 'Google Workspace';
  if (mxJoined.includes('mail.protection.outlook.com') || mxJoined.includes('outlook.com')) return 'Microsoft 365';
  if (mxJoined.includes('zoho')) return 'Zoho Mail';
  if (mxJoined.includes('mailgun')) return 'Mailgun';
  if (mxJoined.includes('sendgrid')) return 'SendGrid';
  if (mxJoined.includes('amazonaws.com')) return 'Amazon SES';
  if (nsJoined.includes('googledomains') || nsJoined.includes('google.com')) return 'Google (DNS only)';
  if (nsJoined.includes('cloudflare')) return 'Cloudflare (DNS)';

  return 'Unknown';
}

async function fullLookup(domain) {
  const errors = {};
  const result = {
    domain,
    spf: null,
    dmarc: null,
    dkim: null,
    mx: [],
    ns: [],
    a: [],
    autodiscover: [],
    msTenant: null,
    blacklists: [],
    provider: 'Unknown',
    mailFlow: null,
    errors
  };

  await Promise.all([
    getSpf(domain).then((r) => { result.spf = r; }).catch((e) => { errors.spf = e.message; }),
    getDmarc(domain).then((r) => { result.dmarc = r; }).catch((e) => { errors.dmarc = e.message; }),
    getDkim(domain).then((r) => { result.dkim = r; }).catch((e) => { errors.dkim = e.message; }),
    getMx(domain).then((r) => { result.mx = r; }).catch((e) => { errors.mx = e.message; }),
    getNs(domain).then((r) => { result.ns = r; }).catch((e) => { errors.ns = e.message; }),
    getA(domain).then((r) => { result.a = r; }).catch((e) => { errors.a = e.message; }),
    getAutodiscoverCname(domain).then((r) => { result.autodiscover = r; }).catch((e) => { errors.autodiscover = e.message; }),
    getMsTenantTxt(domain).then((r) => { result.msTenant = r; }).catch((e) => { errors.msTenant = e.message; })
  ]);

  const gateway = detectGateway(result.mx);
  result.mailFlow = buildMailFlow({
    gateway,
    spf: result.spf,
    dkim: result.dkim,
    autodiscover: result.autodiscover,
    msTenant: result.msTenant
  });

  // Pick the "effective" provider for recommendations. Backend wins when the
  // signals agree (high or medium confidence), so SPF/DKIM tips target the real
  // mailbox. Low confidence (signals disagree) falls back to the gateway label
  // so recommendations stay generic — the Provider card already tells the tester
  // to confirm with the customer.
  if (result.mailFlow?.backend && (result.mailFlow.confidence === 'high' || result.mailFlow.confidence === 'medium')) {
    result.provider = result.mailFlow.backend;
  } else if (gateway) {
    result.provider = gateway;
  } else {
    result.provider = detectProvider(result.mx, result.ns);
  }

  if (result.a.length > 0) {
    try {
      result.blacklists = await checkAllBlacklists(result.a);
    } catch (e) {
      errors.blacklists = e.message;
    }
  }

  return result;
}

module.exports = {
  DKIM_SELECTORS,
  DNSBLS,
  GATEWAY_PATTERNS,
  fullLookup,
  getSpf,
  getDmarc,
  getDkim,
  getMx,
  getNs,
  getA,
  getAutodiscoverCname,
  getMsTenantTxt,
  checkAllBlacklists,
  detectProvider,
  detectGateway,
  buildMailFlow,
  getRootDomain,
  isSubdomain
};
