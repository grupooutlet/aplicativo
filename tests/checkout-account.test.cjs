const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('supabase/functions/checkout-account/index.ts', 'utf8').replace(/^import .*\n/, '');
async function scenario(existing, failOrder = false) {
  const calls = [];
  let handler;
  const client = {
    from() { return { select() { return { eq() { return { maybeSingle: async () => ({ data: existing ? { user_id: 'existing' } : null, error: null }) }; } }; } }; },
    auth: {
      admin: { createUser: async data => { calls.push({ create: data.email }); return { data: { user: { id: 'new' } }, error: null }; },
        deleteUser: async id => { calls.push({ remove: id }); return {}; } },
      signInWithPassword: async data => { calls.push({ login: data.email }); return { data: { session: { access_token: 'new-session' } } }; }
    },
    rpc: async (name, data) => { calls.push({ rpc: name }); return failOrder ? { error: { message: 'Invalid order' } } : { data: { id: 20, token: 'private-order', order: { id: 20 } } }; }
  };
  const context = vm.createContext({ Response, Request, crypto: require('node:crypto').webcrypto,
    fetch: async () => ({ ok: true }), createClient: () => client,
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://project.supabase.co' : 'mock-key' }, serve: fn => { handler = fn; } }
  });
  vm.runInContext(source, context);
  const body = { request: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com' } };
  const result = await handler(new Request('https://project.supabase.co/functions/v1/checkout-account', {
    method: 'POST', headers: { apikey: 'public-test', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
  return { result, data: await result.json(), calls, handler };
}
(async () => {
  const fresh = await scenario(false);
  assert.equal(fresh.result.status, 200);
  assert.equal(fresh.data.session.access_token, 'new-session');
  assert.deepEqual(fresh.calls.map(item => Object.keys(item)[0]), ['create', 'login', 'rpc']);
  const existing = await scenario(true);
  assert.equal(existing.data.session, null, 'An existing account must never be connected based on its checkout email');
  assert.deepEqual(existing.calls, [{ rpc: 'place_order' }]);
  const failure = await scenario(false, true);
  assert.equal(failure.result.status, 400);
  assert.equal(failure.calls.at(-1).remove, 'new', 'A failed order must clean up only its newly created account');
  const unauthorized = await fresh.handler(new Request('https://project.supabase.co/functions/v1/checkout-account', { method: 'POST', body: '{}' }));
  assert.equal(unauthorized.status, 401);
  console.log('Automatic new checkout accounts, existing-account protection, cleanup and API-key checks verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
