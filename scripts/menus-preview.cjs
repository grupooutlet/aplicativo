// Isolated local QA. Every backend API request is intercepted; writes never reach production.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.join(__dirname,'..'),photo='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/products/import-forte-20261015/6b272894de868e2f310ef4caab11b12f.jpg';
const product=(id,name,price)=>({id,name,sku:'QA-'+id,description:'Conforto e praticidade para sua casa.\n\nAcabamento de qualidade com linhas modernas. Consulte as opções disponíveis antes de adicionar ao carrinho.',price,cost:50,stock:10,min:1,category:'Sofás',categories:['Sofás'],active:true,image:photo,images:[photo],variations:[]});
const model={products:[product(1,'Sofá retrátil Grécia',1597),{...product(2,'Sofá cama Madrid retrátil e reclinável com encosto alto e tecido de linho premium',1297),promoPrice:1097,variations:[{name:'Cor',values:['Cinza','Bege']},{name:'Tecido',values:['Linho']}]},product(3,'Poltrona de apoio',497),product(4,'Sofá de canto para sala de estar com chaise e assento retrátil',2297)],orders:[],team:[],movements:[],collections:['Sofás','Mesas e cadeiras','Poltronas'],collectionSettings:{},orderBumps:[],pages:[{id:1,title:'Sobre a loja',content:'Conteúdo da página.',active:true},{id:2,title:'Entrega e retirada',content:'Conteúdo da página.',active:true}],settings:{name:'Forte Outlet',phone:'5521999999999',address:'Endereço de demonstração',shippingOptions:[],paymentMethods:[]},storefront:{announcement:{enabled:true,text:'Forte Outlet',highlight:'Sua casa, do seu jeito.'},sections:[{id:'home-products',type:'collection',category:'Sofás',enabled:true,title:'Escolhas para sua casa',limit:8}]}};
const link=(id,label,type,target='')=>({id,label,type,target,children:[],newTab:false});
model.products[2].category='Poltronas';model.products[2].categories=['Poltronas'];
model.navigation={locations:{header:'main-menu',footerAbout:'footer-about',footerHelp:'footer-help'},menus:[{id:'main-menu',name:'Menu principal',active:true,items:[link('all-products','Todos os móveis','catalog'),{...link('living','Sala de estar','group'),children:[link('collection-1','Sofás','collection','Sofás'),link('collection-3','Poltronas','collection','Poltronas')]},link('collection-2','Mesas e cadeiras','collection','Mesas e cadeiras')]},{id:'footer-about',name:'Sobre a loja',active:true,items:model.pages.map(p=>link('page-'+p.id,p.title,'page',String(p.id)))},{id:'footer-help',name:'Conte com a gente',active:true,items:[link('account','Meus pedidos','account'),link('admin','Painel da loja','admin')]}]};
if(process.env.QA_INVENTORY==='1'){
 model.products=Array.from({length:65},(_,i)=>({...product(i+1,['Sofá retrátil Grécia','Mesa de jantar com quatro cadeiras','Poltrona de apoio'][i%3]+' '+(i+1),497+i*20),stock:i===0?0:i===1?2:10+i,min:3,active:i<60}));
 model.orders=[{id:1,status:'pending',items:[{id:3,qty:2}]}];
 model.movements=Array.from({length:45},(_,i)=>({id:1000+i,product:model.products[i].name,qty:10,reason:'Ajuste de demonstração',date:'24/10/2026, 10:00:00',by:i%2?'Grupo Outlet':'Eduardo Thales'}));
}
if(process.env.QA_SHIPPING==='1'){
 model.settings.shippingMode='regional';model.settings.shippingOptions=[{id:'pickup',name:'Retirada na loja',price:0,delivery:'Retirada',active:true},...require('./prepare-regional-shipping.cjs').map((o,i)=>({...o,id:'qa-region-'+i}))];
 model.settings.paymentMethods=[{id:'pix',kind:'pix',title:'Pix',active:true,installments:[{count:1,rate:0}]},{id:'credit',kind:'credit',title:'Cartão de crédito',active:true,installments:[{count:1,rate:0},{count:3,rate:5}]}];
}
const qaPosition=process.env.QA_STAFF_POSITION||'Principal';
if(process.env.QA_COLLECTION_LIST==='1'){
 const names=['Sofás','Racks','Guarda-roupas','Mesas de Jantar','Poltronas','Camas e colchões'];
 model.collections=names;model.products=names.map((category,i)=>({...product(i+1,category+' de demonstração',497+i*200),category,categories:[category]}));
 model.storefront.sections.unshift({id:'qa-collection-list',type:'collection-list',enabled:true,title:'O que você procura?',showHeading:true,shape:'square',imageFit:'cover',showTitles:true,columns:6,mobileColumns:2,mobileCarousel:true,background:'#1c2228',textColor:'#ffffff',cardBackground:'#f5f5f3',cardTextColor:'#1c2228',items:names.map((category,i)=>({id:'qa-collection-'+i,category,title:'',image:'',imageAlt:''}))});
}
if(process.env.QA_COMPACT_CAROUSEL==='1'){
 const section=model.storefront.sections.find(s=>s.type==='collection-list');
 if(section)Object.assign(section,{shape:'round',titleAlign:'center',padding:40,background:'#ffffff',textColor:'#1c2228'});
 model.storefront.sections.unshift({id:'qa-banner',type:'banner',enabled:true,showText:false,image:'https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/products/storefront-dbb0cf1720f8e41a77c07e89.png',imageAlt:'Banner da loja'});
 model.storefront.sections.find(s=>s.type==='collection').eyebrow='Os mais queridinhos';
}
if(process.env.QA_PRODUCT_DESIGN==='1'){
 model.products[0].images=Array.from({length:9},(_,i)=>photo+'?qa-photo='+i);
 model.products[0].image=model.products[0].images[0];
 model.products[3].active=true;
 model.storefront.sections=[{id:'qa-products',type:'collection',category:'Todos',enabled:true,title:'Escolhas para sua casa',eyebrow:'Os mais queridinhos',limit:8}];
}
if(process.env.QA_LOOP_CAROUSELS==='1'){
 model.products[0].name='Sofá Retrátil Reclinável Verona 2,00m Linho Bege - Molas Ensacadas';
 model.products[0].variations=[{name:'Cor',values:['Bege','Cinza']},{name:'Tamanho',values:['2,00m']}];
 model.storefront.sections.unshift({id:'qa-loop-collections',type:'collection-list',enabled:true,title:'O que você procura?',showHeading:true,titleAlign:'center',shape:'round',imageFit:'cover',showTitles:true,columns:6,mobileColumns:2,mobileCarousel:true,background:'#ffffff',textColor:'#1c2228',cardBackground:'#f5f5f3',cardTextColor:'#1c2228',items:model.collections.map((category,i)=>({id:'qa-loop-collection-'+i,category,title:'',image:'',imageAlt:''}))});
}
if(process.env.QA_COLLECTION_FILTERS==='1'){
 model.collections=['Sofás','Poltronas'];model.products=Array.from({length:12},(_,i)=>({...product(i+1,['Sofá retrátil Grécia','Sofá cama Madrid com encosto reclinável e tecido de linho premium','Sofá de canto com chaise'][i%3],697+i*150),promoPrice:i===0?597:undefined,variations:[{name:'Cor',values:[['Bege','Cinza','Preto'][i%3]]},{name:'Tamanho',values:[i%2?'1,80m':'2,00m']},{name:'Característica',values:[i%2?'Retrátil':'Fixo']},{name:'Tecido',values:[i%2?'Veludo':'Linho']}]}));
 model.productSales={'1':2,'3':9,'5':6};
}
const qaProfile={user_id:'qa-master',name:qaPosition==='Principal'?'Grupo Outlet':'Bianca QA',email:qaPosition==='Principal'?'grupooutlet.rj@gmail.com':'vendedor-qa@example.invalid',role:qaPosition==='Principal'?'master':'admin',position:qaPosition==='Principal'?null:qaPosition};
const qaCustomers=[],qaContacts=[];
if(process.env.QA_CUSTOMERS==='1'){
 qaCustomers.push({user_id:'qa-customer',role:'customer',name:'Marina Oliveira',email:'marina@example.invalid',created_at:'2026-10-19T13:30:00Z'},{user_id:'qa-no-orders',role:'customer',name:'Pedro Santos',email:'pedro@example.invalid',created_at:'2026-10-23T15:15:00Z'});
 qaContacts.push({id:'qa-contact',name:'Marina Oliveira',email:'marina@example.invalid',phone:'21999998888',created_at:'2026-10-19T13:30:00Z',address:'Rua das Flores, 100 · Centro · Nova Iguaçu / RJ · CEP 26000-000'});
 model.orders=[{id:102,user_id:'qa-customer',customer_id:'qa-contact',customer:'Marina Oliveira',email:'marina@example.invalid',phone:'21999998888',status:'transit',createdAt:'2026-10-24T14:30:00Z',channel:'Loja online',seller:'Bianca Melo',payment:'Pix',paid:false,delivery:'Entrega',deliveryDate:'2026-10-26',address:'Rua das Palmeiras, 25 · Centro · Nova Iguaçu / RJ · CEP 26000-010',freight:100,items:[{id:1,name:'Sofá retrátil Grécia · Cor: Bege',qty:1,price:1597,cost:50}]},{id:101,user_id:'qa-customer',customer_id:'qa-contact',customer:'Marina Oliveira',email:'marina@example.invalid',status:'delivered',createdAt:'2026-10-19T13:30:00Z',channel:'Loja física',seller:'Eduardo Thales',payment:'Cartão de débito',paid:true,delivery:'Entrega',address:qaContacts[0].address,freight:100,items:[{id:3,name:'Poltrona de apoio',qty:2,price:497,cost:50}]}];
}
if(process.env.QA_ORDER_UX==='1'){
 model.orders[0].notes='Cliente prefere a entrega no período da tarde.';
 model.orders[0].items.push({id:3,name:model.products[2].name,qty:1,price:model.products[2].price,cost:model.products[2].cost});
}
if(process.env.QA_BUSINESS==='1'){
 Object.assign(model.settings,{legalName:'Empresa de Teste LTDA',cnpj:'60.454.727/0001-70',email:'loja@example.invalid',phone:'5521968464050',address:'Rua de Teste, 100 · Centro · Nova Iguaçu / RJ · CEP 26260-045',addressParts:{cep:'26260-045',street:'Rua de Teste',number:'100',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ',complement:''}});
 model.pages=require('../content/institutional-pages.json').map((page,index)=>({...page,id:index+1,active:true,updatedAt:'2026-10-25T12:00:00Z'}));
}
if(process.env.QA_THEMES==='1'){
 model.activeThemeId='11111111-1111-4111-8111-111111111111';
 model.storeThemes=[{id:model.activeThemeId,name:'Forte · Principal',config:structuredClone(model.storefront),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},{id:'22222222-2222-4222-8222-222222222222',name:'Nova coleção · Rascunho',config:structuredClone(model.storefront),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
}
if(process.env.QA_THEME_EXPERIENCE==='1'){
 model.storefront.pageSettings={global:{headerBackground:'#1c2228',headerText:'#f5f5f3',headerIcon:'#f3c30b',footerBackground:'#1c2228',footerText:'#d6dde1',footerIcon:'#f3c30b'},product:{sections:[{id:'qa-page-recommendations',type:'recommendations',enabled:true,title:'Você também pode gostar',limit:4,showViewAll:false,position:'after',background:'#f6f7f4',textColor:'#1c2228'}]},cart:{sections:[{id:'qa-cart-collection',type:'collection',enabled:true,title:'Complete a sua casa',category:'Poltronas',limit:4,position:'after'}]}};
 for(const theme of model.storeThemes||[])theme.config=structuredClone(model.storefront);
}
if(process.env.QA_RECEIPTS==='1'){
 Object.assign(model.settings,{legalName:'Forte Outlet Group LTDA',cnpj:'60.454.727/0001-70',email:'grupooutlet.rj@gmail.com',phone:'5521968464050',address:'Avenida Abílio Augusto Távora, 857 · Da Luz · Nova Iguaçu / RJ · CEP 26260-045'});
 const base={id:5032,createdAt:'2026-10-25T19:20:00Z',date:'2026-10-25',channel:'Loja online',seller:'Loja online',customer:'Marina Oliveira · Exemplo',email:'cliente@example.invalid',phone:'21999998888',cpf:'12345678901',status:'pending',paid:false,delivery:'Entrega',deliveryDate:'2026-10-26',payment:'Pix',paymentMethodId:'pay-pix',paymentKind:'pix',paymentTiming:'Na entrega',freight:170,freightPending:false,paymentFee:0,total:867,shippingOptionName:'Rio de Janeiro · Irajá',address:'Rua das Flores, 30, apto. 101 · Irajá · Rio de Janeiro / RJ · CEP 21230-105',addressParts:{street:'Rua das Flores',number:'30',complement:'Apto. 101 · Bloco B',neighborhood:'Irajá',city:'Rio de Janeiro',state:'RJ',cep:'21230-105'},notes:'Ligar para o cliente antes de sair para entrega.\nAcesso pela portaria do bloco B.',items:[{id:1,name:'Sofá Malibu 2,30m · Cor: Cinza · Tamanho: 2,30m',qty:1,price:697,options:{Cor:'Cinza',Tamanho:'2,30m'}}]};
 model.orders=[base,{...structuredClone(base),id:5033,status:'transit',paid:true,paidAt:'2026-10-26T15:10:00Z',releasedAt:'2026-10-26T12:30:00Z'},
 {...structuredClone(base),id:5034,status:'cancelled',paid:true,cancelledAt:'2026-10-26T15:40:00Z',paidAt:'2026-10-26T15:10:00Z'},
 {...structuredClone(base),id:5035,status:'delivered',paid:true,delivery:'Retirada',paymentTiming:'Antecipado',paymentKind:'credit',payment:'Cartão de crédito',installments:3,installmentAmount:250,lastInstallmentAmount:250,freight:0,paymentFee:53,paymentRate:7.6,paidAt:'2026-10-26T13:10:00Z',releasedAt:'2026-10-26T15:30:00Z',deliveredAt:'2026-10-26T15:30:00Z'},
 {...structuredClone(base),id:5036,items:Array.from({length:24},(_,i)=>({id:1,name:'Sofá retrátil e reclinável com assento de molas ensacadas e acabamento em linho · Cor: Bege · Tamanho: 2,30m · Item '+(i+1),qty:2,price:1697,options:{Cor:'Bege',Tamanho:'2,30m'}}))}];
}
if(process.env.QA_PICKUPS==='1'){
 model.settings.address='Avenida da Loja, 857 · Nova Iguaçu / RJ';
 const base={customer:'Marina de Souza',firstName:'Marina',phone:'21999998899',email:'cliente@example.invalid',cpf:'',address:model.settings.address,delivery:'Retirada',payment:'Pix',paymentTiming:'Na retirada',freight:0,freightPending:false,createdAt:'2026-10-26T14:35:00Z',date:'2026-10-26',channel:'Loja online',seller:'Loja online',status:'pending',paid:false,items:[{id:1,name:model.products[0].name,qty:1,price:1597}]};
 model.orders=[{...structuredClone(base),id:5041}, {...structuredClone(base),id:5042,customer:'João Pedro',pickupReadyAt:'2026-10-26T15:15:00Z'},
 {...structuredClone(base),id:5043,customer:'Carolina Santos',paid:true,status:'ready',pickupReadyAt:'2026-10-26T14:30:00Z',pickupNotifiedAt:'2026-10-26T14:40:00Z',paidAt:'2026-10-26T16:00:00Z'},
 {...structuredClone(base),id:5044,customer:'Bruno Oliveira',paid:true,status:'delivered',pickupReadyAt:'2026-10-26T12:00:00Z',pickupNotifiedAt:'2026-10-26T12:10:00Z',paidAt:'2026-10-26T13:00:00Z',deliveredAt:'2026-10-26T13:20:00Z'}];
}
let qaHistory=[];
if(process.env.QA_AUDIT==='1'){
 const freight=model.settings.shippingOptions.find(o=>o.name==='Niterói');const before=structuredClone(freight);freight.price=220;
 qaHistory=[{id:9001,created_at:'2026-10-24T17:45:12Z',actor_name:'Bianca Melo',actor_role:'admin',actor_position:'Vendedor',areas:['shippingOptions'],summary:'Alterou: Niterói',change_count:1,reverted_at:null,changes:[{source:'state',kind:'entity',path:['settings','shippingOptions'],entityId:freight.id,before,beforeExists:true,after:structuredClone(freight),afterExists:true,label:'Niterói'}]}];
}
for(const order of model.orders)order.date||=String(order.createdAt||'2026-10-25').slice(0,10);
const preload=`<script>
let fixtureModel=${JSON.stringify(model)},fixtureVersion=1;
let fixtureProfile=${JSON.stringify(qaProfile)},fixtureHistory=${JSON.stringify(qaHistory)},fixtureCustomers=${JSON.stringify(qaCustomers)},fixtureContacts=${JSON.stringify(qaContacts)};
localStorage.setItem('forte-auth-v1',JSON.stringify({user:{id:'qa-master',email:'grupooutlet.rj@gmail.com'},access_token:'qa-local-only',refresh_token:'qa-local-only',expires_at:Math.floor(Date.now()/1000)+86400}));localStorage.setItem('forte-auth-shared-v1','1');
const actualPreviewFetch=window.fetch;window.fetch=async(input,options={})=>{
 const url=String(input);if(!url.includes('rwxqytomiorsrxpgtjin.supabase.co')||(url.includes('/storage/')&&['GET','HEAD'].includes(options.method||'GET')))return actualPreviewFetch(input,options);
 const body=options.body?JSON.parse(options.body):{},reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(${process.env.QA_SERVICE_RESTRICTED==='1'})return reply({message:'Service for this project is restricted: exceed_cached_egress_quota'},402);
 if(url.includes('/rest/v1/shop_public'))return reply([{data:{...fixtureModel,products:fixtureModel.products.map(({cost,...p})=>p)}}]);
 if(url.includes('/rest/v1/profiles'))return reply(url.includes('user_id=eq.')?[fixtureProfile]:[fixtureProfile,...fixtureCustomers]);
 if(url.includes('/rpc/sales_state'))return reply({data:{...fixtureModel,products:fixtureModel.products.map(({cost,...p})=>p),orderBumps:fixtureModel.orderBumps.map(({cost,...b})=>b)},version:fixtureVersion});
 if(url.includes('/rest/v1/customer_contacts'))return reply(fixtureContacts);
 if(url.includes('/rest/v1/app_state'))return reply([{data:fixtureModel,version:fixtureVersion}]);
 if(url.includes('/rpc/order_action')||url.includes('/rpc/confirm_pickup_notice')){
  const order=fixtureModel.orders.find(item=>item.id===body.p_order_id);if(!order)return reply({message:'Pedido não encontrado.'},400);
  if(url.includes('confirm_pickup_notice')){if(!order.pickupReadyAt)return reply({message:'Prepare o pedido antes de avisar.'},400);order.pickupNotifiedAt=new Date().toISOString();order.pickupNoticeMessage=body.p_message;}
  else if(body.p_action==='pickup_ready'){order.pickupReadyAt=new Date().toISOString();}
  else if(body.p_action==='release'){if(!order.paid||!order.pickupNotifiedAt)return reply({message:'Conclua as etapas anteriores.'},400);order.status='delivered';order.deliveredAt=new Date().toISOString();}
  else if(body.p_action==='payment'){order.paid=true;order.paidAt=new Date().toISOString();}
  return reply({id:order.id,version:++fixtureVersion});
 }
 if(url.includes('/rpc/move_stock')){
  const product=fixtureModel.products.find(p=>p.id===body.p_product_id);if(!product)return reply({message:'Produto não encontrado.'},400);
  const prior=fixtureModel.movements.find(m=>m.requestId===body.p_request_id);if(prior)return reply({id:prior.id,stock:product.stock,duplicate:true,version:fixtureVersion});
  const reserved=fixtureModel.orders.filter(o=>['pending','ready'].includes(o.status)).reduce((n,o)=>n+o.items.filter(i=>i.id===product.id&&i.stockTracked!==false).reduce((sum,i)=>sum+i.qty,0),0),qty=Number(body.p_quantity),delta=body.p_type==='out'?-qty:qty;
  if(!Number.isInteger(qty)||qty<1||!body.p_reason||body.p_type==='out'&&qty>product.stock-reserved)return reply({message:'Confira a quantidade e o saldo disponível.'},400);
  product.stock+=delta;const movement={id:Date.now(),productId:product.id,product:product.name,qty:delta,reason:body.p_reason,date:new Date().toLocaleString('pt-BR'),by:fixtureProfile.name,actorId:fixtureProfile.user_id,requestId:body.p_request_id};fixtureModel.movements.unshift(movement);return reply({id:movement.id,stock:product.stock,reserved,available:product.stock-reserved,version:++fixtureVersion});
 }
 if(url.includes('/rpc/save_order_notes')){const order=fixtureModel.orders.find(item=>item.id===body.p_order_id);if(!order)return reply({message:'Pedido não encontrado.'},400);if((order.notes||'')!==body.p_expected_notes)return reply({message:'A observação foi alterada em outra sessão.'},409);order.notes=body.p_notes;order.notesUpdatedAt=new Date().toISOString();return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_catalog')){if(body.p_expected_version!==fixtureVersion)return reply({message:'O catálogo mudou em outra sessão.'},409);Object.assign(fixtureModel,body.p_changes);return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_collection')){const before=body.p_previous,name=body.p_name;if(before){fixtureModel.collections=fixtureModel.collections.map(c=>c===before?name:c);for(const p of fixtureModel.products){p.categories=p.categories.map(c=>c===before?name:c);if(p.category===before)p.category=name;}}else fixtureModel.collections.push(name);fixtureModel.collectionSettings[name]={...(fixtureModel.collectionSettings[before]||{}),active:body.p_active,sort:body.p_sort,...(body.p_product_ids?{productIds:body.p_product_ids}:{})};if(before!==name)delete fixtureModel.collectionSettings[before];return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_storefront')){fixtureModel.storefront=body.p_storefront;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/store_visit_statistics')){
  const start=body.p_start,end=body.p_end,enabled=${process.env.QA_LIVE_HISTORY==='1'},parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),today=['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
  const aggregate=(first,last)=>{const count=Math.round((Date.parse(last+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000)+1,people=new Set();let visits=0;const daily=Array.from({length:Math.min(90,Math.max(1,count))},(_,i)=>{const ms=Date.parse(first+'T12:00:00Z')+i*86400000,day=new Date(ms).toISOString().slice(0,10),index=Math.floor(ms/86400000),available=day>='2026-10-01',v=enabled&&available?day===today?148:95+index%67:0,u=v?day===today?91:57+index%39:0;visits+=v;for(let n=0;n<u;n++)people.add((index*27+n)%450);return{day,visits:v,visitors:u,available}});return{visits,visitors:people.size,daily}};
  const week=new Date(Date.parse(today+'T12:00:00Z')-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7)*86400000).toISOString().slice(0,10),selected=aggregate(start,end);
  return reply({start,end,...selected,overview:[['today',today],['week',week],['month',today.slice(0,8)+'01']].map(([key,first])=>({key,...aggregate(first,today)})),historyStartedAt:'2026-10-01T12:00:00Z',retentionDays:90,timeZone:'America/Sao_Paulo',observedAt:new Date().toISOString()});
 }
 if(url.includes('/rpc/store_live_snapshot'))return reply({observedAt:new Date().toISOString(),active:0,sessions:0,activeCarts:0,checkout:0,productViews:0,ordersToday:0,revenueToday:0,locations:[]});
 if(url.includes('/rpc/manage_store_theme')){
  const themes=fixtureModel.storeThemes,theme=themes.find(t=>t.id===body.p_id);let id=body.p_id;
  if(['create','duplicate'].includes(body.p_action)){id=crypto.randomUUID();themes.push({id,name:body.p_name,config:structuredClone(body.p_config||theme?.config||fixtureModel.storefront),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}
  else if(!theme)return reply({message:'Tema não encontrado.'},400);
  else if(body.p_action==='save'){if(JSON.stringify(theme.config)!==JSON.stringify(body.p_expected))return reply({message:'O tema mudou em outra sessão.'},409);theme.config=body.p_config;theme.updatedAt=new Date().toISOString();if(id===fixtureModel.activeThemeId)fixtureModel.storefront=structuredClone(theme.config);}
  else if(body.p_action==='rename')theme.name=body.p_name;
  else if(body.p_action==='publish'){fixtureModel.activeThemeId=id;fixtureModel.storefront=structuredClone(theme.config);}
  else if(body.p_action==='delete'){if(id===fixtureModel.activeThemeId)return reply({message:'Publique outro tema antes de excluir.'},400);fixtureModel.storeThemes=themes.filter(t=>t.id!==id);}
  return reply({id,version:++fixtureVersion,active:id===fixtureModel.activeThemeId});
 }
 if(url.includes('/rpc/save_navigation')){fixtureModel.navigation=body.p_navigation;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_shipping_settings')){fixtureModel.settings.shippingOptions=body.p_options;fixtureModel.settings.shippingMode='regional';return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_site_section')){if(body.p_section==='store')Object.assign(fixtureModel.settings,body.p_value);else if(body.p_section==='paymentMethods')fixtureModel.settings.paymentMethods=body.p_value;else if(body.p_section==='pages')fixtureModel.pages=body.p_value;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/list_change_history'))return reply({entries:fixtureHistory.filter(row=>(!body.p_area||row.areas.includes(body.p_area))&&(!body.p_query||(row.actor_name+' '+row.summary).toLocaleLowerCase('pt-BR').includes(body.p_query.toLocaleLowerCase('pt-BR')))).map(({changes,...row})=>row),next_cursor:null});
 if(url.includes('/rpc/change_history_detail'))return reply({...fixtureHistory.find(h=>h.id===body.p_id),can_revert:!fixtureHistory.find(h=>h.id===body.p_id).reverted_at});
 if(url.includes('/rpc/revert_change_history')){const row=fixtureHistory.find(h=>h.id===body.p_id);for(const c of row.changes)fixtureModel.settings.shippingOptions=fixtureModel.settings.shippingOptions.map(o=>o.id===c.entityId?c.before:o);row.reverted_at=new Date().toISOString();row.reverted_by_name='Grupo Outlet';return reply({id:body.p_id,reversal_id:9002});}
 return reply({message:'Esta é uma prévia isolada; nenhuma alteração será enviada à loja.'},400);
};</script>`;
const mobileWidth=[320,360,390,430].includes(Number(process.env.QA_MOBILE_WIDTH))?Number(process.env.QA_MOBILE_WIDTH):390;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head>'+preload).replace("previewSize==='mobile'?390:1280","previewSize==='mobile'?"+mobileWidth+":1280");
const server=http.createServer((req,res)=>{
 if(req.method!=='GET')return res.writeHead(405).end();
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
 if(req.url.startsWith('/__qa/mobile')||req.url.startsWith('/__qa/viewport')){
  const wide=req.url.startsWith('/__qa/viewport'),params=new URL(req.url,'http://localhost').searchParams,requested=params.get('route')||'/app';const route=/^\/(?:app|loja|imprimir)(?:\/[a-z0-9-]+)*$/.test(requested)?requested:'/app',width=[320,360,390,430,...(wide?[1024,1440,1920]:[])].includes(Number(params.get('width')))?Number(params.get('width')):390;
  return res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#e7e9e8;display:flex;justify-content:center;'+(wide?'width:'+width+'px':'')+'}iframe{width:'+width+'px;height:100dvh;border:0;background:#fff;max-width:'+(wide?'none':'100%')+';flex-shrink:0}</style><iframe title="Prévia de '+(wide?'desktop':'celular')+'" src="/#'+route+'"></iframe>');
 }
 const paper=new URL(req.url,'http://localhost').searchParams.get('paper')==='1';
 const paperStyle=paper?'<style>'+fs.readFileSync(path.join(root,'receipts.css'),'utf8').replaceAll('@media print','@media all')+'#app{width:186mm;margin:20px auto}.print-actions{display:none!important}.receipt.order-sheet{max-width:none}</style>':'';
 res.end(paper?html.replace('</head>',paperStyle+'</head>'):html);
});
server.listen(0,'127.0.0.1',()=>console.log('Menu and collection QA: http://127.0.0.1:'+server.address().port+'/#/app/menus'));
