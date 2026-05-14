/**
 * Static analysis engine for email authentication records.
 *
 * Reference docs:
 *  - Microsoft 365 email authentication:
 *      https://learn.microsoft.com/en-us/defender-office-365/email-authentication-about
 *  - Google Workspace authentication methods:
 *      https://knowledge.workspace.google.com/admin/security/about-authentication-methods
 *
 * Status values: 'pass' | 'warn' | 'fail' | 'info'
 */

const STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail', INFO: 'info' };

function countSpfLookups(spfRecord) {
  if (!spfRecord) return 0;
  const lookupMechanisms = (spfRecord.match(/\b(include|a|mx|ptr|exists|redirect)[:=]/gi) || []).length;
  return lookupMechanisms;
}

function analyzeSpf(spf, provider) {
  if (!spf) {
    return {
      key: 'SPF',
      status: STATUS.FAIL,
      value: null,
      summary: 'No SPF record published on the root domain.',
      details: 'SPF tells receiving mail servers which IPs are authorized to send mail on behalf of this domain. Without it, messages are far more likely to be rejected or marked as spam.',
      recommendation: buildSpfRecommendation(null, provider)
    };
  }

  const issues = [];
  const lookups = countSpfLookups(spf);
  if (lookups > 10) issues.push(`SPF performs ${lookups} DNS lookups (RFC 7208 hard limit is 10). Receivers will treat this as a PermError.`);

  const validSyntax = /^v=spf1\b/i.test(spf) && /(\s[-~+?]all\b|\sredirect=)/i.test(spf);
  if (!validSyntax) issues.push('SPF record is missing a terminating `all` mechanism or `redirect=` modifier.');

  let status = STATUS.PASS;
  if (/\s\+all\b/i.test(spf)) {
    issues.push('Record ends in `+all` — this authorizes every server in the world to send mail as this domain. Critical misconfiguration.');
    status = STATUS.FAIL;
  } else if (/\s\?all\b/i.test(spf)) {
    issues.push('Record ends in `?all` (neutral). Recommend tightening to `~all` (soft fail) or `-all` (hard fail).');
    status = STATUS.WARN;
  } else if (/\s~all\b/i.test(spf)) {
    if (status === STATUS.PASS) status = STATUS.PASS;
  } else if (/\s-all\b/i.test(spf)) {
    if (status === STATUS.PASS) status = STATUS.PASS;
  }

  if (issues.length && status === STATUS.PASS) status = STATUS.WARN;

  return {
    key: 'SPF',
    status,
    value: spf,
    summary: status === STATUS.PASS ? 'SPF record is present and well-formed.' : 'SPF record has issues that need attention.',
    details: issues.length ? issues.join(' ') : `SPF lookups used: ${lookups}/10.`,
    recommendation: status === STATUS.PASS ? null : buildSpfRecommendation(spf, provider),
    extra: { lookups }
  };
}

function buildSpfRecommendation(currentSpf, provider) {
  let suggested;
  if (provider === 'Google Workspace') {
    suggested = 'v=spf1 include:_spf.google.com ~all';
  } else if (provider === 'Microsoft 365') {
    suggested = 'v=spf1 include:spf.protection.outlook.com ~all';
  } else {
    suggested = 'v=spf1 include:<your-mail-provider-include> ~all';
  }

  return {
    where: 'Publish as a TXT record on the root domain (e.g. @ or yourdomain.com).',
    record: suggested,
    note: 'Use `-all` once you are confident every legitimate sender is listed. Until then, `~all` (soft fail) is the safer rollout.',
    docs: provider === 'Microsoft 365'
      ? 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure'
      : 'https://support.google.com/a/answer/33786'
  };
}

function analyzeDmarc(dmarc, provider) {
  if (!dmarc) {
    return {
      key: 'DMARC',
      status: STATUS.FAIL,
      value: null,
      summary: 'No DMARC record published.',
      details: 'DMARC tells receiving servers how to handle messages that fail SPF or DKIM alignment, and gives the domain owner visibility via reports.',
      recommendation: buildDmarcRecommendation(null)
    };
  }

  const issues = [];
  const policy = (dmarc.match(/p=(none|quarantine|reject)/i) || [, null])[1];
  const ruaMatch = dmarc.match(/rua=mailto:[^;\s]+/i);
  const validSyntax = /^v=DMARC1\b/i.test(dmarc) && policy;
  if (!validSyntax) issues.push('DMARC syntax is invalid — missing `v=DMARC1` or `p=` policy.');

  let status = STATUS.PASS;
  if (policy === 'none') { status = STATUS.WARN; issues.push('Policy is `p=none` — monitor-only. Domain is not yet protected from spoofing.'); }
  if (policy === 'quarantine') status = STATUS.PASS;
  if (policy === 'reject') status = STATUS.PASS;

  if (!ruaMatch) {
    issues.push('No `rua=` aggregate reporting address. You will not receive failure reports.');
    if (status === STATUS.PASS) status = STATUS.WARN;
  }

  return {
    key: 'DMARC',
    status,
    value: dmarc,
    summary: validSyntax
      ? `DMARC published with policy ${policy}.`
      : 'DMARC record has syntax issues.',
    details: issues.length ? issues.join(' ') : 'DMARC is published with reporting and an enforcement policy.',
    recommendation: status === STATUS.PASS ? null : buildDmarcRecommendation(policy),
    extra: { policy, rua: ruaMatch ? ruaMatch[0] : null }
  };
}

function buildDmarcRecommendation(currentPolicy) {
  const stage = !currentPolicy
    ? 'v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; fo=1'
    : currentPolicy === 'none'
      ? 'v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@yourdomain.com; fo=1'
      : 'v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; fo=1';

  return {
    where: 'Publish as a TXT record at the subdomain `_dmarc.yourdomain.com`.',
    record: stage,
    note: !currentPolicy
      ? 'Start with `p=none` to gather reports for 2–4 weeks, then progress to quarantine and reject.'
      : 'Replace `yourdomain.com` in the reporting address with a mailbox you actively monitor.',
    docs: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure'
  };
}

function estimateDkimKeyBits(dkimRecord) {
  if (!dkimRecord) return null;
  const pMatch = dkimRecord.match(/p=([A-Za-z0-9+/=]+)/);
  if (!pMatch) return null;
  // Base64 length to byte count, then bytes to bits (rough estimate of public key size).
  const b64 = pMatch[1];
  const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  // The DER-encoded RSA public key adds ~36 bytes of overhead before the modulus.
  const modulusBytes = Math.max(0, bytes - 38);
  return modulusBytes * 8;
}

function analyzeDkim(dkim, provider) {
  if (!dkim) {
    return {
      key: 'DKIM',
      status: STATUS.FAIL,
      value: null,
      summary: 'No DKIM record found on common selectors.',
      details: 'Checked the standard selectors (google, selector1/2, s1/2, default, mail, k1, dkim, smtp). If DKIM is published under a custom selector, it must be verified manually.',
      recommendation: buildDkimRecommendation(provider, null)
    };
  }

  const bits = estimateDkimKeyBits(dkim.record);
  const issues = [];
  let status = STATUS.PASS;

  if (bits !== null && bits < 1024) {
    issues.push(`DKIM key length is approximately ${bits} bits — below the recommended 1024-bit minimum.`);
    status = STATUS.WARN;
  }

  if (/p=\s*(;|$)/i.test(dkim.record)) {
    issues.push('DKIM record has an empty `p=` value, which revokes the key. Receivers will treat all signatures as invalid.');
    status = STATUS.FAIL;
  }

  return {
    key: 'DKIM',
    status,
    value: dkim.record,
    summary: status === STATUS.PASS
      ? `DKIM is published on selector \`${dkim.selector}\`.`
      : `DKIM found on selector \`${dkim.selector}\` but has issues.`,
    details: issues.length ? issues.join(' ') : `Selector: ${dkim.selector}. Estimated key length: ${bits ?? 'unknown'} bits.`,
    recommendation: status === STATUS.PASS ? null : buildDkimRecommendation(provider, dkim.selector),
    extra: { selector: dkim.selector, bits }
  };
}

function buildDkimRecommendation(provider, currentSelector) {
  if (provider === 'Google Workspace') {
    return {
      where: 'Google Admin Console → Apps → Google Workspace → Gmail → Authenticate email. Generate a 2048-bit key and publish the TXT record at `google._domainkey.yourdomain.com`.',
      record: 'v=DKIM1; k=rsa; p=<public_key_generated_by_google>',
      note: currentSelector
        ? `Re-generate the DKIM key with a 2048-bit length and replace the existing TXT record on selector \`${currentSelector}\`.`
        : 'Generate a 2048-bit key in the Google Admin Console and publish the TXT record it generates.',
      docs: 'https://support.google.com/a/answer/174124'
    };
  }
  if (provider === 'Microsoft 365') {
    return {
      where: 'Microsoft Defender → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Enable DKIM signing, then publish the two CNAMEs `selector1._domainkey` and `selector2._domainkey` pointing at the values Microsoft displays.',
      record: 'selector1._domainkey.yourdomain.com CNAME selector1-yourdomain-com._domainkey.yourtenant.onmicrosoft.com',
      note: 'Microsoft 365 uses CNAMEs (not TXT records) so that they can rotate keys for you automatically.',
      docs: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure'
    };
  }
  return {
    where: 'Publish a TXT record at `<selector>._domainkey.yourdomain.com` using the selector and key value your mail provider gives you.',
    record: 'v=DKIM1; k=rsa; p=<your_public_key>',
    note: 'Ask your mail provider to generate a 2048-bit DKIM key and provide the public key and selector to publish.',
    docs: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-about'
  };
}

function analyzeBlacklists(blacklistResults) {
  if (!blacklistResults || blacklistResults.length === 0) {
    return {
      key: 'Blacklist',
      status: STATUS.INFO,
      value: null,
      summary: 'No IPs resolved for the root domain, so blacklist status could not be checked.',
      details: 'This is normal for parked domains or domains that publish only MX records. Check the sending mail server IPs directly.',
      recommendation: null
    };
  }

  const listings = blacklistResults.filter((r) => r.listed);
  if (listings.length === 0) {
    return {
      key: 'Blacklist',
      status: STATUS.PASS,
      value: 'Clean',
      summary: 'Not listed on any of the major public DNSBLs checked.',
      details: 'Checked Spamhaus ZEN, SpamCop, Barracuda, and SORBS.',
      recommendation: null
    };
  }

  const byList = listings.map((l) => `${l.blacklist} (${l.ip})`).join(', ');
  return {
    key: 'Blacklist',
    status: STATUS.FAIL,
    value: byList,
    summary: `Listed on ${listings.length} DNSBL${listings.length > 1 ? 's' : ''}.`,
    details: `Active listings: ${byList}. Delivery to major providers will be severely impacted until delisted.`,
    recommendation: {
      where: 'Visit each blacklist provider directly and submit a delisting request after fixing the underlying issue (open relay, compromised account, spam complaints).',
      record: null,
      note: 'Identify the root cause before requesting delisting — most blacklists relist quickly if the issue is unresolved.',
      docs: 'https://www.spamhaus.org/lookup/'
    }
  };
}

function analyzeProvider(provider) {
  return {
    key: 'Provider',
    status: provider === 'Unknown' ? STATUS.INFO : STATUS.PASS,
    value: provider,
    summary: provider === 'Unknown'
      ? 'Could not detect mail provider from MX/NS records.'
      : `Mail provider detected: ${provider}.`,
    details: provider === 'Unknown'
      ? 'Recommendations will use generic syntax. Ask the customer which mail service they use.'
      : 'Recommendations below are tailored to this provider.',
    recommendation: null
  };
}

function analyze(dnsResults) {
  const provider = dnsResults.provider;
  const findings = [
    analyzeProvider(provider),
    analyzeSpf(dnsResults.spf, provider),
    analyzeDmarc(dnsResults.dmarc, provider),
    analyzeDkim(dnsResults.dkim, provider),
    analyzeBlacklists(dnsResults.blacklists)
  ];

  const overall = findings.some((f) => f.status === STATUS.FAIL)
    ? STATUS.FAIL
    : findings.some((f) => f.status === STATUS.WARN) ? STATUS.WARN : STATUS.PASS;

  return {
    domain: dnsResults.domain,
    provider,
    overall,
    findings,
    raw: dnsResults
  };
}

module.exports = { analyze, STATUS };
