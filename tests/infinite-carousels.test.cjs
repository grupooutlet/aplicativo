const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},removeEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));

class Classes{constructor(){this.values=new Set()}add(x){this.values.add(x)}remove(x){this.values.delete(x)}toggle(x,on){on?this.add(x):this.remove(x)}}
class Item{
 constructor(tag='div',attrs={}){this.tag=tag;this.attrs={...attrs};this.classList=new Classes();this.image={loading:'eager',removeAttribute(){}};}
 setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}
 cloneNode(){return new Item(this.tag,{...this.attrs})}
 querySelectorAll(selector){return selector==='img'?[this.image]:[]}
 matches(selector){return this.tag==='button'||this.tag==='a'}
 getBoundingClientRect(){const left=this.parent.children.indexOf(this)*this.parent.step-this.parent.scrollLeft;return{left,right:left+this.parent.step,width:this.parent.step}}
 remove(){const index=this.parent.children.indexOf(this);if(index>=0)this.parent.children.splice(index,1)}
}
class Rail{
 constructor(count,width,step=width,tag='div'){this.clientWidth=width;this.step=step;this._left=0;this.listeners={};this.classList=new Classes();this.children=Array.from({length:count},(_,i)=>new Item(tag,{id:'original-'+i}));for(const item of this.children)item.parent=this;}
 get scrollWidth(){return this.children.length*this.step}get firstElementChild(){return this.children[0]}
 get scrollLeft(){return this._left}set scrollLeft(left){this._left=Math.max(0,Math.min(this.scrollWidth-this.clientWidth,left));this.emit('scroll')}
 insertBefore(node,anchor){node.parent=this;this.children.splice(this.children.indexOf(anchor),0,node)}appendChild(node){node.parent=this;this.children.push(node)}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn)}removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(item=>item!==fn)}
 emit(name,event={}){for(const fn of this.listeners[name]||[])fn(event)}scrollTo({left}){this.scrollLeft=left}
 getBoundingClientRect(){return{left:0,right:this.clientWidth,width:this.clientWidth}}
 querySelectorAll(selector){return this.children}setPointerCapture(){this.captured=true}hasPointerCapture(){return this.captured}releasePointerCapture(){this.captured=false}
}
assert.equal(run('carouselModulo(-1,3)'),2);assert.equal(run('carouselModulo(3,3)'),0);
const single=new Rail(1,390);context.single=single;assert.equal(run('createInfiniteRail(single,single.children.slice())'),null);
for(const [count,width,step]of [[2,320,320],[9,390,390],[6,390,94]]){
 const rail=new Rail(count,width,step,'button'),originals=rail.children.slice();context.testRail=rail;context.originalItems=originals;
 const loop=run('createInfiniteRail(testRail,originalItems)');assert.equal(rail.children.length,count*5);assert.equal(loop.index(),0);assert.equal(rail.scrollLeft,count*2*step);
 assert.equal(rail.children.filter(item=>item.getAttribute('id')).length,count,'Copies cannot duplicate IDs');assert.equal(rail.children[0].getAttribute('aria-hidden'),'true');assert.equal(rail.children[0].getAttribute('tabindex'),'-1');
 loop.go(-1,'instant');assert.equal(loop.index(),count-1);loop.normalize();assert.equal(loop.index(),count-1,'Recentering preserves the visible item');
 loop.go(count,'instant');assert.equal(loop.index(),0);loop.normalize();assert.equal(loop.index(),0);
 for(let pass=0;pass<20;pass++){loop.go(pass%count,'instant');loop.normalize();assert.equal(loop.index(),pass%count)}
 const before=loop.index();rail.step=step*.8;rail.clientWidth=width*.8;loop.measure();assert.equal(loop.index(),before,'Resizing keeps the current item');
 loop.destroy();assert.equal(rail.children.length,count);assert.equal(rail._carouselLoop,undefined);assert.equal(rail.listeners.scroll.length,0);
}
const main=new Rail(3,320),thumbs=new Rail(3,160,80,'button'),counter={textContent:''};
nodes['.product-photo-rail']=main;nodes['.detail-thumbs']=thumbs;nodes['.product-photo-counter']=counter;
run('setupProductGallery()');assert.equal(counter.textContent,'1 / 3');
const key=key=>main.emit('keydown',{key,preventDefault(){}});
key('End');assert.equal(counter.textContent,'3 / 3');key('ArrowRight');assert.equal(counter.textContent,'1 / 3','Next from the last photo loops to the first');key('ArrowLeft');assert.equal(counter.textContent,'3 / 3','Previous from the first photo loops to the last');
const pointer=x=>({pointerType:'mouse',button:0,buttons:1,pointerId:1,clientX:x,preventDefault(){}});
main._carouselLoop.normalize();main.emit('pointerdown',pointer(270));main.emit('pointermove',pointer(150));main.emit('pointerup',pointer(150));main._carouselLoop.normalize();assert.equal(counter.textContent,'1 / 3','Dragging across the end also loops');
main.emit('pointerdown',pointer(60));main.emit('pointermove',pointer(200));main.emit('pointerup',pointer(200));main._carouselLoop.normalize();assert.equal(counter.textContent,'3 / 3');
const selected=thumbs.children.filter(item=>item.classList.values.has('is-selected'));assert.ok(selected.length);assert.ok(selected.every(item=>item.getAttribute('data-loop-index')==='2'));
run('productGalleryCleanup()');assert.equal(main.children.length,3);assert.equal(thumbs.children.length,3);assert.equal(main.listeners.scroll.length,0);
let mobile=true;const resizes=[];context.window.matchMedia=()=>({matches:mobile});context.window.addEventListener=(name,fn)=>{if(name==='resize')resizes.push(fn)};context.window.removeEventListener=(name,fn)=>{const index=resizes.indexOf(fn);if(index>=0)resizes.splice(index,1)};
const collection=new Rail(6,390,94,'a'),short=new Rail(2,390,94,'a');context.document.querySelectorAll=selector=>selector==='.collection-list-grid.is-mobile-carousel'?[collection,short]:[];
run('setupCollectionCarousels()');assert.equal(collection.children.length,30);assert.equal(short.children.length,2,'A row that already fits remains intact');
collection._carouselLoop.go(5,'instant');collection._carouselLoop.go(6,'instant');assert.equal(collection._carouselLoop.index(),0);
assert.equal(collection.children[0].getAttribute('tabindex'),'-1');assert.equal(collection.children[0].getAttribute('aria-hidden'),'true');
mobile=false;for(const resize of resizes.slice())resize();assert.equal(collection.children.length,6,'Desktop grid has only its original collection cards');
mobile=true;for(const resize of resizes.slice())resize();assert.equal(collection.children.length,30);run('setupCollectionCarousels()');assert.equal(collection.children.length,30,'Repeated setup cannot accumulate copies');
run('collectionCarouselsCleanup()');assert.equal(collection.children.length,6);assert.equal(resizes.length,0);
run('db=defaults()');assert.doesNotMatch(run('productPage(1)'),/product-breadcrumb|Voltar à loja/);assert.match(run('productPage(1)'),/Adicionar ao carrinho/);
console.log('Infinite carousels: both directions, repeated cycles, pointer/keyboard, active thumbnails, IDs/accessibility, resizing, fitting rows, desktop restoration and cleanup verified.');
