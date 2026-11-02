/** Live retrieval against the real internet (no mocks). Prints what actually worked. */
import { EvidenceLedger, openPage, webSearch, providerHealth, findInSource } from "../lib/chat-agent/web-engine";
const ledger = new EvidenceLedger();
const outcome = await webSearch(ledger, { queries: ["Node.js latest release notes", "Node.js LTS schedule"], maxResults: 6 });
console.log(JSON.stringify({ providersUsed: outcome.providersUsed, failed: outcome.providersFailed, hits: outcome.hits.map((h) => ({ id: h.id, host: h.host, by: h.providers, title: h.title.slice(0, 70) })) }, null, 1));
const first = outcome.hits.find((h) => /nodejs\.org|wikipedia/.test(h.host)) ?? outcome.hits[0];
if (first) {
  const opened = await openPage(ledger, first.url);
  console.log(opened.ok ? { opened: opened.source.id, title: opened.source.title, kind: opened.source.method, chars: opened.source.text.length, passages: opened.source.passages.length, published: opened.source.publishedAt } : opened);
  if (opened.ok) console.log(JSON.stringify(findInSource(ledger, opened.source.id, [], "latest version release date", 2), null, 1).slice(0, 900));
}
console.log(JSON.stringify(providerHealth()));
