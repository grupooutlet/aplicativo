const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},removeEventListener(){},scrollTo(){},render(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
run(`db=defaults();db.products=[
 {id:1,name:'Sofá Grécia',sku:'QA-01',categories:['Sofás','Ofertas'],price:900,promoPrice:500,active:true},
 {id:2,name:'Poltrona Ágata',sku:'QA-02',category:'Poltronas',price:650,active:false},
 {id:3,name:'Sofá América',sku:'QA-03',category:'Sofás',price:700,active:true},
 {id:4,name:'Mesa 2',sku:'QA-04',categories:[],price:250,active:true},
 {id:5,name:'Mesa 10',sku:'QA-05',category:'Mesas',price:350,active:true}];db.collections=['Sofás','Poltronas','Ofertas','Mesas'];productStatusFilter='all';`);
const ids=()=>plain(run('filteredCatalogProducts().map(p=>p.id)'));
assert.deepEqual(ids(),[5,4,3,2,1]);
run("catalogAdminSort='oldest'");assert.deepEqual(ids(),[1,2,3,4,5]);
run("catalogAdminSort='price_asc'");assert.deepEqual(ids(),[4,5,1,2,3],'Promotion is the effective price');
run("catalogAdminSort='price_desc'");assert.deepEqual(ids(),[3,2,1,5,4]);
run("catalogAdminSort='title_asc'");assert.deepEqual(ids(),[4,5,2,3,1],'Natural numbers and Portuguese accents');
run("catalogAdminSort='title_desc'");assert.deepEqual(ids(),[1,3,2,5,4]);
run("catalogCollectionFilter='Ofertas'");assert.deepEqual(ids(),[1],'Secondary memberships are included');
run("catalogCollectionFilter='Sofás';productQuery=' grecia   SOFA '");assert.deepEqual(ids(),[1]);
run("productQuery='QA-03'");assert.deepEqual(ids(),[3]);
run("productQuery='';catalogCollectionFilter='none'");assert.deepEqual(ids(),[4]);
run("catalogCollectionFilter='all';productStatusFilter='draft'");assert.deepEqual(ids(),[2]);
run("productStatusFilter='active';productQuery='inexistente'");assert.deepEqual(ids(),[]);
run("productStatusFilter='all';productQuery='';catalogAdminSort='newest';db.products[0].createdAt='2026-10-25T12:00:00Z'");assert.equal(ids()[0],1,'Explicit creation dates take precedence over legacy IDs');
assert.equal(run("matchesSearch('João Silva · #123 · São João','  sao #123  JOAO ')"),true);
assert.doesNotMatch(run("shell('products','')"),/global-search|Buscar produtos, pedidos e clientes/);
run("role='Entregador'");assert.doesNotMatch(run("shell('deliveries','')"),/global-search/);run("role='Proprietário'");
// Searches preserve permissions, combine with existing status/day filters and escape queries.
run(`db.orders=[{id:123,customer:'João Silva',seller:'Márcia',phone:'21999998888',address:'São João',status:'pending',date:'2026-10-25',delivery:'Entrega',deliveryDate:'2026-10-26',items:[],freight:0}];orderQuery='  joao  ';orderFilter='all';`);
assert.match(run('ordersPage()'),/#123/);run("orderFilter='delivered'");assert.doesNotMatch(run('ordersPage()'),/#123/);
run("deliveryDayFilter='2026-10-26';deliverySearch='sao joao'");assert.match(run('deliveryBoard()'),/João Silva/);
run("deliveryDayFilter='2026-10-27'");assert.doesNotMatch(run('deliveryBoard()'),/João Silva/);
context.searchForm={q:{value:'  poltrona  '}};context.go=path=>{context.searchPath=path};run("catalogCategory='Sofás';searchStore(searchForm)");assert.equal(context.searchPath,'/loja/catalogo?q=poltrona');assert.equal(run('catalogCategory'),'Todos');
// A live search keeps the caret, clears correctly and cannot render another route later.
let pendingSearch,searchRenderCount=0;context.setTimeout=fn=>{pendingSearch=fn;return 1};context.clearTimeout=()=>{pendingSearch=null};
context.render=()=>searchRenderCount++;
const searchInput={value:'Grécia',isConnected:true,selectionStart:3,selectionEnd:3},restoredInput={focus(){this.focused=true},setSelectionRange(a,b){this.caret=[a,b]}};
context.searchInput=searchInput;context.document.activeElement=searchInput;nodes['[data-section-search="products"]']=restoredInput;
run("updateSectionSearch(searchInput,'products')");assert.equal(run('productQuery'),'Grécia');pendingSearch();assert.equal(searchRenderCount,1);assert.equal(restoredInput.focused,true);assert.deepEqual(restoredInput.caret,[3,3]);
searchInput.value='';run("updateSectionSearch(searchInput,'products')");pendingSearch();assert.equal(run('productQuery'),'');
run("updateSectionSearch(searchInput,'products');location.hash='#/app/orders'");pendingSearch();assert.equal(searchRenderCount,2,'Navigation cancels a pending search render');
assert.match(run('productPicker()'),/product-picker-empty/);
const rows=[{dataset:{search:'sofa grecia qa-01'},hidden:false},{dataset:{search:'poltrona qa-02'},hidden:false}],pickerEmpty={hidden:true};
context.pickerInput={value:'  QA-01 sofa ',closest:()=>({querySelectorAll:()=>rows,querySelector:()=>pickerEmpty})};run('filterProductPicker(pickerInput)');assert.deepEqual(rows.map(x=>x.hidden),[false,true]);
context.pickerInput.value='notfound';run('filterProductPicker(pickerInput)');assert.equal(pickerEmpty.hidden,false);
// Typed colors use the same isolated draft and validation as the native picker.
run("location.hash='#/app/store-editor';storefront.init(db);isOwner=true;currentProfile={role:'master'};authSession={user:{id:'master'}}");
const section=run("storefront.add('collection')");run(`storefront.toggle('${section}',true)`);
assert.match(run('storefront.storeHome()'),/collection-footer footer-align-center/);
assert.match(run('storefront.storeHome()'),/--product-button-bg:#1c2228/);
const before=run('JSON.stringify(db.storefront)');
const makeColor=value=>{
 const hex={value,error:'',setCustomValidity(s){this.error=s},setAttribute(){}},picker={value:''};
 hex.closest=()=>({querySelector:s=>s==='.builder-color-hex'?hex:picker});return{hex,picker};
};
let color=makeColor('#12');context.color=color.hex;run("storefront.changeColor(color,'viewAllColor')");assert.ok(color.hex.error);
assert.match(run('storefront.storeHome()'),/--product-button-bg:#1c2228/);
color=makeColor('#abcdef');context.color=color.hex;run("storefront.changeColor(color,'viewAllColor',false,true)");assert.equal(color.picker.value,'#abcdef');assert.equal(color.hex.value,'#ABCDEF');
assert.match(run('storefront.storeHome()'),/--product-button-bg:#abcdef/);assert.equal(run('JSON.stringify(db.storefront)'),before,'Colors stay in draft');
color=makeColor('abc');context.color=color.hex;run("storefront.changeColor(color,'viewAllColor',false,true)");assert.equal(color.hex.value,'#AABBCC');
const controls=run('storefront.editorPage()');assert.equal((controls.match(/type="color"/g)||[]).length,(controls.match(/class="builder-color-hex"/g)||[]).length);
// Gallery: native scrolling, thumbnails, pointer drag bounds, keyboard and cleanup.
class Rail{
 constructor(width,count){this.clientWidth=width;this.scrollWidth=width*count;this.scrollLeft=0;this.listeners={};this.attrs={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
 addEventListener(k,f){(this.listeners[k]||=[]).push(f)}removeEventListener(k,f){this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==f)}emit(k,e={}){for(const f of this.listeners[k]||[])f(e)}
 setPointerCapture(){this.captured=true}hasPointerCapture(){return this.captured}releasePointerCapture(){this.captured=false}
 scrollTo({left}){this.scrollLeft=Math.max(0,Math.min(this.scrollWidth-this.clientWidth,left));this.emit('scroll')}
 setAttribute(k,v){this.attrs[k]=v}getBoundingClientRect(){return{left:0,right:this.clientWidth}}
}
const main=new Rail(300,9),thumbs=new Rail(220,4),counter={textContent:''};
const buttons=Array.from({length:9},(_,i)=>{const b=new Rail(76,1);b.getBoundingClientRect=()=>({left:i*86-thumbs.scrollLeft,right:i*86+76-thumbs.scrollLeft});return b});
thumbs.scrollWidth=9*86;main.querySelectorAll=()=>Array(9).fill({});thumbs.querySelectorAll=()=>buttons;
nodes['.product-photo-rail']=main;nodes['.detail-thumbs']=thumbs;nodes['.product-photo-counter']=counter;
run('setupProductGallery()');assert.equal(counter.textContent,'1 / 9');
main.scrollLeft=600;main.emit('scroll');assert.equal(counter.textContent,'3 / 9');assert.equal(buttons[2].attrs['aria-pressed'],'true');
run('selectProductPhoto(8)');assert.equal(main.scrollLeft,2400);assert.equal(counter.textContent,'9 / 9');
main.emit('keydown',{key:'Home',preventDefault(){}});assert.equal(main.scrollLeft,0);
const pointer=(x,extra={})=>({pointerType:'mouse',button:0,buttons:1,pointerId:1,clientX:x,preventDefault(){},...extra});
main.emit('pointerdown',pointer(250));main.emit('pointermove',pointer(130));main.emit('pointerup',pointer(130));assert.equal(main.scrollLeft,300);assert.equal(counter.textContent,'2 / 9');
main.scrollTo({left:0});main.emit('pointerdown',pointer(10));main.emit('pointermove',pointer(500));main.emit('pointerup',pointer(500));assert.equal(main.scrollLeft,0,'No drag beyond the first photo');
run('productGalleryCleanup()');assert.equal(main.listeners.scroll.length,0);assert.equal(thumbs.listeners.pointermove.length,0);
console.log('Catalog filtering/six sorts, accent-safe searches, draft HEX colors, gallery synchronization, mouse drag bounds, keyboard and cleanup verified.');
