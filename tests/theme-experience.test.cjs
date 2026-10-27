const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=Object.fromEntries(['#app','#modal','#toast','#builder-controls','#builder-save-bar'].map(s=>[s,{innerHTML:'',classList:{add(){},remove(){}},showModal(){},close(){}}]));
const ctx=vm.createContext({console,Intl,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,navigator:{},FormData:class{},
 location:{protocol:'https:',hostname:'forteoutlet.com.br',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/store-editor'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{innerWidth:1280,addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor','app','production','enhancements','variations','fulfillment','operations','commerce','merchandising','menus','shipping','change-history','business','panel','themes','live-view','storefront-runtime'])vm.runInContext(fs.readFileSync(name+'.js','utf8').replace(/boot\(\);\s*$/,''),ctx,{filename:name});
const run=s=>vm.runInContext(s,ctx),plain=v=>JSON.parse(JSON.stringify(v));
run(`db=defaults();db.collections=['Sofás','Poltronas','Oculta'];db.collectionSettings={Oculta:{active:false}};db.products=[
{id:1,name:'Sofá atual',active:true,category:'Sofás',price:1000,stock:10,image:'https://example.invalid/1.jpg'},
{id:2,name:'Sofá semelhante',active:true,category:'Sofás',price:1100,stock:10,image:'https://example.invalid/2.jpg'},
{id:3,name:'Poltrona',active:true,category:'Poltronas',price:500,stock:10,image:'https://example.invalid/3.jpg'},
{id:4,name:'Sofá no carrinho',active:true,category:'Sofás',price:900,stock:10},
{id:5,name:'Rascunho',active:false,category:'Sofás',price:1000},
{id:6,name:'Coleção oculta',active:true,category:'Oculta',price:1000}];db.orders=[];db.cart=[{id:4,qty:1}];db.settings.phone='21968464050';storefront.init(db);isOwner=true;role='Proprietário';currentProfile={role:'master'};authSession={user:{id:'master'}};`);
const baseline=run('JSON.stringify(db.storefront)');
run("storefront.navigate('template:product')");const id=run("storefront.add('recommendations')");run(`storefront.toggle('${id}',true);storefront.change('background','#1c2228');storefront.change('textColor','#ffffff')`);
assert.equal(run('JSON.stringify(db.storefront)'),baseline,'Page sections remain private drafts');
assert.match(run("storefront.renderPageSections('/loja/produto/1')"),/Você também pode gostar/);
const markup=run("storefront.renderPageSections('/loja/produto/1')");assert.match(markup,/Sofá semelhante/);assert.doesNotMatch(markup,/Sofá atual|Sofá no carrinho|Rascunho|Coleção oculta|Ver todos/);assert.ok(markup.indexOf('Sofá semelhante')<markup.indexOf('Poltrona'));assert.match(markup,/--block-bg:#1c2228/);
assert.deepEqual(plain(run("storefront.sectionProducts({type:'recommendations',limit:1},'/loja/produto/1').map(p=>p.id)")),[2]);
assert.equal(run("storefront.renderPageSections('/loja/produto/1','before')"),'');
run("storefront.change('position','before')");assert.match(run("storefront.renderPageSections('/loja/produto/1','before')"),/Você também pode gostar/);
run("storefront.changeGlobal('headerBackground','#1c2228');storefront.changeGlobal('headerText','#ffffff');storefront.changeGlobal('headerIcon','#f3c30b')");assert.equal(run('JSON.stringify(db.storefront)'),baseline);assert.match(run('storefront.editorPage()'),/código hexadecimal/);assert.match(run('storefront.editorPage()'),/headerBackground.*&quot;global&quot;/);
run("storefront.navigate('/loja/carrinho')");assert.doesNotMatch(run("storefront.renderPageSections('/loja/carrinho')"),/Você também pode gostar/,'Page blocks do not leak into another page');
const cartId=run("storefront.add('collection')");run(`storefront.toggle('${cartId}',true);storefront.change('category','Poltronas')`);assert.match(run("storefront.renderPageSections('/loja/carrinho')"),/Poltrona/);assert.doesNotMatch(run("storefront.renderPageSections('/loja/carrinho')"),/Sofá semelhante/);
run(`storefront.remove('${cartId}')`);assert.equal(run("storefront.renderPageSections('/loja/carrinho')"),'','Last additional section can be removed');
run("storefront.navigate('/loja/cadastro')");const signupId=run("storefront.add('collection')");run(`storefront.toggle('${signupId}',true);storefront.change('title','Seleção do cadastro')`);
assert.match(run("storefront.renderPageSections('/loja/conta','after','signup')"),/Seleção do cadastro/,'Auth view selects the signup template even from an account route');
assert.doesNotMatch(run("storefront.renderPageSections('/loja/conta')"),/Seleção do cadastro/);run(`storefront.remove('${signupId}')`);
assert.match(run("storeHelpLink('/loja/produto/1')"),/^https:\/\/wa.me\/5521968464050\?/);assert.match(decodeURIComponent(run("storeHelpLink('/loja/produto/1')")),/Sofá atual/);
run("db.settings.phone='11987654321'");assert.match(run('storeHelpLink()'),/5511987654321/,'Link always reads the current store number');run("db.settings.phone='123'");assert.equal(run('storeHelpLink()'),'');
for(const path of ['/app','/loja/checkout','/loja/login','/loja/cadastro','/loja/pedido/2','/loja/conta'])assert.equal(run(`storeHelpAllowed('${path}')`),false,path);
for(const path of ['/loja','/loja/produto/1','/loja/carrinho','/loja/catalogo'])assert.equal(run(`storeHelpAllowed('${path}')`),true,path);
assert.match(run("storeHelpMessage(4,'/loja/produto/1')"),/móvel/);assert.match(run("storeHelpMessage(4,'/loja/carrinho')"),/carrinho/);
let writes=0;ctx.backendRequest=async(route,options)=>{writes++;const body=JSON.parse(options.body);assert.equal(JSON.stringify(body.p_expected),baseline);assert.equal(body.p_storefront.pageSettings.product.sections[0].type,'recommendations');run('db.storefront='+JSON.stringify(body.p_storefront));};ctx.loadAdminState=async()=>{};ctx.settleAdminWrites=async()=>{};
(async()=>{await run('storefront.publish()');assert.equal(writes,1);assert.equal(run('storefront.dirty()'),false);const published=run('JSON.stringify(db.storefront)');run("storefront.changeGlobal('footerText','#eeffee')");await run('storefront.cancelChanges()');assert.equal(run('JSON.stringify(db.storefront)'),published);assert.equal(run('storefront.dirty()'),false);console.log('Theme experience: contextual page blocks, collection selection, recommendations/exclusions/ranking, draft/publish/cancel isolation, HEX globals, dynamic WhatsApp links and safe route scope verified.');})().catch(e=>{console.error(e);process.exitCode=1;});
