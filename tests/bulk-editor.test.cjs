const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}get(key){return this.rows.find(([name])=>name===key)?.[1]??null;}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));

run(`db=defaults();db.products=[
 {id:1,name:'Sofá teste',description:'Preservar descrição',sku:'QA-1',price:1000,promoPrice:null,cost:600,stock:10,min:2,active:true,image:'photo.jpg',images:['photo.jpg'],categories:['Sofás','Ofertas'],category:'Sofás',variations:[{name:'Cor',values:['Bege']},{name:'Tamanho',values:['1,80 m']}]},
 {id:2,name:'Poltrona teste',sku:'QA-2',price:800,promoPrice:700,cost:400,stock:5,min:1,active:true,image:'photo.jpg',images:['photo.jpg'],category:'Poltronas',variations:[{name:'Cor',values:['Cinza']}]},
 {id:3,name:'Produto não selecionado',sku:'QA-3',price:500,cost:200,stock:10,min:0,active:false,image:'photo.jpg',variations:[]}];
 db.collections=['Sofás','Poltronas','Ofertas'];db.attributeCatalog=[{name:'Cor',values:['Bege','Cinza','Azul']},{name:'Tamanho',values:['1,80 m','2,00 m']}];
 db.orders=[{id:50,status:'pending',items:[{id:1,name:'Nome histórico',options:{Cor:'Bege'},qty:3,price:1000,cost:600}]}];
 role='Proprietário';isOwner=true;currentProfile={role:'master'};authSession={user:{id:'master'}};stateVersion=10;
 renderBulkEditor=()=>{};render=()=>{};`);
const initial=plain(run('db')),open=()=>run('catalogSelection=new Set([1,2]);openBulkEditor()');
const form=(rows)=>({data:rows});
context.collectionForm=form([['mode','add'],['collections','Ofertas']]);
context.variationForm=form([['mode','add'],['attribute','Cor'],['values','Azul']]);
open();run("bulkSetField(1,'price','1100');bulkSetField(1,'name','Sofá revisado')");assert.deepEqual(plain(run('db')),initial,'No writes to published data while editing');
run("bulkSetField(1,'price','1000');bulkSetField(1,'name','Sofá teste')");assert.equal(run('bulkEditorChanges().length'),0,'Numeric strings do not create phantom changes');
run('bulkApplyCollections(collectionForm)');assert.deepEqual(plain(run('productCollections(bulkEditor.drafts[1])')),['Poltronas','Ofertas']);
context.collectionForm=form([['mode','remove'],['collections','Sofás']]);run('bulkApplyCollections(collectionForm)');assert.deepEqual(plain(run('productCollections(bulkEditor.drafts[0])')),['Ofertas']);assert.equal(run('bulkEditor.drafts[0].category'),'Ofertas');
context.collectionForm=form([['mode','replace'],['collections','Sofás']]);run('bulkApplyCollections(collectionForm)');assert.equal(run("bulkEditor.drafts.every(p=>productCollections(p).join()==='Sofás')"),true);
const beforeInvalid=run('JSON.stringify(bulkEditor.drafts)');context.collectionForm=form([['mode','add'],['collections','Removed']]);run('bulkApplyCollections(collectionForm)');assert.equal(run('JSON.stringify(bulkEditor.drafts)'),beforeInvalid);
run('bulkApplyVariations(variationForm)');assert.deepEqual(plain(run('bulkEditor.drafts[0].variations[0].values')),['Bege','Azul']);assert.equal(run('bulkEditor.drafts[0].variations[1].name'),'Tamanho');
context.variationForm=form([['mode','remove'],['attribute','Cor'],['values','Bege']]);run('bulkApplyVariations(variationForm)');assert.deepEqual(plain(run('bulkEditor.drafts[0].variations[0].values')),['Azul']);
context.variationForm=form([['mode','replace'],['attribute','cor'],['customValues','bege\nBEGE\nAzul']]);run('bulkApplyVariations(variationForm)');assert.deepEqual(plain(run('bulkEditor.drafts[0].variations[0].values')),['Bege','Azul']);
context.variationForm=form([['mode','removeAttribute'],['attribute','Cor']]);run('bulkApplyVariations(variationForm)');assert.equal(run("bulkEditor.drafts.every(p=>!p.variations.some(a=>a.name==='Cor'))"),true);assert.deepEqual(plain(run('db.attributeCatalog')),initial.attributeCatalog);
context.variationForm=form([['mode','add'],['customName','Medida'],['customValues','1,80 m\n2,00 m']]);run('bulkApplyVariations(variationForm)');assert.deepEqual(plain(run("bulkEditor.drafts[0].variations.find(a=>a.name==='Medida').values")),['1,80 m','2,00 m']);
run("bulkEditor.drafts[0].variations=Array.from({length:5},(_,i)=>({name:'A'+i,values:['X']}))");const overflow=run('JSON.stringify(bulkEditor.drafts)');context.variationForm=form([['mode','add'],['customName','Sexto'],['customValues','X']]);run('bulkApplyVariations(variationForm)');assert.equal(run('JSON.stringify(bulkEditor.drafts)'),overflow,'Validation is atomic across all drafts');
open();run("bulkSetField(1,'price','123.456')");assert.throws(()=>run('bulkValidateChanges()'),/casas decimais/);run("bulkSetField(1,'price','1000');bulkSetField(1,'stock','2')");assert.throws(()=>run('bulkValidateChanges()'),/reservadas/);
run("bulkSetField(1,'stock','3.5')");assert.throws(()=>run('bulkValidateChanges()'),/inteiras/);
run("bulkSetField(1,'stock','10');bulkSetField(1,'promoPrice','1000')");assert.throws(()=>run('bulkValidateChanges()'),/promoção/);
run("bulkSetField(1,'promoPrice','');bulkSetField(1,'price','')");assert.throws(()=>run('bulkValidateChanges()'),/preço/);
open();run("bulkSetField(1,'name','<script>review</script>')");assert.match(run('bulkReviewPanel()'),/&lt;script&gt;/);assert.doesNotMatch(run('bulkReviewPanel()'),/<script>/);
run('requestBulkClose()');assert.equal(run('bulkEditor.discard'),true);run('discardBulkEditor()');assert.equal(run('bulkEditor'),null);assert.deepEqual(plain(run('db')),initial);
let writes=0,server=structuredClone(initial),rejectWrite=false;
context.settleAdminWrites=async()=>{};
context.backendRequest=async(route,options)=>{
 assert.equal(route,'/rest/v1/rpc/save_catalog');const body=JSON.parse(options.body);assert.equal(body.p_expected_version,run('stateVersion'));
 if(rejectWrite)throw Error('O catálogo mudou em outra sessão.');
 writes++;server={...server,...body.p_changes};return{version:11};
};
context.loadAdminState=async()=>{run('db='+JSON.stringify(server));run('stateVersion++')};
(async()=>{
 open();context.collectionForm=form([['mode','add'],['collections','Ofertas']]);run('bulkApplyCollections(collectionForm)');context.variationForm=form([['mode','add'],['customName','Tecido'],['customValues','Linho\nVeludo']]);run('bulkApplyVariations(variationForm)');run("bulkSetField(1,'price','1200');bulkEditor.tab='review'");
 await run('saveBulkEditor()');assert.equal(writes,1);assert.equal(run('bulkEditor'),null);assert.equal(run('catalogSelection.size'),0);assert.deepEqual(server.orders,initial.orders,'Historical order choices remain intact');assert.deepEqual(server.products[2],initial.products[2],'Unselected products unchanged');assert.equal(server.products[0].description,initial.products[0].description);assert.deepEqual(server.products[0].images,initial.products[0].images);assert.ok(server.attributeCatalog.some(a=>a.name==='Tecido'&&a.values.includes('Linho')));
 open();run("bulkSetField(1,'price','1300');bulkEditor.tab='review';db.products[0].name='Alterado em outra sessão'");await run('saveBulkEditor()');assert.equal(writes,1,'A stale local snapshot cannot overwrite newer edits');assert.ok(run('bulkEditor'));assert.equal(run('bulkEditor.busy'),false);run('discardBulkEditor()');
 run('db='+JSON.stringify(server));open();run("bulkSetField(1,'price','1400');bulkEditor.tab='review'");rejectWrite=true;await run('saveBulkEditor()');assert.equal(writes,1);assert.equal(run('bulkEditor.drafts[0].price'),'1400','Server failures retain the draft');assert.equal(run('bulkEditor.busy'),false);
 run('discardBulkEditor()');run("role='Vendedor';catalogSelection=new Set([1,2]);openBulkEditor()");assert.equal(run('bulkEditor'),null);await run('saveBulkEditor()');assert.equal(writes,1);
 console.log('Bulk editor: isolated drafts, add/remove/replace collections and variations, limits, prices/stock, review escaping, permissions, atomic save, conflicts and preserved orders verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
