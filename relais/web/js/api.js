async function req(method, url, body, headers) {
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* corps non JSON */ }
    const err = new Error(msg || res.statusText);
    err.status = res.status;
    throw err;
  }
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : res;
}

export const api = {
  get: (url) => req('GET', url),
  json: (method, url, body) => req(method, url, JSON.stringify(body ?? {}), { 'Content-Type': 'application/json' }),
  put: (url, blob) => req('PUT', url, blob, { 'Content-Type': 'audio/wav' }),
  del: (url) => req('DELETE', url),
};
