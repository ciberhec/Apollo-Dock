const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchHtml(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return cheerio.load(res.data);
}

async function scrapeMxToolboxSpf(domain) {
  try {
    const $ = await fetchHtml(`https://mxtoolbox.com/spf.aspx?domain=${encodeURIComponent(domain)}`);
    const text = $('body').text();
    const match = text.match(/v=spf1[^"<\n]+/i);
    return match ? match[0].trim() : null;
  } catch {
    return null;
  }
}

async function scrapeMxToolboxDmarc(domain) {
  try {
    const $ = await fetchHtml(`https://mxtoolbox.com/dmarc.aspx?domain=${encodeURIComponent(domain)}`);
    const text = $('body').text();
    const match = text.match(/v=DMARC1[^"<\n]+/i);
    return match ? match[0].trim() : null;
  } catch {
    return null;
  }
}

async function scrapeMxToolboxBlacklist(domain) {
  try {
    const $ = await fetchHtml(`https://mxtoolbox.com/blacklists.aspx?domain=${encodeURIComponent(domain)}`);
    const text = $('body').text();
    const listed = /listed/i.test(text) && !/not\s+listed/i.test(text);
    return { scrapedListedFlag: listed, source: 'mxtoolbox' };
  } catch {
    return null;
  }
}

async function scrapeGlockAppsDkim(domain) {
  // GlockApps DKIM check is interactive; we attempt a polite GET as a hint.
  try {
    const $ = await fetchHtml(`https://glockapps.com/dkim-check/`);
    return { note: 'GlockApps DKIM check requires interactive submission; visit page in browser.', domain };
  } catch {
    return null;
  }
}

async function scrapeFallback(domain, missing) {
  const out = {};
  if (missing.spf) out.spf = await scrapeMxToolboxSpf(domain);
  if (missing.dmarc) out.dmarc = await scrapeMxToolboxDmarc(domain);
  if (missing.blacklists) out.blacklists = await scrapeMxToolboxBlacklist(domain);
  if (missing.dkim) out.dkim = await scrapeGlockAppsDkim(domain);
  return out;
}

module.exports = {
  scrapeMxToolboxSpf,
  scrapeMxToolboxDmarc,
  scrapeMxToolboxBlacklist,
  scrapeGlockAppsDkim,
  scrapeFallback
};
