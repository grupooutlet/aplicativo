const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}get(key){return this.rows.find(([name])=>name===key)?.[1]??null;}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));

run(`db=defaults();role='Proprietário';isOwner=true;currentProfile={role:'master'};authSession={user:{id:'master'}};render=()=>{};stateVersion=10;`);
assert.deepEqual(plain(run("orderCreatedParts({createdAt:'2026-10-10T02:30:00Z',date:'2026-10-10'})")),{date:'09/10/2026',time:'23:30'});
assert.deepEqual(plain(run("orderCreatedParts({date:'2026-10-10'})")),{date:'10/10/2026',time:'Horário não registrado'});
assert.equal(run("orderCreatedParts({date:'2026-02-31'}).date"),'Data não registrada');
run("db.products[0].image='https://example.invalid/main.webp';db.orders=[{id:100,customer:'Cliente QA',date:'2026-10-10',createdAt:'2026-10-10T14:35:00Z',status:'delivered',paid:true,items:[{id:1,name:'Nome salvo · Cor: Bege',qty:1,price:1000}],notes:'Anterior',channel:'Loja online'}]");
const items=run("orderItemVisual(db.orders[0].items[0])");assert.match(items,/main.webp/);assert.match(items,/Nome salvo/);assert.match(items,/width="44"/);assert.match(run("orderItemVisual({id:999,name:'<script>bad</script>'})"),/product-placeholder.svg/);assert.doesNotMatch(run("orderItemVisual({id:999,name:'<script>bad</script>'})"),/<script>/);
assert.match(run("orderItemVisual({id:1,name:'Serviço',stockTracked:false})"),/order-item-service/);assert.doesNotMatch(run("orderItemVisual({id:1,name:'Serviço',stockTracked:false})"),/<img/);
assert.match(run('orderTable(db.orders)'),/11:35/);assert.match(run('orderNotesCard(db.orders[0])'),/Editar/);run("role='Estoque'");assert.doesNotMatch(run('orderNotesCard(db.orders[0])'),/onclick/);run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor'}");assert.match(run('orderNotesCard(db.orders[0])'),/Editar/);
const original=plain(run('db.orders[0]'));let requests=0;
context.settleAdminWrites=async()=>{};context.loadAdminState=async()=>{};
context.backendRequest=async(route,options)=>{requests++;assert.equal(route,'/rest/v1/rpc/save_order_notes');const data=JSON.parse(options.body);assert.deepEqual(data,{p_order_id:100,p_notes:'Nova\nLinha 2',p_expected_notes:'Anterior'});return{version:11}};
const submit={disabled:false};context.notesForm={data:[['notes',' Nova\nLinha 2 '],['expectedNotes','Anterior']],querySelector:()=>submit};
const eventFor=(type,target,extra={})=>({type,target,blocked:false,preventDefault(){this.blocked=true},stopImmediatePropagation(){},...extra});
let decision=true,prompts=0;context.confirmBusinessChange=async spec=>{prompts++;assert.match(spec.description,/confirma/);return decision};
const input={name:'name',className:'',type:'text',value:'Produto QA',checked:false};
const form={tagName:'FORM',isConnected:true,dataset:{},getAttribute:name=>name==='onsubmit'?"event.preventDefault();saveProduct(this,1)":null,querySelectorAll:()=>[input],requestSubmit(){this.submitted=(this.submitted||0)+1}};
form.data=[['name','Produto QA']];context.testEvent=eventFor('submit',form);
(async()=>{
 await run('saveOrderNotes(notesForm,100)');assert.equal(requests,1);assert.deepEqual(plain(run('db.orders[0]')),original,'No mutation before reloading the saved state');assert.equal(submit.disabled,false);
 run("currentProfile={role:'customer'};role='Proprietário'");await run('saveOrderNotes(notesForm,100)');assert.equal(requests,1);
 run("currentProfile={role:'master'};location.hash='#/app/products'");
 await run('guardBusinessEvent(testEvent)');assert.equal(prompts,1);assert.equal(form.submitted,1);assert.equal(context.testEvent.blocked,true);
 decision=false;context.testEvent=eventFor('submit',form);await run('guardBusinessEvent(testEvent)');assert.equal(form.submitted,1,'Cancel never submits');assert.equal(input.value,'Produto QA','Form values survive cancellation');
 let resolver;context.confirmBusinessChange=()=>new Promise(resolve=>resolver=resolve);context.testEvent=eventFor('submit',form);const pending=run('guardBusinessEvent(testEvent)');input.value='Mudou durante a confirmação';resolver(true);await pending;assert.equal(form.submitted,1,'Changed form cannot replay stale approval');
 input.value='Produto QA';context.testEvent=eventFor('submit',form);const pendingVersion=run('guardBusinessEvent(testEvent)');run('stateVersion++');resolver(true);await pendingVersion;assert.equal(form.submitted,1);
 const checkbox={type:'checkbox',checked:false,isConnected:true,tagName:'INPUT',getAttribute:name=>name==='onchange'?'toggleCollection(0,this.checked)':null,closest:()=>null,dispatchEvent(){this.changed=(this.changed||0)+1}};
 context.Event=class{constructor(type,options){this.type=type}};context.checkboxEvent=eventFor('change',checkbox);context.confirmBusinessChange=async()=>false;
 await run('guardBusinessEvent(checkboxEvent)');assert.equal(checkbox.checked,true,'Canceled change restores the prior checkbox state');assert.equal(checkbox.changed,undefined);
 checkbox.checked=false;context.checkboxEvent=eventFor('change',checkbox);context.confirmBusinessChange=async()=>true;await run('guardBusinessEvent(checkboxEvent)');assert.equal(checkbox.checked,false);assert.equal(checkbox.changed,1);
 run("location.hash='#/loja/checkout'");context.testEvent=eventFor('submit',form);await run('guardBusinessEvent(testEvent)');assert.equal(context.testEvent.blocked,false,'Customer checkout is not intercepted');
 run("location.hash='#/app/products'");context.handlerElement={tagName:'BUTTON',form:null,closest:()=>null};assert.equal(run("businessActionRule('storefront.change(1)',handlerElement)"),null);assert.equal(run(`businessActionRule("applyBulkCatalog(this,'delete',[1])",handlerElement)`),null,'Existing deletion confirmation is kept as one step');
 assert.match(run("businessActionRule('storefront.publish()',handlerElement).impact"),/publicada/);assert.match(run("businessActionRule('saveMenus()',handlerElement).title"),/menus/);
 console.log('Order UX: cover images, saved item names, São Paulo timestamps, notes permissions/payload, confirmation cancellation, stale forms, checkbox rollback and checkout isolation verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
