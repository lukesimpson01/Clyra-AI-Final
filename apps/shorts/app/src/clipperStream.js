/* The clipper's job stream, shared by the studio and the background queue. */
/** Server-sent events from a clipper POST: each JSON event to `on`; an error event throws. The job runs on in Clyra
 *  whatever happens to this connection: a stream that drops is picked up where it left off
 *  (GET /api/clipper/jobs/:jobId/events?from=N), so no clip and no error is missed. `job` gets the job's id. */
export async function streamEvents(url, body, signal, on, job = () => {}, resumeId = null) {
  let jobId = resumeId, seen = 0, attempts = 0, finished = false;
  const read = async (response) => {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
      for (const frame of frames) {
        const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
        if (!line) continue;
        seen += 1;
        let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.type === 'job' && event.jobId) { jobId = event.jobId; job(jobId); }
        if (event.type === 'complete') finished = true;
        if (event.type === 'error') { finished = true; throw new Error(String(event.message || 'The clipper failed.')); }
        on(event);
      }
    }
  };
  /* `resumeId`: the job is already running in Clyra (the page was reloaded): watch it from its first event */
  const first = resumeId ? await fetch(`/api/clipper/jobs/${encodeURIComponent(resumeId)}/events?from=0`, { signal }) : await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!first.ok || !first.body) { const detail = await first.json().catch(() => ({})); throw new Error(detail.error || `The clipper could not start (${first.status})`); }
  let response = first;
  for (;;) {
    try { await read(response); return; }
    catch (cause) {
      if (finished || signal.aborted || cause?.name === 'AbortError' || !jobId || attempts >= 20) throw cause;
      attempts += 1;
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 * attempts)));
      response = await fetch(`/api/clipper/jobs/${encodeURIComponent(jobId)}/events?from=${seen}`, { signal }).catch((e) => { if (e?.name === 'AbortError') throw e; return null; });
      if (!response?.ok || !response.body) { if (response?.status === 404) throw new Error('The clipper job ended while the connection was down. Generate again.'); response = { body: new ReadableStream({ start(c) { c.error(new TypeError('reconnecting')); } }) }; }
    }
  }
}
