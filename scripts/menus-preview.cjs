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
const qaProfile={user_id:'qa-master',name:qaPosition==='Principal'?'Grupo Outlet':'Bianca QA',email:qaPosition==='Principal'?'grupooutlet.rj@gmail.com':'vendedor-qa@example.invalid',role:qaPosition==='Principal'?'master':'admin',position:qaPosition==='Principal'?null:qaPosition};
const qaCustomers=[],qaContacts=[];
if(process.env.QA_CUSTOMERS==='1'){
 qaCustomers.push({user_id:'qa-customer',role:'customer',name:'Marina Oliveira',email:'marina@example.invalid',created_at:'2026-10-19T13:30:00Z'},{user_id:'qa-no-orders',role:'customer',name:'Pedro Santos',email:'pedro@example.invalid',created_at:'2026-10-23T15:15:00Z'});
 qaContacts.push({id:'qa-contact',name:'Marina Oliveira',email:'marina@example.invalid',phone:'21999998888',created_at:'2026-10-19T13:30:00Z',address:'Rua das Flores, 100 · Centro · Nova Iguaçu / RJ · CEP 26000-000'});
 model.orders=[{id:102,user_id:'qa-customer',customer_id:'qa-contact',customer:'Marina Oliveira',email:'marina@example.invalid',phone:'21999998888',status:'transit',createdAt:'2026-10-24T14:30:00Z',channel:'Loja online',seller:'Bianca Melo',payment:'Pix',paid:false,delivery:'Entrega',deliveryDate:'2026-10-26',address:'Rua das Palmeiras, 25 · Centro · Nova Iguaçu / RJ · CEP 26000-010',freight:100,items:[{id:1,name:'Sofá retrátil Grécia · Cor: Bege',qty:1,price:1597,cost:50}]},{id:101,user_id:'qa-customer',customer_id:'qa-contact',customer:'Marina Oliveira',email:'marina@example.invalid',status:'delivered',createdAt:'2026-10-19T13:30:00Z',channel:'Loja física',seller:'Eduardo Thales',payment:'Cartão de débito',paid:true,delivery:'Entrega',address:qaContacts[0].address,freight:100,items:[{id:3,name:'Poltrona de apoio',qty:2,price:497,cost:50}]}];
}
let qaHistory=[];
if(process.env.QA_AUDIT==='1'){
 const freight=model.settings.shippingOptions.find(o=>o.name==='Niterói');const before=structuredClone(freight);freight.price=220;
 qaHistory=[{id:9001,created_at:'2026-10-24T17:45:12Z',actor_name:'Bianca Melo',actor_role:'admin',actor_position:'Vendedor',areas:['shippingOptions'],summary:'Alterou: Niterói',change_count:1,reverted_at:null,changes:[{source:'state',kind:'entity',path:['settings','shippingOptions'],entityId:freight.id,before,beforeExists:true,after:structuredClone(freight),afterExists:true,label:'Niterói'}]}];
}
const preload=`<script>
let fixtureModel=${JSON.stringify(model)},fixtureVersion=1;
let fixtureProfile=${JSON.stringify(qaProfile)},fixtureHistory=${JSON.stringify(qaHistory)},fixtureCustomers=${JSON.stringify(qaCustomers)},fixtureContacts=${JSON.stringify(qaContacts)};
localStorage.setItem('forte-auth-v1',JSON.stringify({user:{id:'qa-master',email:'grupooutlet.rj@gmail.com'},access_token:'qa-local-only',refresh_token:'qa-local-only',expires_at:Math.floor(Date.now()/1000)+86400}));localStorage.setItem('forte-auth-shared-v1','1');
const actualPreviewFetch=window.fetch;window.fetch=async(input,options={})=>{
 const url=String(input);if(!url.includes('rwxqytomiorsrxpgtjin.supabase.co')||(url.includes('/storage/')&&['GET','HEAD'].includes(options.method||'GET')))return actualPreviewFetch(input,options);
 const body=options.body?JSON.parse(options.body):{},reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(url.includes('/rest/v1/shop_public'))return reply([{data:{...fixtureModel,products:fixtureModel.products.map(({cost,...p})=>p)}}]);
 if(url.includes('/rest/v1/profiles'))return reply(url.includes('user_id=eq.')?[fixtureProfile]:[fixtureProfile,...fixtureCustomers]);
 if(url.includes('/rpc/sales_state'))return reply({data:{...fixtureModel,products:fixtureModel.products.map(({cost,...p})=>p),orderBumps:fixtureModel.orderBumps.map(({cost,...b})=>b)},version:fixtureVersion});
 if(url.includes('/rest/v1/customer_contacts'))return reply(fixtureContacts);
 if(url.includes('/rest/v1/app_state'))return reply([{data:fixtureModel,version:fixtureVersion}]);
 if(url.includes('/rpc/save_collection')){const before=body.p_previous,name=body.p_name;if(before){fixtureModel.collections=fixtureModel.collections.map(c=>c===before?name:c);for(const p of fixtureModel.products){p.categories=p.categories.map(c=>c===before?name:c);if(p.category===before)p.category=name;}}else fixtureModel.collections.push(name);fixtureModel.collectionSettings[name]={...(fixtureModel.collectionSettings[before]||{}),active:body.p_active,sort:body.p_sort,...(body.p_product_ids?{productIds:body.p_product_ids}:{})};if(before!==name)delete fixtureModel.collectionSettings[before];return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_storefront')){fixtureModel.storefront=body.p_storefront;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_navigation')){fixtureModel.navigation=body.p_navigation;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_shipping_settings')){fixtureModel.settings.shippingOptions=body.p_options;fixtureModel.settings.shippingMode='regional';return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/save_site_section')){if(body.p_section==='store')Object.assign(fixtureModel.settings,body.p_value);else if(body.p_section==='paymentMethods')fixtureModel.settings.paymentMethods=body.p_value;else if(body.p_section==='pages')fixtureModel.pages=body.p_value;return reply({version:++fixtureVersion});}
 if(url.includes('/rpc/list_change_history'))return reply({entries:fixtureHistory.map(({changes,...row})=>row),next_cursor:null});
 if(url.includes('/rpc/change_history_detail'))return reply({...fixtureHistory.find(h=>h.id===body.p_id),can_revert:!fixtureHistory.find(h=>h.id===body.p_id).reverted_at});
 if(url.includes('/rpc/revert_change_history')){const row=fixtureHistory.find(h=>h.id===body.p_id);for(const c of row.changes)fixtureModel.settings.shippingOptions=fixtureModel.settings.shippingOptions.map(o=>o.id===c.entityId?c.before:o);row.reverted_at=new Date().toISOString();row.reverted_by_name='Grupo Outlet';return reply({id:body.p_id,reversal_id:9002});}
 return reply({message:'Esta é uma prévia isolada; nenhuma alteração será enviada à loja.'},400);
};</script>`;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head>'+preload);
const server=http.createServer((req,res)=>{if(req.method!=='GET')return res.writeHead(405).end();res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
server.listen(0,'127.0.0.1',()=>console.log('Menu and collection QA: http://127.0.0.1:'+server.address().port+'/#/app/menus'));
