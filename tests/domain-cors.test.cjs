const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

(async () => {
  for (const name of ['checkout-account', 'customer-admin']) {
    let handler;
    const source = stripTypeScriptTypes(fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').replace(/^import .*\n/, ''));
    const context = vm.createContext({ Request, Response,
      createClient: () => { throw Error('An unauthorized request must not access customer data'); },
      fetch: async () => { throw Error('An unauthorized request must not access customer data'); },
      Deno: { serve: fn => { handler = fn; }, env: { get: () => 'mock' } },
    });
    vm.runInContext(source, context);
    const request = (method, origin) => handler(new Request(`https://project.supabase.co/functions/v1/${name}`, {
      method, headers: origin ? { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' } : {},
    }));
    for (const origin of ['https://forteoutlet.com.br', 'https://www.forteoutlet.com.br', 'https://grupooutlet.github.io', 'https://forte-outlet.pages.dev']) {
      const preflight = await request('OPTIONS', origin);
      assert.equal(preflight.status, 200);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(preflight.headers.get('Vary'), 'Origin');
      assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /apikey/);
      const unauthenticated = await request('POST', origin);
      assert.equal(unauthenticated.status, 401, 'new domains still require the existing authentication/API key');
      assert.equal(unauthenticated.headers.get('Access-Control-Allow-Origin'), origin);
    }
    for (const origin of ['https://forteoutlet.com.br.evil.example', 'https://forte-outlet.pages.dev.evil.example', 'https://another-store.pages.dev', 'https://evil.example', 'http://forteoutlet.com.br', 'http://forte-outlet.pages.dev']) {
      for (const method of ['OPTIONS', 'POST']) {
        const denied = await request(method, origin);
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
      }
    }
    const serverRequest = await request('POST');
    assert.equal(serverRequest.status, 401);
    assert.equal(serverRequest.headers.get('Access-Control-Allow-Origin'), null, 'origins never leak between requests');
  }
  console.log('Official domains, GitHub and Cloudflare preflights accepted; unrelated origins rejected; authentication preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
