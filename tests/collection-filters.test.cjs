const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
class Fields{constructor(form){this.rows=form.data||[]}get(key){return this.rows.find(([name])=>name===key)?.[1]??null}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value)}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/loja/catalogo?colecao=Sof%C3%A1s'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},removeEventListener(){},scrollTo(){}},history:{replaceState(a,b,url){context.location.hash=url.slice(url.indexOf('#'))},pushState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network')}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
run(`db=defaults();db.collections=['Sofás','Mesas','Oculta'];db.collectionSettings={Sofás:{productIds:[2,1,3]},Oculta:{active:false}};db.products=[
 {id:1,name:'Sofá Ágata',sku:'1',active:true,category:'Sofás',price:2000,promoPrice:900,stock:10,variations:[{name:'Cor',values:['Bege','Azul']},{name:'Tamanho',values:['2,00m']}]},
 {id:2,name:'Sofá Brasil',sku:'2',active:true,category:'Sofás',price:1200,stock:10,variations:[{name:'cor',values:['Preto']},{name:'Tamanho',values:['1,80m']},{name:'Tecido',values:['Linho']}]},
 {id:3,name:'Sofá Céu',sku:'3',active:true,category:'Sofás',price:1500,stock:10,variations:[{name:'Cor',values:['BEGE']},{name:'Tamanho',values:['1,80m']}]},
 {id:4,name:'Rascunho',sku:'4',active:false,category:'Sofás',price:1,variations:[{name:'Cor',values:['Rascunho']}]},
 {id:5,name:'Mesa',sku:'5',active:true,category:'Mesas',price:300,variations:[{name:'Material',values:['Madeira']}]}
 ];db.productSales={'1':3,'2':8};db.orders=[];storefront.init(db);catalogCategory='Sofás';catalogQuery='';isOwner=false;render=()=>{};`);
assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[2,1,3]);
assert.deepEqual(plain(run("collectionFilterModel().facets.find(g=>g.key==='cor').values.map(v=>v[0])")),['azul','bege','preto']);
assert.doesNotMatch(run('catalogPage()'),/Buscar na coleção|Filtrar coleção|catalog-count|\d+ produtos/);
assert.match(run('catalogPage()'),/collection-filter-sidebar|Ordenar por|Mais vendidos|mobile-collection-filters/);
run("shopFilters.selected=[['cor',['bege','preto']]];shopFilters.min=1000;shopFilters.max=1600");
assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[2,3],'OR within one attribute and current promotional price');
run("shopFilters.selected=[['cor',['bege']],['tamanho',['2,00m']]];shopFilters.min=null;shopFilters.max=null");
assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[1],'AND between attributes');
run("shopFilters.selected=[];shopFilters.min=null;shopFilters.max=null;shopFilters.sort='price_asc'");
assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[1,2,3]);
run("shopFilters.sort='bestsellers'");assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[2,1,3]);
assert.deepEqual(plain(run("completedProductSales([{status:'delivered',paid:true,items:[{id:1,qty:2}]},{status:'cancelled',paid:true,items:[{id:1,qty:7}]},{status:'pending',paid:false,items:[{id:2,qty:5}]}])")),{'1':2});
for(const [input,value] of [['1.500,50',1500.5],['1500.50',1500.5],['R$ 1.500',1500],['0',0],['',null]])assert.equal(run('parseCollectionPrice('+JSON.stringify(input)+')'),value);
for(const input of ['-1','NaN','Infinity','1,2,3','10abc','999999999999'])assert.throws(()=>run('parseCollectionPrice('+JSON.stringify(input)+')'));
const error={hidden:true,focus(){this.focused=true}};context.form={id:'desktop-collection-filters',data:[['min','1.000'],['max','500']],querySelector:()=>error};
const before=plain(run('shopFilters'));run('applyCollectionFilters(form)');assert.deepEqual(plain(run('shopFilters')),before);assert.match(error.textContent,/máximo/);
context.form.data=[['min','0'],['max','1.000,00'],['facet:cor','bege']];run('applyCollectionFilters(form)');
assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[1]);assert.match(context.location.hash,/f=/);
const shared=context.location.hash;run("shopFilterHash=null;shopFilters={scope:''}");assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[1],'URL restores filters on refresh/back');
run("catalogCategory='Mesas';location.hash='#/loja/catalogo?colecao=Mesas'");assert.deepEqual(plain(run('collectionFilterModel().products.map(p=>p.id)')),[5]);assert.deepEqual(plain(run('shopFilters.selected')),[]);
run("catalogCategory='Oculta';location.hash='#/loja/catalogo?colecao=Oculta'");assert.equal(run('collectionFilterModel().products.length'),0);
run("catalogCategory='Sofás';location.hash='#/loja/catalogo?colecao=Sof%C3%A1s';collectionFilterModel();shopFilters.max=1");assert.match(run('catalogPage()'),/Nenhum produto encontrado/);
run('clearCollectionFilters()');assert.equal(run('collectionFilterModel().products.length'),3);
run(`db.products[0].variations.push({name:'<img src=x>',values:['<script>']})`);const markup=run('catalogPage()');assert.match(markup,/&lt;img/);assert.doesNotMatch(markup,/<img src=x>|<script>/);
console.log('Collection filters: attribute OR/AND, actual prices, safe input, facet scope, sorting, completed sales, URL restore, empty states and escaping verified.');
