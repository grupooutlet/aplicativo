const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),nodes=Object.fromEntries(['#app','#modal','#toast','#change-history-results'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,
 location:{protocol:'https:',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/settings'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');},FormData:class{constructor(form){return Object.entries(form.data||{});}}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=x=>JSON.parse(JSON.stringify(x));
run(`db=defaults();db.products=[{id:1,name:'Sofá',sku:'GO-1',stock:100,price:500,active:true}];db.collections=['Sofás'];db.collectionSettings={};db.orders=[];db.orderBumps=[{id:'bump',title:'Impermeabilização',price:50,kind:'service',active:true,allProducts:true,targetProductIds:[]}];db.settings.shippingMode='regional';db.settings.shippingOptions=[];isOwner=true;booted=true;role='Vendedor';currentProfile={role:'admin',position:'Vendedor',name:'Bianca Melo'};authSession={user:{id:'seller'}};storefront.init(db);render=()=>{};toast=message=>{globalThis.lastToast=message};`);
for(const page of ['deliveries','payments','order-bumps','collections','store-editor','menus','pages','settings'])assert.equal(run(`allowed('${page}')`),true,page+' must be accessible to sellers');
for(const page of ['reports','team','change-history'])assert.equal(run(`allowed('${page}')`),false,page+' remains restricted');
assert.equal(run('canManage()'),false);assert.equal(run('canConfigurePayments()'),true);assert.equal(run('canConfigureFreight()'),true);assert.equal(run('canSeeChangeHistory()'),false);
assert.match(context.paymentsPage(),/Personalizar/);context.collectionModal(0);assert.match(nodes['#modal'].innerHTML,/Salvar coleção/);context.newMenuModal();assert.match(nodes['#modal'].innerHTML,/Criar menu/);
assert.match(run('storefront.editorPage()'),/Prévia|Salvar|Nenhuma/);
run('toggleBumpKind=()=>{}');context.orderBumpModal(0);assert.doesNotMatch(nodes['#modal'].innerHTML,/Custo do serviço|Cadastrar novo produto/);
assert.doesNotMatch(context.changeHistoryPage(),/change-history-results|Ver alterações/);
assert.equal(run("auditTime('2026-10-24T16:45:12Z')"),'24/10/2026, 13:45:12');
assert.deepEqual(plain(context.auditFieldDiff({price:100},{price:150})),[{name:'Preço',before:'100',after:'150'}]);
(async()=>{
 let writes=[];context.backendRequest=async(route,options)=>{writes.push({route,body:JSON.parse(options.body)});return {version:1};};run('settleAdminWrites=async()=>{};loadAdminState=async()=>{};closeModal=()=>{}');
 await context.loadChangeHistory();await context.changeHistoryDetail(1);await context.revertHistoryChange(1,{});assert.equal(writes.length,0,'sellers cannot load, inspect or reverse audit entries');
 const value={...run('storeConfigSnapshot()'),name:'Forte Outlet atualizado'};
 assert.equal(await context.persistSiteSection('store',value,run('storeConfigSnapshot()')),true);
 assert.equal(writes[0].route,'/rest/v1/rpc/save_site_section');assert.deepEqual(Object.keys(writes[0].body).sort(),['p_expected','p_section','p_value']);assert.equal(writes[0].body.p_section,'store');assert.equal(writes[0].body.p_value.products,undefined);
 run("role='Gerente';currentProfile={role:'admin',position:'Gerente',name:'Eduardo Thales'}");assert.equal(run('canSeeChangeHistory()'),true);assert.equal(run("allowed('settings')"),true);
 context.backendRequest=async(route,options)=>{writes.push({route,body:JSON.parse(options.body)});return {entries:[{id:1,actor_name:'<img src=x>',actor_position:'Vendedor',summary:'Alterou frete',areas:['shippingOptions'],created_at:'2026-10-24T16:45:12Z',change_count:1}],next_cursor:1};};
 await context.loadChangeHistory();const html=context.changeHistoryPage();assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/Ver alterações/);assert.match(html,/13:45:12/);
 const sql=fs.readFileSync(path.join(root,'supabase/audit-history-functions.sql'),'utf8');
 assert.match(sql,/enable row level security/);assert.match(sql,/Este registro foi alterado novamente/);assert.match(sql,/after insert or update of data/);assert.match(sql,/after insert or update or delete on public.profiles/);assert.match(sql,/after insert or update or delete on public.customer_contacts/);assert.doesNotMatch(sql,/from auth.users.*password|encrypted_password/);
 console.log('Seller store access, private costs, operational boundaries, isolated configuration writes and management audit UI verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
