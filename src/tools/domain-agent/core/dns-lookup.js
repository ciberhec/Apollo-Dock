const dns = require('dns').promises;

const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 's1', 's2', 'default', 'mail', 'k1', 'dkim', 'smtp'];

const DNSBLS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net'
];

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
    blacklists: [],
    provider: 'Unknown',
    errors
  };

  await Promise.all([
    getSpf(domain).then((r) => { result.spf = r; }).catch((e) => { errors.spf = e.message; }),
    getDmarc(domain).then((r) => { result.dmarc = r; }).catch((e) => { errors.dmarc = e.message; }),
    getDkim(domain).then((r) => { result.dkim = r; }).catch((e) => { errors.dkim = e.message; }),
    getMx(domain).then((r) => { result.mx = r; }).catch((e) => { errors.mx = e.message; }),
    getNs(domain).then((r) => { result.ns = r; }).catch((e) => { errors.ns = e.message; }),
    getA(domain).then((r) => { result.a = r; }).catch((e) => { errors.a = e.message; })
  ]);

  result.provider = detectProvider(result.mx, result.ns);

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
  fullLookup,
  getSpf,
  getDmarc,
  getDkim,
  getMx,
  getNs,
  getA,
  checkAllBlacklists,
  detectProvider
};
