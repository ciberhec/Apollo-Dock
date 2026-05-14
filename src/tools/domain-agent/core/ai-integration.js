/**
 * Apollo Dock — Domain Agent
 * AI Integration Scaffold (Anthropic Claude)
 *
 * STATUS: not yet implemented. This file is a placeholder so the integration
 * point is obvious and the renderer can already render a disabled
 * "Analyze with Claude" button.
 *
 * When this is wired up, this module will call the Anthropic API with the
 * raw DNS results object and return a customer-facing remediation plan.
 *
 * Expected input (from dns-lookup.js → analyzer.js):
 *   {
 *     domain: 'example.com',
 *     provider: 'Google Workspace' | 'Microsoft 365' | 'Unknown' | ...,
 *     overall: 'pass' | 'warn' | 'fail',
 *     findings: [
 *       {
 *         key: 'SPF' | 'DMARC' | 'DKIM' | 'Blacklist' | 'Provider',
 *         status: 'pass' | 'warn' | 'fail' | 'info',
 *         value: '<raw record or null>',
 *         summary: 'short human summary',
 *         details: 'longer explanation',
 *         recommendation: {
 *           where: 'where to publish the record',
 *           record: 'exact corrected record syntax',
 *           note: 'caveat or sequencing advice',
 *           docs: 'authoritative documentation URL'
 *         } | null,
 *         extra: { ... }   // record-specific extras (lookups, policy, bits, ...)
 *       },
 *       ...
 *     ],
 *     raw: { ...dnsLookup full results }
 *   }
 *
 * Expected output structure (what the renderer will render):
 *   {
 *     headline: 'one-sentence diagnosis',
 *     customerFacingMessage: 'multi-paragraph plain-English remediation that can be pasted into a support ticket',
 *     prioritizedActions: [
 *       { order: 1, title: '...', why: '...', exactRecord: '...', where: '...' },
 *       ...
 *     ],
 *     internalNotes: 'extra context for the support agent',
 *     model: 'claude-...',
 *     usage: { input_tokens, output_tokens }
 *   }
 *
 * Implementation plan when API key is available:
 *   1. Read ANTHROPIC_API_KEY from process.env (loaded via a .env file at app
 *      launch; never bundle the key in source).
 *   2. Use @anthropic-ai/sdk, model: 'claude-sonnet-4-6' (or current default).
 *   3. Prompt cache the system prompt + reference docs (SPF/DKIM/DMARC RFCs +
 *      Microsoft + Google guides) using cache_control on the system block —
 *      same diagnosis prompt runs for every customer, so the cache hit rate
 *      will be very high.
 *   4. Pass the analyzer result as the user message, JSON-serialized.
 *   5. Ask the model to respond in the JSON shape above (tool_use or a strict
 *      JSON-only response).
 *
 * Until that is built, calling analyzeWithClaude() throws so the renderer
 * keeps the button disabled.
 */

async function analyzeWithClaude(analyzerResult, { apiKey } = {}) {
  throw new Error('Claude integration not yet implemented. Set ANTHROPIC_API_KEY and wire up @anthropic-ai/sdk here.');

  // --- Sketch of the eventual call ---
  // const Anthropic = require('@anthropic-ai/sdk');
  // const client = new Anthropic({ apiKey });
  // const response = await client.messages.create({
  //   model: 'claude-sonnet-4-6',
  //   max_tokens: 1500,
  //   system: [
  //     {
  //       type: 'text',
  //       text: SYSTEM_PROMPT_WITH_REFERENCE_DOCS,
  //       cache_control: { type: 'ephemeral' }
  //     }
  //   ],
  //   messages: [
  //     { role: 'user', content: JSON.stringify(analyzerResult) }
  //   ]
  // });
  // return parseClaudeResponse(response);
}

module.exports = { analyzeWithClaude };
