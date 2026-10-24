const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const nodes = Object.fromEntries(['#app', '#modal', '#toast'].map(id => [id, { innerHTML: '', open: false, classList: { add() {}, remove() {} } }]));
const context = vm.createContext({ console, URL, Date, Map, Set, structuredClone,
  location: { protocol: 'https:', pathname: '/', hash: '#/loja', host: 'forteoutlet.com.br' },
  document: { baseURI: 'https://forteoutlet.com.br/', querySelector: s => nodes[s] || null, querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, scrollTo() {} }, history: { pushState() {}, replaceState() {} },
  setTimeout: () => 1, clearTimeout() {}, fetch: async () => { throw new Error('Unexpected network call'); }
});
for (const file of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:file});
const run = source => vm.runInContext(source,context);
for (const input of ['21961234567','(21) 96123-4567','+55 (21) 96123-4567','5521961234567'])
  assert.equal(context.normalizeRegistrationPhone(input),'+5521961234567');
assert.equal(context.normalizeRegistrationPhone('(21) 3234-5678'),'+552132345678');
assert.equal(context.normalizeRegistrationPhone('(55) 3234-5678'),'+555532345678','DDD 55 is a valid national area code');
for (const input of ['',null,'123','00000000000','99999999999','23961234567','+121961234567','2196123456','2161234567','219612345678','abc21961234567','+55+21961234567','021961234567'])
  assert.equal(context.normalizeRegistrationPhone(input),'',input+' must be rejected');
context.authPage('signup');
assert.match(nodes['#app'].innerHTML,/<input type="tel"[^>]*name="phone"[^>]*required>/);
assert.match(nodes['#app'].innerHTML,/signup-phone-error/);
context.authPage('login');assert.doesNotMatch(nodes['#app'].innerHTML,/name="phone"/);
const feedback={hidden:true,textContent:''};
const phone={value:'23961234567',setCustomValidity(message){this.error=message},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},form:{querySelector:()=>feedback}};
assert.equal(context.validateSignupPhone(phone),false);assert.equal(phone['aria-invalid'],'true');assert.equal(feedback.hidden,false);
context.clearSignupPhoneError(phone);assert.equal(phone.error,'');assert.equal(feedback.hidden,true);
phone.value='21961234567';assert.equal(context.validateSignupPhone(phone),true);assert.equal(phone.value,'+55 (21) 96123-4567');
run("isOwner=false;currentProfile={name:'Ana Silva',email:'ana@example.invalid',phone:'+5521961234567'};authSession={user:{id:'u1'}};db.orders=[];");
assert.equal(context.checkoutContact().phone,'+5521961234567','A new account pre-fills checkout before the first purchase');
(async()=>{
 const requests=[];context.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({access_token:'test-only'})}};
 run('rememberAuth=()=>{};boot=async()=>{};go=()=>{};toast=()=>{}');
 const submit={disabled:false};
 const fields={name:{value:'Ana Silva'},email:{value:'ANA@example.invalid'},password:{value:'test-only-password'},passwordConfirm:{value:'test-only-password'},phone};
 const form={querySelector:()=>submit,elements:{namedItem:key=>fields[key]}};
 for(const bad of ['', '23961234567', '2196123456', 'abc21961234567']){
  fields.password.value=fields.passwordConfirm.value='test-only-password';phone.value=bad;
  await context.registerAccount(form);assert.equal(requests.length,0,'Invalid phone must never reach signup');assert.equal(submit.disabled,false);
 }
 fields.password.value=fields.passwordConfirm.value='test-only-password';phone.value='(21) 96123-4567';
 await context.registerAccount(form);assert.equal(requests.length,1);assert.equal(requests[0].body.data.phone,'+5521961234567');
 assert.equal(requests[0].body.email,'ana@example.invalid');
 console.log('Required signup phone, DDD/prefix/length validation, accessible errors, canonical storage and first checkout prefill verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
