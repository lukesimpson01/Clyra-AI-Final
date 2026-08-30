/* Thin fetch wrapper. Errors carry the server's message so every surface can
   show a real reason instead of "something went wrong". */

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError("Clyra Notes cannot reach the server. Your work is kept locally until it is back.", 0);
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
