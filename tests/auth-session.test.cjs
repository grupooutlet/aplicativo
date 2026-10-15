const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const shared = new Map();
let lockQueue = Promise.resolve();
const locks = { request(name, work) { const result = lockQueue.then(work); lockQueue = result.catch(() => {}); return result; } };
const storage = map => ({ getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
function tab() {
  const session = new Map(), events = {}, location = { protocol: 'https:', origin: 'https://grupooutlet.github.io', pathname: '/aplicativo/', search: '', hash: '#/loja' };
  const nodes = Object.fromEntries(['#app', '#modal', '#toast'].map(key => [key, { innerHTML: '', open: false, classList: { add() {}, remove() {} } }]));
  const context = vm.createContext({ console, URL, URLSearchParams, Date, Map, Set, structuredClone,
    crypto: require('node:crypto').webcrypto, location, navigator: { locks },
    localStorage: storage(shared), sessionStorage: storage(session),
    document: { baseURI: 'https://grupooutlet.github.io/aplicativo/', querySelector: key => nodes[key] || null, querySelectorAll: () => [], addEventListener() {} },
    window: { localStorage: storage(shared), sessionStorage: storage(session), addEventListener(name, fn) { (events[name] ||= []).push(fn); }, scrollTo() {} },
    history: { pushState(a, b, url) { location.hash = url.slice(url.indexOf('#')); }, replaceState() {} },
    setTimeout: () => 1, clearTimeout() {}, fetch: async () => { throw new Error('Unexpected request'); },
    FormData: class { constructor(form) { return Object.entries(form.data || {}); } }
  });
  for (const name of ['storefront-editor.js', 'app.js', 'production.js', 'enhancements.js', 'variations.js', 'fulfillment.js', 'operations.js', 'commerce.js', 'merchandising.js', 'storefront-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8').replace(/boot\(\);\s*$/, ''), context, { filename: name });
  }
  const run = source => vm.runInContext(source, context);
  run('storefront.init(db);db.orders=[]');
  return { context, run, session, events, location };
}
const fresh = { user: { id: 'test-user', email: 'test@example.invalid' }, access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 };
(async () => {
  const a = tab(), b = tab();
  a.session.set('forte-auth-v1', JSON.stringify(fresh));
  assert.equal(a.run('restoreAuth().user.id'), 'test-user', 'Existing tab sessions migrate without another login');
  assert.equal(a.session.has('forte-auth-v1'), false);
  assert.equal(b.run('authSession=restoreAuth();authSession.user.id'), 'test-user', 'A separate store tab restores the same account');
  for (const position of ['Gerente', 'Vendedor']) {
    b.run(`isOwner=true;currentProfile={role:'admin',position:${JSON.stringify(position)},name:'João Pedro',user_id:'test-user'};`);
    assert.match(b.run('storeHeader()'), /Minha conta<small>João Pedro<\/small>/);
    assert.match(b.run('accountPage()'), /Acessar painel/);
  }
  b.run("isOwner=false;currentProfile={role:'customer',name:'Ana <Silva>',user_id:'test-user'};");
  assert.match(b.run('storeHeader()'), /Ana &lt;Silva&gt;/);
  assert.doesNotMatch(b.run('accountPage()'), /Acessar painel/);
  b.run("currentProfile={role:'driver',name:'João Pedro',user_id:'test-user'}");
  assert.match(b.run('accountPage()'), /Acessar painel/);
  const expired = { ...fresh, expires_at: 1 };
  a.context.fixture = expired; a.run('rememberAuth(fixture)'); b.run('authSession=restoreAuth()');
  let refreshes = 0;
  const refresh = async () => { refreshes++; return { ok: true, json: async () => ({ ...fresh, refresh_token: 'rotated-refresh' }) }; };
  a.context.fetch = refresh; b.context.fetch = refresh;
  await Promise.all([a.run('refreshAuth()'), b.run('refreshAuth()')]);
  assert.equal(refreshes, 1, 'Concurrent tabs must not rotate the same refresh token twice');
  assert.equal(b.run('authSession.refresh_token'), 'rotated-refresh');
  let reboots = 0;
  b.context.boot = async () => { reboots++; };
  b.run('booted=true;isOwner=true');
  a.run('clearAuth()');
  for (const handler of b.events.storage) handler({ key: 'forte-auth-v1', oldValue: JSON.stringify(fresh), newValue: null });
  assert.equal(b.run('authSession'), null); assert.equal(b.run('isOwner'), false); assert.equal(reboots, 1);
  a.session.set('forte-auth-v1', JSON.stringify(fresh));
  assert.equal(a.run('restoreAuth()'), null, 'A legacy copy must not restore an account after logout');
  a.context.fixture = expired; a.run('rememberAuth(fixture)');
  let finish, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  a.context.fetch = () => new Promise(resolve => { finish = resolve; started(); });
  const pending = a.run('refreshAuth()');
  await requestStarted; a.run('clearAuth()');
  finish({ ok: true, json: async () => fresh });
  await assert.rejects(pending, /sessão terminou/);
  assert.equal(shared.has('forte-auth-v1'), false, 'An in-flight refresh must not undo logout');
  const c = tab();
  c.context.fetch = async () => ({ ok: true, json: async () => fresh });
  c.context.boot = async () => { c.run("isOwner=true;currentProfile={role:'admin',position:'Gerente',name:'João Pedro'}"); };
  const fields = { email: { value: 'test@example.invalid' }, password: { value: 'test-password' } };
  c.context.loginForm = { querySelector: () => ({ disabled: false }), elements: { namedItem: key => fields[key] } };
  await c.run('signInAccount(loginForm)');
  assert.equal(c.location.hash, '#/loja/conta', 'Store login keeps admins in their customer-facing account page');
  console.log('Shared store sessions, token refresh coordination, logout, account labels and admin store login verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
