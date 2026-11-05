/* Thin fetch wrapper. Errors carry the server's message so every surface can
   show a real reason instead of "something went wrong". */

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, options = {}) {
  /* A just-started local server can drop its first request while Vite is
     still attaching middleware. Retry only those transient network misses so
     a successful second request does not leave a frightening offline toast.
     Writes are deliberately never retried: a failed mutation must remain
     explicit rather than risk being applied twice. */
  const retries = !options.method || options.method === "GET" ? 2 : 0;
  let response;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      response = await fetch(path, {
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      break;
    } catch {
      if (attempt >= retries) {
        throw new ApiError("Clyra Notes cannot reach the server. Your work is kept locally until it is back.", 0);
      }
      await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    const text = await response.text();
    if (!response.ok) throw new ApiError(text.slice(0, 300) || `Request failed (${response.status})`, response.status);
    return text;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status);
  }
  return payload;
}

export const api = {
  get: (path, query) => request(query ? `${path}?${new URLSearchParams(query)}` : path),
  post: (path, body) => request(path, { method: "POST", body: body || {} }),
  patch: (path, body) => request(path, { method: "PATCH", body: body || {} }),
  put: (path, body) => request(path, { method: "PUT", body: body || {} }),
  del: (path) => request(path, { method: "DELETE" }),
};
