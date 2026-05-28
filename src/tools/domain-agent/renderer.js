const els = {
  domainInput: document.getElementById('domainInput'),
  runBtn: document.getElementById('runBtn'),
  claudeBtn: document.getElementById('claudeBtn'),
  status: document.getElementById('status'),
  report: document.getElementById('report'),
  subdomainBanner: document.getElementById('subdomainBanner'),
  primaryReportTitle: document.getElementById('primaryReportTitle'),
  summaryGrid: document.getElementById('summaryGrid'),
  fixGuide: document.getElementById('fixGuide'),
  rootReportSection: document.getElementById('rootReportSection'),
  rootDomainLabel: document.getElementById('rootDomainLabel'),
  rootSummaryGrid: document.getElementById('rootSummaryGrid'),
  rootFixGuide: document.getElementById('rootFixGuide'),
  customerMessage: document.getElementById('customerMessage'),
  copyMsgBtn: document.getElementById('copyMsgBtn')
};

const ICONS = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };

function setStatus(html, isError = false) {
  els.status.innerHTML = html;
  els.status.classList.toggle('hidden', !html);
  els.status.classList.toggle('error', !!isError);
}

function clearReport() {
  els.report.classList.add('hidden');
  els.summaryGrid.innerHTML = '';
  els.fixGuide.innerHTML = '';
  els.subdomainBanner.innerHTML = '';
  els.subdomainBanner.classList.add('hidden');
  els.rootReportSection.classList.add('hidden');
  els.rootSummaryGrid.innerHTML = '';
  els.rootFixGuide.innerHTML = '';
  els.primaryReportTitle.textContent = 'Status Summary';
  els.customerMessage.textContent = '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Render copy text: escape, turn `code` spans into <code>, double-newlines into paragraph breaks.
function formatBody(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  const withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  const paragraphs = withCode.split(/\n\n+/).map((p) => p.replace(/\n/g, '<br>'));
  return paragraphs.map((p) => `<p>${p}</p>`).join('');
}

function renderSummary(findings, target = els.summaryGrid) {
  target.innerHTML = findings.map((f) => {
    const valueBlock = f.value
      ? `<div class="summary-value">${escapeHtml(f.value)}</div>`
      : '';
    return `
      <div class="summary-card ${f.status}">
        <div class="summary-head">
          <span class="summary-key">${escapeHtml(f.key)}</span>
          <span class="status-pill ${f.status}">${ICONS[f.status]} ${f.status}</span>
        </div>
        <div class="summary-summary">${escapeHtml(f.summary)}</div>
        <div class="summary-details">${formatBody(f.details)}</div>
        ${valueBlock}
      </div>
    `;
  }).join('');
}

function renderFixGuide(findings, target = els.fixGuide) {
  const needsFix = findings.filter((f) => f.recommendation);
  if (needsFix.length === 0) {
    target.innerHTML = `<div class="fix-card"><div class="fix-problem">${ICONS.pass} All checks passed. No remediation needed.</div></div>`;
    return;
  }

  target.innerHTML = needsFix.map((f, idx) => {
    const r = f.recommendation;
    const recordRow = r.record
      ? `<div class="fix-row"><div class="fix-label">Record</div><div class="fix-val"><div class="fix-record">${escapeHtml(r.record)}</div></div></div>`
      : '';
    const noteRow = r.note
      ? `<div class="fix-row"><div class="fix-label">Note</div><div class="fix-val">${formatBody(r.note)}</div></div>`
      : '';
    const docsRow = r.docs
      ? `<div class="fix-row"><div class="fix-label">Docs</div><div class="fix-val"><a href="#" data-href="${escapeHtml(r.docs)}">${escapeHtml(r.docs)}</a></div></div>`
      : '';
    return `
      <div class="fix-card">
        <h3>${ICONS[f.status]} Step ${idx + 1}: Fix ${escapeHtml(f.key)}</h3>
        <div class="fix-problem"><strong>${escapeHtml(f.summary)}</strong>${formatBody(f.details)}</div>
        <div class="fix-row"><div class="fix-label">Where</div><div class="fix-val">${escapeHtml(r.where)}</div></div>
        ${recordRow}
        ${noteRow}
        ${docsRow}
      </div>
    `;
  }).join('');

  target.querySelectorAll('a[data-href]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.apolloDock?.openExternal(a.dataset.href);
    });
  });
}

function renderSubdomainBanner(ctx) {
  if (!ctx) {
    els.subdomainBanner.classList.add('hidden');
    els.subdomainBanner.innerHTML = '';
    return;
  }
  els.subdomainBanner.classList.remove('hidden');
  els.subdomainBanner.classList.toggle('match', ctx.banner.kind === 'match');
  els.subdomainBanner.classList.toggle('diverge', ctx.banner.kind === 'diverge');
  els.subdomainBanner.innerHTML = `
    <h3 class="banner-title">${escapeHtml(ctx.banner.title)}</h3>
    <div class="banner-body">${formatBody(ctx.banner.body)}</div>
  `;
}

function renderRootSection(rootReport) {
  if (!rootReport) {
    els.rootReportSection.classList.add('hidden');
    return;
  }
  els.rootReportSection.classList.remove('hidden');
  els.rootDomainLabel.textContent = rootReport.domain;
  renderSummary(rootReport.findings, els.rootSummaryGrid);
  renderFixGuide(rootReport.findings, els.rootFixGuide);
}

function buildCustomerMessage(report) {
  const lines = [];
  lines.push(`Hi,`);
  lines.push('');
  lines.push(`We ran a DNS authentication check on ${report.domain} (detected mail provider: ${report.provider}).`);
  lines.push('');

  const passed = report.findings.filter((f) => f.status === 'pass').map((f) => f.key);
  if (passed.length) {
    lines.push(`The following are configured correctly: ${passed.join(', ')}.`);
    lines.push('');
  }

  const issues = report.findings.filter((f) => f.recommendation);
  if (issues.length === 0) {
    lines.push(`All email authentication records look healthy — no action required.`);
  } else {
    lines.push(`To improve email deliverability, please make the following DNS changes in the order listed:`);
    lines.push('');
    issues.forEach((f, idx) => {
      const r = f.recommendation;
      lines.push(`${idx + 1}. ${f.key} — ${f.summary}`);
      lines.push(`   Where to publish: ${r.where}`);
      if (r.record) lines.push(`   Record value:   ${r.record}`);
      if (r.note)   lines.push(`   Note:           ${r.note}`);
      if (r.docs)   lines.push(`   Reference:      ${r.docs}`);
      lines.push('');
    });
  }

  lines.push(`DNS changes can take up to 24–48 hours to fully propagate. Please reply once the records are published and we will re-verify.`);
  lines.push('');
  lines.push(`Thanks,`);
  lines.push(`Apollo Support`);
  return lines.join('\n');
}

async function runAnalysis() {
  const domain = els.domainInput.value.trim();
  if (!domain) {
    setStatus('Enter a domain to analyze.', true);
    return;
  }

  clearReport();
  els.runBtn.disabled = true;
  setStatus(`<span class="spinner"></span>Looking up DNS records for <strong>${escapeHtml(domain)}</strong>…`);

  const res = await window.domainAgent.analyze(domain);
  els.runBtn.disabled = false;

  if (!res.ok) {
    setStatus(`Analysis failed: ${escapeHtml(res.error)}`, true);
    return;
  }

  setStatus(`Analysis complete for <strong>${escapeHtml(res.report.domain)}</strong>. Overall status: <strong>${res.report.overall.toUpperCase()}</strong>.`);

  renderSubdomainBanner(res.subdomainContext);
  els.primaryReportTitle.textContent = res.subdomainContext
    ? `Subdomain — ${res.report.domain}`
    : 'Status Summary';
  renderSummary(res.report.findings);
  renderFixGuide(res.report.findings);
  renderRootSection(res.rootReport);
  els.customerMessage.textContent = buildCustomerMessage(res.report);
  els.report.classList.remove('hidden');
}

els.runBtn.addEventListener('click', runAnalysis);
els.domainInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });

els.copyMsgBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.customerMessage.textContent);
    const old = els.copyMsgBtn.textContent;
    els.copyMsgBtn.textContent = 'Copied!';
    setTimeout(() => { els.copyMsgBtn.textContent = old; }, 1500);
  } catch {
    /* clipboard blocked */
  }
});

els.claudeBtn.addEventListener('click', () => {
  // Disabled in UI; this handler is a no-op until ai-integration.js is wired up.
});
