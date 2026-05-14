const els = {
  domainInput: document.getElementById('domainInput'),
  runBtn: document.getElementById('runBtn'),
  claudeBtn: document.getElementById('claudeBtn'),
  status: document.getElementById('status'),
  report: document.getElementById('report'),
  summaryGrid: document.getElementById('summaryGrid'),
  fixGuide: document.getElementById('fixGuide'),
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
  els.customerMessage.textContent = '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSummary(findings) {
  els.summaryGrid.innerHTML = findings.map((f) => {
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
        ${valueBlock}
      </div>
    `;
  }).join('');
}

function renderFixGuide(findings) {
  const needsFix = findings.filter((f) => f.recommendation);
  if (needsFix.length === 0) {
    els.fixGuide.innerHTML = `<div class="fix-card"><div class="fix-problem">${ICONS.pass} All checks passed. No remediation needed.</div></div>`;
    return;
  }

  els.fixGuide.innerHTML = needsFix.map((f, idx) => {
    const r = f.recommendation;
    const recordRow = r.record
      ? `<div class="fix-row"><div class="fix-label">Record</div><div class="fix-val"><div class="fix-record">${escapeHtml(r.record)}</div></div></div>`
      : '';
    const noteRow = r.note
      ? `<div class="fix-row"><div class="fix-label">Note</div><div class="fix-val">${escapeHtml(r.note)}</div></div>`
      : '';
    const docsRow = r.docs
      ? `<div class="fix-row"><div class="fix-label">Docs</div><div class="fix-val"><a href="#" data-href="${escapeHtml(r.docs)}">${escapeHtml(r.docs)}</a></div></div>`
      : '';
    return `
      <div class="fix-card">
        <h3>${ICONS[f.status]} Step ${idx + 1}: Fix ${escapeHtml(f.key)}</h3>
        <div class="fix-problem"><strong>Problem:</strong> ${escapeHtml(f.summary)} ${escapeHtml(f.details || '')}</div>
        <div class="fix-row"><div class="fix-label">Where</div><div class="fix-val">${escapeHtml(r.where)}</div></div>
        ${recordRow}
        ${noteRow}
        ${docsRow}
      </div>
    `;
  }).join('');

  els.fixGuide.querySelectorAll('a[data-href]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.apolloDock?.openExternal(a.dataset.href);
    });
  });
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

  renderSummary(res.report.findings);
  renderFixGuide(res.report.findings);
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
