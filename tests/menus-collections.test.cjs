const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast','#menus-save-bar'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields{constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}getAll(name){return this.rows.filter(([key])=>key===name).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/menus'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(a,b,url){context.location.hash=url.slice(url.indexOf('#'));},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
run(`db=defaults();db.products=[{id:1,name:'Árvore 10',sku:'1',price:900,promoPrice:200,cost:50,stock:7,active:true,category:'Sofás',categories:['Sofás','Outlet']},{id:2,name:'Arvore 2',sku:'2',price:500,cost:70,stock:8,active:true,category:'Sofás',categories:['Sofás']},{id:3,name:'Banco',sku:'3',price:100,cost:80,stock:9,active:false,category:'Sofás'}];db.collections=['Sofás','Outlet','Oculta'];db.collectionSettings={Sofás:{productIds:[2,1,3]},Oculta:{active:false}};db.orders=[{id:15,customer:'Cliente de teste',items:[{id:1,qty:1,price:200}]}];db.pages=[{id:1,title:'Sobre',active:true}];storefront.init(db);db.storefront.sections=[{id:'linked',type:'collection',category:'Sofás',enabled:true}];db.storefront.pageSettings={'collection:Sofás':{title:'Título personalizado'}};role='Proprietário';isOwner=true;currentProfile={role:'master',name:'Grupo Outlet'};authSession={user:{id:'master'}};stateVersion=1;db.navigation=fallbackStoreMenus();render=()=>{};toast=message=>{document.querySelector('#toast').textContent=message};`);
assert.deepEqual(plain(run("collectionProducts('Sofás').map(p=>p.id)")),[2,1,3]);
for(const [mode,expected] of [['price_asc',[3,1,2]],['price_desc',[2,1,3]],['title_asc',[2,1,3]],['title_desc',[3,1,2]]]){run(`db.collectionSettings.Sofás.sort='${mode}'`);assert.deepEqual(plain(run("collectionProducts('Sofás').map(p=>p.id)")),expected);}
assert.deepEqual(plain(run("collectionProducts('Sofás',true).map(p=>p.id)")),[1,2],'published lists exclude drafts');
run("db.collectionSettings.Sofás.sort='manual';setCollectionSort(0,'price_asc')");
assert.deepEqual(plain(run('collectionSortDraft.ids')),[2,1,3]);assert.equal(run('db.collectionSettings.Sofás.sort'),'manual','sort selection is a draft');
assert.doesNotMatch(run("collectionDetailPage('Sofás')"),/ondragstart=/,'automatic order cannot be dragged');
run("setCollectionSort(0,'manual');moveCollectionProduct(0,1,-1)");assert.deepEqual(plain(run('collectionSortDraft.ids')),[1,2,3]);
assert.equal(run("allowed('menus')"),true);run("role='Gerente'");assert.equal(run("allowed('menus')"),true);run("role='Vendedor'");assert.equal(run("allowed('menus')"),false);run("role='Proprietário'");
const original=plain(run('db.navigation'));
run("changeMenuName('main-menu','Navegação editada');moveMenuItem('main-menu','collection-2',-1);indentMenuItem('main-menu','collection-1')");
assert.deepEqual(plain(run('db.navigation')),original,'menu editing must not change the published navigation');
assert.equal(run('menusDirty()'),true);
assert.equal(run("editableMenus().menus[0].items[1].children[0].id"),'collection-1');
run("outdentMenuItem('main-menu','collection-1')");assert.equal(run("editableMenus().menus[0].items[2].id"),'collection-1');
assert.match(run('storeHeader()'),/Todos os móveis/);assert.doesNotMatch(run('storeHeader()'),/>Oculta</);
assert.doesNotMatch(run('menuTreeMarkup([{id:"x",label:"Perigoso",type:"external",target:"javascript:alert(1)",children:[],newTab:false}])'),/javascript|Perigoso/);
assert.match(run('menuLinkMarkup({label:"Sofás",type:"collection",target:"Sofás",newTab:true})'),/colecao=Sof%C3%A1s.*target="_blank"/);
assert.match(run('menuLinkMarkup({label:"Todos",type:"catalog",newTab:false})'),/colecao=Todos/,'the full catalog must clear a previous collection filter');
assert.match(run('menuLinkMarkup({label:"<img>",type:"external",target:"https://example.com/?q=1&x=2",newTab:true})'),/&lt;img&gt;/);
// Groups have no dummy link; inactive collections and empty groups remain hidden.
context.groupForm={data:[['label','Sala de estar'],['type','group'],['target','ignored']],elements:{namedItem:()=>({checked:true})}};
run("saveMenuItemDraft(groupForm,'main-menu','');groupId=editableMenus().menus[0].items.at(-1).id");
assert.equal(run("editableMenus().menus[0].items.at(-1).target"),'');assert.equal(run("editableMenus().menus[0].items.at(-1).newTab"),false);
context.collectionForm={data:[['collections','Sofás'],['collections','Outlet'],['collections','Sofás'],['collections','inexistente']]};
run("addMenuSubcollections(collectionForm,'main-menu',groupId);addMenuSubcollections(collectionForm,'main-menu',groupId)");
assert.deepEqual(plain(run("editableMenus().menus[0].items.at(-1).children.map(c=>c.target)")),['Sofás','Outlet']);
const groupMarkup=run('menuTreeMarkup([editableMenus().menus[0].items.at(-1)])');
assert.match(groupMarkup,/<summary>Sala de estar/);assert.match(groupMarkup,/colecao=Sof%C3%A1s/);assert.doesNotMatch(groupMarkup,/store-menu-overview/);
assert.equal(run("menuTreeMarkup([{type:'group',label:'Vazio',children:[]}])"),'');
assert.equal(run("menuTreeMarkup([{type:'group',label:'Ocultas',children:[{type:'collection',target:'Oculta',label:'Oculta',children:[]}]}])"),'');
assert.deepEqual(plain(run('db.navigation')),original,'adding groups does not publish the draft');
run("confirmRemoveMenuItem('main-menu',groupId)");
run("location.hash='#/loja/catalogo?colecao=Sof%C3%A1s'");assert.equal(run('routePath()'),'/loja/catalogo');
run("editableMenus().menus[0].items[2].label='Linha especial';db.navigation.menus[0].items[1].label='Título próprio'");
context.settleAdminWrites=async()=>{};let requests=[];
context.backendRequest=async(route,options)=>{const body=JSON.parse(options.body);requests.push({route,body});if(route.endsWith('save_collection')){assert.equal(body.p_expected_version,1);assert.ok(options.body.length<500,'renaming must not send products or banner images');return {version:2};}if(route.endsWith('save_navigation'))return {version:3};throw Error('Unexpected route');};
context.loadAdminState=async()=>{};
const submit={disabled:false},fields={name:{value:'Sofás novos'},previousName:{value:'Sofás'},active:{checked:true},sort:{value:'price_asc'}};
context.form={elements:{namedItem:name=>fields[name]},querySelector:()=>submit};
(async()=>{
 const before=plain(run('db'));await run('saveCollection(form,0)');
 assert.equal(requests[0].route,'/rest/v1/rpc/save_collection');assert.equal(run('stateVersion'),2);assert.equal(submit.disabled,false);
 const after=plain(run('db'));assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.products.map(({category,categories,...p})=>p),before.products.map(({category,categories,...p})=>p));
 assert.deepEqual(after.products[0].categories,['Sofás novos','Outlet']);assert.equal(after.products[2].category,'Sofás novos');
 assert.equal(after.storefront.sections[0].category,'Sofás novos');assert.deepEqual(after.storefront.pageSettings['collection:Sofás novos'],before.storefront.pageSettings['collection:Sofás']);
 assert.equal(after.navigation.menus[0].items[1].label,'Título próprio','custom menu labels are preserved');assert.equal(after.navigation.menus[0].items[1].target,'Sofás novos');
 assert.equal(after.collectionSettings['Sofás novos'].sort,'price_asc');assert.equal(after.collectionSettings.Sofás,undefined);
 // Rebase a clean menu draft from renamed collections before saving independent changes.
 run("location.hash='#/app/menus';menusDraft=null;menusBaseline=null;changeMenuName('main-menu','Menu da loja');setMenuPlacement('footerHelp','main-menu')");
 assert.match(run('menusPage()'),/Salvar mudanças/);assert.doesNotMatch(run('storeFooter()'),/<strong>Menu da loja<\/strong>/);
 await run('saveMenus()');assert.equal(requests[1].route,'/rest/v1/rpc/save_navigation');assert.equal(run('menusDirty()'),false);assert.equal(run("db.navigation.locations.footerHelp"),'main-menu');assert.match(run('storeFooter()'),/Menu da loja/);
 // A network failure must leave the edited title and publication unchanged and allow retry.
 const published=plain(run('db'));fields.name.value='Nome não salvo';fields.previousName.value='Sofás novos';context.backendRequest=async()=>{throw new TypeError('Failed to fetch');};
 await run('saveCollection(form,0)');assert.equal(submit.disabled,false);assert.deepEqual(plain(run('db')),published);assert.equal(fields.name.value,'Nome não salvo');assert.match(nodes['#toast'].textContent,/alterações foram mantidas/);
 run("changeMenuName('main-menu','Rascunho preservado')");await run('saveMenus()');assert.equal(run('menusDirty()'),true);assert.equal(run("db.navigation.menus[0].name"),'Menu da loja');
 run("role='Vendedor'");await assert.rejects(run("commitCollectionEdit('Sofás novos','Proibido',true,'manual')"),/permissão/);const draft=plain(run('menusDraft'));run("setMenuPlacement('header','');changeMenuName('main-menu','Proibido')");assert.deepEqual(plain(run('menusDraft')),draft);
 console.log('Collection rename payload, promotional-price sorting, manual order, linked references, isolated menu drafts, hierarchy, safe links, permissions and network failure recovery verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
