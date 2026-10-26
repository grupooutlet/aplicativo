const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),nodes={'#app':{innerHTML:''},'#modal':{classList:{add(){},remove(){}},showModal(){},close(){}},'#toast':{}};
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,navigator:{},crypto:require('node:crypto').webcrypto,FormData:class{},
 location:{protocol:'https:',hostname:'forteoutlet.com.br',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/themes'},
 document:{hidden:false,baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{innerWidth:390,addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','business.js','panel.js','themes.js','live-view.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=s=>vm.runInContext(s,context),plain=v=>JSON.parse(JSON.stringify(v));
(async()=>{
run("db=defaults();role='Proprietário';isOwner=true;booted=true;currentProfile={role:'master',name:'Grupo Outlet'};authSession={user:{id:'master'}};render=()=>{};storefront.init(db);db.activeThemeId='live';db.storeThemes=[{id:'live',name:'Publicado',config:structuredClone(db.storefront)},{id:'draft',name:'Nova coleção',config:structuredClone(db.storefront)}];");
const publicConfig=plain(run('db.storefront'));
assert.match(run('themesPage()'),/Rascunhos de tema/);assert.match(run('panelNav(\'themes\')'),/Live View/);
assert.equal(run("allowed('themes')&&allowed('live-view')"),true);
const chrome=run("shell('products','')");
assert.doesNotMatch(chrome,/class="topbar"|Painel da loja|panel-collapse|Recolher menu lateral/);
assert.match(chrome,/class="panel-account-row"[\s\S]*Conta e visualizações[\s\S]*Abrir alertas/);
assert.match(chrome,/id="panel-workspace"/);
let hasMore=false;context.scrollFixture={scrollHeight:1000,clientHeight:600,scrollTop:0};context.frameFixture={classList:{toggle(name,value){assert.equal(name,'panel-has-more');hasMore=value;}}};
run('updatePanelScrollFade(scrollFixture,frameFixture)');assert.equal(hasMore,true);
context.scrollFixture.scrollTop=400;run('updatePanelScrollFade(scrollFixture,frameFixture)');assert.equal(hasMore,false,'The end of the page must remain readable');
context.scrollFixture={scrollHeight:400,clientHeight:600,scrollTop:0};run('updatePanelScrollFade(scrollFixture,frameFixture)');assert.equal(hasMore,false,'Short pages do not need a fade');
context.location.hash='#/app/store-editor/draft';run("storefront.editorPage();storefront.change('title','Título privado')");
assert.deepEqual(plain(run('db.storefront')),publicConfig);assert.equal(run('storefront.dirty()'),true);assert.doesNotMatch(JSON.stringify(run('db.storeThemes')),/Título privado/);
context.location.hash='#/app/store-editor/live';run('storefront.editorPage()');assert.equal(run('storefront.dirty()'),false,'Different themes must never share draft edits');
context.toast=()=>{};context.window.render=()=>{};context.loadAdminState=async()=>{};context.settleAdminWrites=async()=>{};
run("storefront.change('title','Outra alteração')");await run('storefront.cancelChanges()');assert.deepEqual(plain(run('db.storefront')),publicConfig);assert.equal(run('storefront.dirty()'),false);
run("db.products[0].cost=123456;db.orders=[{id:1,customer:'Private person'}]");const preview=plain(run('themePreviewModel(db.storefront)'));
assert.equal(preview.orders.length,0);assert.equal(preview.products.some(p=>'cost' in p),false);assert.equal(preview.settings.goal,undefined);
run("liveSnapshot={locations:[{city:'São Gonçalo',region:'RJ',country:'BR',visitors:2,latitude:-22.8,longitude:-43}],active:2};liveQuery='sao goncalo'");assert.equal(run('liveLocations().length'),1);assert.equal(run('validLivePoint({latitude:null,longitude:0})'),false);
run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor'}");assert.equal(run('allowed(\'themes\')'),true);assert.equal(run('allowed(\'live-view\')'),false);assert.equal(run('canViewLive()'),false);assert.match(run('panelNav(\'themes\')'),/Loja virtual/);assert.doesNotMatch(run('panelNav(\'themes\')'),/Live View|Histórico de alterações|Equipe e permissões/);
run("role='Entregador';currentProfile={role:'driver',position:'Entregador'}");assert.match(run('panelNav(\'deliveries\')'),/Entregas/);assert.doesNotMatch(run('panelNav(\'deliveries\')'),/Loja virtual|Pagamentos|Produtos/);assert.match(run('shell(\'deliveries\',\'\')'),/Atualizar entregas/);
context.location.hash='#/loja/produto/1';run("currentProfile=null;authSession=null;isOwner=false");assert.equal(run('audienceEligible()'),true);context.navigator.doNotTrack='1';assert.equal(run('audienceEligible()'),false);context.navigator.doNotTrack=undefined;context.location.search='?storePreview=1';assert.equal(run('audienceEligible()'),false);context.location.search='';run("currentProfile={role:'admin'}");assert.equal(run('audienceEligible()'),false);
assert.equal(run('audiencePhase()'),'product');assert.equal(Object.keys(plain(run("safeJson(sessionStore.getItem(liveVisitKey),null)"))||{}).length,0);
assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'_routes.json'),'utf8')).include),'["/api/live"]');
console.log('Panel: role-preserving navigation, isolated theme drafts/cancel/scope, private preview, city search, coordinates, driver refresh and optional audience eligibility verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});
