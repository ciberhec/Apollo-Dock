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
      summary: 'No SPF record on this domain.',
      details: "SPF is the list of mail servers allowed to send email as this domain. Without it, when the customer sends mail, receiving services have no way to confirm it's legitimate — most will dump it in spam or reject it outright.",
      recommendation: buildSpfRecommendation(null, provider)
    };
  }

  const lookups = countSpfLookups(spf);
  const tooManyLookups = lookups > 10;
  const hasPlusAll = /\s\+all\b/i.test(spf);
  const hasNeutralAll = /\s\?all\b/i.test(spf);
  const validSyntax = /^v=spf1\b/i.test(spf) && /(\s[-~+?]all\b|\sredirect=)/i.test(spf);

  let status = STATUS.PASS;
  let summary = 'SPF is set up correctly.';
  let details = `Record is published, well-formed, and uses ${lookups} out of 10 allowed DNS lookups.`;
  let noteOverride = null;

  if (hasPlusAll) {
    status = STATUS.FAIL;
    summary = 'SPF is published, but wide open.';
    details = "The record ends in `+all`, which tells the whole internet \"any server can send mail as this domain.\" That's a critical misconfiguration — it lets anyone spoof the customer's domain.";
    noteOverride = 'Replace `+all` with `~all` immediately. Same record, just that one piece.';
  } else if (!validSyntax) {
    status = STATUS.WARN;
    summary = 'SPF is published but missing the closing rule.';
    details = "Every SPF record should end with an `all` mechanism (`~all`, `-all`, etc.) that tells receivers how strict to be. Without it, they don't know what to do with senders that aren't in the list.";
    noteOverride = 'Add `~all` at the end of the existing record. Standard safer setting.';
  } else if (hasNeutralAll) {
    status = STATUS.WARN;
    summary = 'SPF is published but on a neutral policy.';
    details = "The record ends in `?all`, which basically means \"we don't care.\" Receivers won't enforce the SPF check, so the record isn't doing much.";
    noteOverride = 'Swap `?all` for `~all` — same record, standard safer setting.';
  } else if (tooManyLookups) {
    status = STATUS.WARN;
    summary = `SPF works but does too many DNS lookups (${lookups} of 10 allowed).`;
    details = 'The spec only allows 10 lookups per SPF check. When a receiver hits that limit, it stops checking — and may treat the result as invalid. The usual culprit is too many `include:` lines, often vendors that stacked up over the years.';
    noteOverride = "Review the includes and remove any vendors who aren't sending mail anymore. If everyone in the list is legitimate, consider an SPF flattening service to consolidate them.";
  }

  const recommendation = status === STATUS.PASS ? null : buildSpfRecommendation(spf, provider, noteOverride);

  return {
    key: 'SPF',
    status,
    value: spf,
    summary,
    details,
    recommendation,
    extra: { lookups }
  };
}

function buildSpfRecommendation(currentSpf, provider, noteOverride) {
  let suggested;
  if (provider === 'Google Workspace') {
    suggested = 'v=spf1 include:_spf.google.com ~all';
  } else if (provider === 'Microsoft 365') {
    suggested = 'v=spf1 include:spf.protection.outlook.com ~all';
  } else {
    suggested = 'v=spf1 include:<your-mail-provider-include> ~all';
  }

  const defaultNote = "Start with `~all` (soft fail) — it's the safer rollout. Once every legitimate sender is included, you can tighten to `-all`.";

  return {
    where: 'Publish as a TXT record on the root domain (just `@` or `yourdomain.com`).',
    record: suggested,
    note: noteOverride || defaultNote,
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
      details: "DMARC tells receiving servers what to do when an email fails SPF or DKIM — and gives the customer reports about who's trying to send mail as their domain. Without it, the customer has no visibility into spoofing attempts and no enforcement on bad messages.",
      recommendation: buildDmarcRecommendation(null)
    };
  }

  const policy = (dmarc.match(/p=(none|quarantine|reject)/i) || [, null])[1];
  const ruaMatch = dmarc.match(/rua=mailto:[^;\s]+/i);
  const validSyntax = /^v=DMARC1\b/i.test(dmarc) && policy;

  let status = STATUS.PASS;
  let summary;
  let details;
  let noteOverride = null;

  if (!validSyntax) {
    status = STATUS.FAIL;
    summary = 'DMARC record is published but malformed.';
    details = "The record is missing `v=DMARC1` at the start or doesn't have a `p=` policy. Receivers will skip it entirely, so it's not protecting anything right now.";
    noteOverride = 'Rewrite the record using the template below — make sure it starts with `v=DMARC1` and includes a `p=` value.';
  } else if (policy === 'none') {
    status = STATUS.WARN;
    summary = 'DMARC is published but only in monitor mode.';
    details = "The policy is set to `p=none`, which means receivers will log failures but not act on them. Good as a first step (the customer is collecting data), but the domain is still spoofable — anyone can fake email from it.";
    noteOverride = "Once the customer has reviewed 2–4 weeks of reports and confirmed legitimate senders are passing, move the policy to `p=quarantine` (sends fakes to spam) and eventually `p=reject` (blocks them outright).";
  } else if (!ruaMatch) {
    status = STATUS.WARN;
    summary = 'DMARC is published but with no reporting address.';
    details = "Without `rua=`, the customer doesn't receive the daily reports DMARC was designed to give them — they're flying blind on who's sending (or spoofing) their domain.";
    noteOverride = 'Add `rua=mailto:dmarc-reports@yourdomain.com` (or any mailbox they monitor) to the existing record.';
  } else {
    summary = `DMARC is set up with policy ${policy} and reporting enabled.`;
    details = "Record is well-formed, the customer is enforcing the policy, and they're collecting reports.";
  }

  const recommendation = status === STATUS.PASS ? null : buildDmarcRecommendation(policy, noteOverride);

  return {
    key: 'DMARC',
    status,
    value: dmarc,
    summary,
    details,
    recommendation,
    extra: { policy, rua: ruaMatch ? ruaMatch[0] : null }
  };
}

function buildDmarcRecommendation(currentPolicy, noteOverride) {
  const stage = !currentPolicy
    ? 'v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; fo=1'
    : currentPolicy === 'none'
      ? 'v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@yourdomain.com; fo=1'
      : 'v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; fo=1';

  const defaultNote = !currentPolicy
    ? "Publish the template below, then start watching the reports. After 2–4 weeks, move the policy up to `p=quarantine`, then `p=reject`."
    : 'Replace `yourdomain.com` in the reporting address with a mailbox the customer actively monitors.';

  return {
    where: 'Publish as a TXT record at the subdomain `_dmarc.yourdomain.com`.',
    record: stage,
    note: noteOverride || defaultNote,
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
      summary: 'No DKIM record found on the common selectors we check.',
      details: "DKIM is the cryptographic signature that proves a message wasn't altered in transit and really came from this domain. We checked the standard selectors (`google`, `selector1/2`, `s1/2`, `default`, `mail`, `k1`, `dkim`, `smtp`) and didn't find anything.\n\nHeads up: if the customer is using a custom selector name, DKIM might be there — it just isn't on our standard list. Worth asking them.",
      recommendation: buildDkimRecommendation(provider, null)
    };
  }

  const bits = estimateDkimKeyBits(dkim.record);
  const isRevoked = /p=\s*(;|$)/i.test(dkim.record);
  const isShortKey = bits !== null && bits < 1024;

  let status = STATUS.PASS;
  let summary = `DKIM is published on selector \`${dkim.selector}\`.`;
  let details = `Record is well-formed and the key length looks healthy (${bits ?? 'unknown'} bits).`;
  let noteOverride = null;

  if (isRevoked) {
    status = STATUS.FAIL;
    summary = 'DKIM record exists but the key has been revoked.';
    details = 'The record has `p=` with nothing after it, which is the official way to revoke a DKIM key. Receivers will treat every signature from this selector as invalid — same effect as having no DKIM at all.';
    noteOverride = "Generate a fresh DKIM key in the mail provider's admin console and publish the new public key in place of the empty record.";
  } else if (isShortKey) {
    status = STATUS.WARN;
    summary = `DKIM is published but the key is shorter than recommended (~${bits} bits).`;
    details = 'The key is below the 1024-bit minimum that modern receivers expect. Short keys can be cracked, and some providers downgrade or reject messages signed with them.';
    noteOverride = "Generate a new 2048-bit DKIM key in the mail provider's admin console and replace the existing record.";
  }

  const recommendation = status === STATUS.PASS ? null : buildDkimRecommendation(provider, dkim.selector, noteOverride);

  return {
    key: 'DKIM',
    status,
    value: dkim.record,
    summary,
    details,
    recommendation,
    extra: { selector: dkim.selector, bits }
  };
}

function buildDkimRecommendation(provider, currentSelector, noteOverride) {
  if (provider === 'Google Workspace') {
    const defaultNote = currentSelector
      ? `Re-generate the DKIM key with a 2048-bit length and replace the existing TXT record on selector \`${currentSelector}\`.`
      : 'Generate a 2048-bit key in the Google Admin Console and publish the TXT record it gives you.';
    return {
      where: 'Google Admin Console → Apps → Google Workspace → Gmail → Authenticate email. Generate a 2048-bit key and publish the TXT record at `google._domainkey.yourdomain.com`.',
      record: 'v=DKIM1; k=rsa; p=<public_key_generated_by_google>',
      note: noteOverride || defaultNote,
      docs: 'https://support.google.com/a/answer/174124'
    };
  }
  if (provider === 'Microsoft 365') {
    const defaultNote = 'Microsoft 365 uses CNAMEs (not TXT records) so they can rotate keys for you automatically.';
    return {
      where: 'Microsoft Defender → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Enable DKIM signing, then publish the two CNAMEs `selector1._domainkey` and `selector2._domainkey` pointing at the values Microsoft displays.',
      record: 'selector1._domainkey.yourdomain.com CNAME selector1-yourdomain-com._domainkey.yourtenant.onmicrosoft.com',
      note: noteOverride || defaultNote,
      docs: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure'
    };
  }
  const defaultNote = 'Ask the mail provider to generate a 2048-bit DKIM key and give you the public key and selector to publish.';
  return {
    where: 'Publish a TXT record at `<selector>._domainkey.yourdomain.com` using the selector and key value the mail provider gives you.',
    record: 'v=DKIM1; k=rsa; p=<your_public_key>',
    note: noteOverride || defaultNote,
    docs: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-about'
  };
}

function analyzeBlacklists(blacklistResults) {
  if (!blacklistResults || blacklistResults.length === 0) {
    return {
      key: 'Blacklist',
      status: STATUS.INFO,
      value: null,
      summary: "Couldn't check — no IPs to look up.",
      details: "No website means no IP to check against the blacklists. Normal for email-only domains or ones registered but not set up yet.\n\nHeads up: the customer's mail server has its own sending IPs, and those can still be blacklisted. If they're worried about deliverability, grab a sending IP from a recent email header and check that directly.",
      recommendation: null
    };
  }

  const listings = blacklistResults.filter((r) => r.listed);
  if (listings.length === 0) {
    return {
      key: 'Blacklist',
      status: STATUS.PASS,
      value: 'Clean',
      summary: 'Not listed on any of the major blacklists we check.',
      details: "Checked Spamhaus ZEN, SpamCop, Barracuda Central, and SORBS — the domain's IPs are clean on all four.",
      recommendation: null
    };
  }

  const byList = listings.map((l) => `${l.blacklist} (${l.ip})`).join(', ');
  return {
    key: 'Blacklist',
    status: STATUS.FAIL,
    value: byList,
    summary: `Listed on ${listings.length} blacklist${listings.length > 1 ? 's' : ''}: ${byList}.`,
    details: 'Public DNSBLs (Spamhaus, SpamCop, Barracuda, SORBS) flag IPs that have been sending spam or other abuse. Once an IP is listed, major providers like Gmail and Outlook either dump its mail in spam or block it entirely — delivery is going to suffer until this is resolved.',
    recommendation: {
      where: "Find the root cause first — usually an open relay, a compromised account, or a spam complaint storm. Once it's fixed, visit each blacklist's site and submit a delisting request.",
      record: null,
      note: "Most lists will re-list the IP within hours if the underlying issue isn't actually solved. Fix first, delist second.",
      docs: 'https://www.spamhaus.org/lookup/'
    }
  };
}

function analyzeProvider(provider) {
  if (provider === 'Google (DNS only)') {
    return {
      key: 'Provider',
      status: STATUS.INFO,
      value: provider,
      summary: 'Google hosts the DNS, but mail goes somewhere else.',
      details: "Heads up — Google shows up here, but only as the DNS host. Mail for this domain is NOT going through Google Workspace.\n\nThe real mailbox provider is somewhere else. To find it, look at the MX records below — or ask the customer which email service their team uses (Microsoft 365? Zoho? something custom?).",
      recommendation: null
    };
  }

  if (provider === 'Cloudflare (DNS)') {
    return {
      key: 'Provider',
      status: STATUS.INFO,
      value: provider,
      summary: 'Cloudflare hosts the DNS, but Cloudflare does not run mailboxes.',
      details: "Heads up — Cloudflare is the DNS host here, but Cloudflare doesn't run mailboxes. Mail for this domain is going through a different service.\n\nLook at the MX records below to see who's handling email — or ask the customer which email service their team uses (Microsoft 365? Google Workspace? something custom?).",
      recommendation: null
    };
  }

  if (provider === 'Unknown') {
    return {
      key: 'Provider',
      status: STATUS.INFO,
      value: provider,
      summary: "Mail setup doesn't match any provider we recognize.",
      details: "The mail setup for this domain doesn't match any of the providers we recognize (Google, Microsoft, Zoho, and a few others). It could be a custom mail server, a smaller provider, or this domain might not be configured for email at all.\n\nIt's also possible you're looking at a marketing or tracking subdomain (like `track.` or `email.`) instead of the customer's actual mailbox domain — worth double-checking.\n\nQuickest path forward: ask the customer which email service their team uses, so we know which recommendations to give.",
      recommendation: null
    };
  }

  return {
    key: 'Provider',
    status: STATUS.PASS,
    value: provider,
    summary: `Mail provider detected: ${provider}.`,
    details: 'Recommendations below are tailored to this provider.',
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

function compareSubdomainToRoot(subdomainReport, rootReport) {
  if (!rootReport) return null;

  const subRaw = subdomainReport.raw;
  const rootRaw = rootReport.raw;
  const matches = {
    provider: subdomainReport.provider === rootReport.provider,
    spf: (subRaw.spf || null) === (rootRaw.spf || null),
    dmarc: (subRaw.dmarc || null) === (rootRaw.dmarc || null),
    dkim: (subRaw.dkim?.record || null) === (rootRaw.dkim?.record || null)
  };

  const allMatch = matches.provider && matches.spf && matches.dmarc && matches.dkim;

  const banner = allMatch
    ? {
        kind: 'match',
        title: 'Subdomain matches the main domain',
        body: `You searched a subdomain (\`${subdomainReport.domain}\`). Its mail setup matches the main domain (\`${rootReport.domain}\`) — same configuration across both. We pulled the main domain too, see the Main domain section below.`
      }
    : {
        kind: 'diverge',
        title: 'Subdomain differs from the main domain',
        body: `You searched a subdomain (\`${subdomainReport.domain}\`). Its mail setup is different from the main domain (\`${rootReport.domain}\`) — that usually means this subdomain is dedicated to marketing email or tracking links, not real mailboxes.\n\nIf the customer's question is about their team's inbox, the main domain is probably what you want to check. We pulled it too — see the Main domain section below.`
      };

  return {
    subdomain: subdomainReport.domain,
    rootDomain: rootReport.domain,
    matchesRoot: allMatch,
    matches,
    banner
  };
}

module.exports = { analyze, compareSubdomainToRoot, STATUS };
