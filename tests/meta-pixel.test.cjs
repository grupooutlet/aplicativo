const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const storage=new Map(),requests=[],events=[],nodes={},listeners={};
const ctx=vm.createContext({console,URL,URLSearchParams,crypto:require('node:crypto').webcrypto,Date,Set,Map,
 location:{hostname:'forteoutlet.com.br',search:'?fbclid=real_click_identifier_123'},navigator:{userAgent:'Browser UA'},
 window:{fbq:(...a)=>events.push(a),addEventListener(){}},document:{cookie:'_fbp=fb.1.1234567890123.123456789',querySelector:s=>nodes[s]||null,createElement:()=>({}),head:{append(){}},addEventListener:(type,fn)=>listeners[type]=fn},
 localStore:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},safeJson:(s,f)=>{try{return JSON.parse(s)||f}catch{return f}},
 db:{products:[{id:1,name:'Sofá de teste',price:100,active:true}],cart:[],orders:[]},route:'/loja/produto/1',audienceEligible:()=>ctx.eligible,eligible:true,routePath:()=>ctx.route,
 salePrice:p=>p.price,render:()=>{},cartQuantity:id=>ctx.db.cart.filter(i=>i.id===id).reduce((n,i)=>n+i.qty,0),addToCart:(id,qty)=>{if(qty>0&&qty<10)ctx.db.cart.push({id,qty})},
 backendRequest:async(...args)=>{requests.push(args)},setAudienceConsent:()=>{},audienceChoices:()=>'',audiencePreferences:()=>{},liveConsentKey:'audience',modal(){},closeModal(){}
});
vm.runInContext(fs.readFileSync('meta-pixel.js','utf8'),ctx);const run=s=>vm.runInContext(s,ctx),tracks=()=>events.filter(e=>e[0].startsWith('track'));
run('syncMetaPixel()');assert.equal(events.length,0);storage.set('audience','yes');run('syncMetaPixel()');assert.equal(events.length,0,'old measurement consent must not enable advertising');
storage.set('forte-meta-consent-v1','yes');run('syncMetaPixel()');assert.deepEqual(tracks().map(x=>x[2]),['PageView','ViewContent']);run('syncMetaPixel();render()');assert.equal(tracks().length,2);
run('addToCart(1,2)');assert.equal(tracks().at(-1)[2],'AddToCart');assert.equal(tracks().at(-1)[3].value,200);run('addToCart(1,20)');assert.equal(tracks().length,3);
ctx.route='/loja/checkout';run('syncMetaPixel()');assert.equal(tracks().at(-1)[2],'InitiateCheckout');assert.equal(tracks().at(-1)[3].num_items,2);
const context=run('metaCheckoutContext()');assert.equal(context.fbp,'fb.1.1234567890123.123456789');assert.match(context.fbc,/real_click_identifier/);assert.equal(context.email,undefined);
ctx.order={id:101,total:250,paymentMethodId:'pay-pix',installments:1,items:[{id:1,qty:2,price:100}]};ctx.orderContext=context;
run('metaOrderPlaced(order,orderContext);metaOrderPlaced(order,orderContext)');assert.equal(tracks().filter(x=>x[2]==='OrderPending').length,1);assert.equal(tracks().some(x=>x[2]==='Purchase'),false);
assert.equal(tracks().filter(x=>x[2]==='AddPaymentInfo').length,1);assert.equal(tracks().find(x=>x[2]==='AddPaymentInfo')[3].value,250);
ctx.eligible=false;run('syncMetaPixel()');assert.equal(requests.length,0,'visiting admin/hidden page must not revoke an existing order consent');ctx.eligible=true;run('syncMetaPixel()');
run('setAudienceConsent(false)');assert.equal(storage.get('forte-meta-consent-v1'),'no');assert.equal(requests.length,1);assert.deepEqual(JSON.parse(requests[0][1].body).p_ids,[context.id]);assert.ok(events.some(e=>e[0]==='consent'&&e[1]==='revoke'));
console.log('Meta pixel: explicit fresh consent, single SPA events, correct cart values, rejected additions, checkout, stable pending-order deduplication, no browser Purchase, staff exclusion and explicit revocation verified.');
