// This endpoint serves only the existing, RLS-protected public catalog projection.
// Checkout, authentication, private orders and administrative state always use Supabase directly.
const source = 'https://rwxqytomiorsrxpgtjin.supabase.co/rest/v1/shop_public?select=data&id=eq.1';
const publicKey = 'sb_publishable_blKM9wQxpyILSjEn1RnTmw_sLcoanYo';
const maxBytes = 8 * 1024 * 1024;
const cacheControl = 'public, max-age=0, s-maxage=15, must-revalidate';
let pendingCatalog = null, fetchGeneration = 0;

function failure(status, code = 'CATALOG_UNAVAILABLE') {
  return new Response(JSON.stringify({ message: 'Catálogo temporariamente indisponível. Tente novamente.', code }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}
function matchesEtag(value, etag) {
  return !!value && value.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag);
}
function reply(request, response) {
  const headers = new Headers(response.headers);
  if (response.status === 200 && headers.has('ETag') && matchesEtag(request.headers.get('If-None-Match'), headers.get('ETag'))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}
async function fetchCatalog(context) {
  const generation = ++fetchGeneration;
  const upstream = await fetch(source, {
    headers: { apikey: publicKey, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(12000)
  });
  if (!upstream.ok) return failure(503, upstream.status === 402 ? 'CATALOG_QUOTA_RESTRICTED' : 'CATALOG_UNAVAILABLE');
  if (upstream.headers.get('Content-Type')?.split(';')[0]?.toLowerCase() !== 'application/json' ||
      Number(upstream.headers.get('Content-Length')) > maxBytes) return failure(502);
  const reader = upstream.body?.getReader();
  if (!reader) return failure(502);
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); return failure(502); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let rows;
  try { rows = JSON.parse(new TextDecoder().decode(bytes)); } catch { return failure(502); }
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.data || !Array.isArray(rows[0].data.products)) return failure(502);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const etag = '"catalog-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') + '"';
  const response = new Response(bytes, { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl,
    'ETag': etag, 'X-Content-Type-Options': 'nosniff'
  } });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  // A refresh issued after a stock/order write takes priority over an older in-flight read.
  if (cache && generation === fetchGeneration) {
    const key = new Request(new URL(context.request.url).origin + '/api/catalog');
    context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  }
  return response;
}
export async function onRequest(context) {
  const request = context.request, url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure(403);
  if (url.search || request.headers.has('Authorization')) return failure(400);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(url.origin + '/api/catalog');
  const fresh = request.headers.get('X-Catalog-Refresh') === '1';
  try {
    if (!fresh && cache) {
      const hit = await cache.match(key);
      if (hit) return reply(request, hit);
    }
    // Coalesce public cache misses in this isolate. Fresh reads must not join an older request.
    if (fresh) return reply(request, await fetchCatalog(context));
    if (!pendingCatalog) pendingCatalog = fetchCatalog(context);
    const pending = pendingCatalog;
    try { return reply(request, (await pending).clone()); }
    finally { if (pendingCatalog === pending) pendingCatalog = null; }
  } catch { return failure(503); }
}
