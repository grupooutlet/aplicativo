// The published store and the editor frame share these exact renderers and styles.
const storePreviewParams=new URLSearchParams(location.search);
const isStorePreview=storePreviewParams.get('storePreview')==='1'&&window.parent!==window;
let storeAuthView='',storeMenuFocus=null;
const storeHeaderBeforeNavigation=storeHeader;
storeHeader=()=>{
  const links=storeCollectionLinks();
  return storeHeaderBeforeNavigation().replace('<header class="store-header">','<header class="store-header"><button class="store-menu-button" type="button" aria-label="Abrir menu da loja" aria-controls="store-menu-dialog" aria-expanded="false" onclick="openStoreMenu(this)">'+icon('menu')+'</button>')+
    `<dialog id="store-menu-dialog" class="store-mobile-menu"><div class="store-menu-head"><strong>Menu da loja</strong><button type="button" aria-label="Fechar menu da loja" onclick="closeStoreMenu()">×</button></div><nav aria-label="Coleções">${links}</nav><div class="store-menu-account">${authSession?'<a href="/loja/conta">Minha conta e meus pedidos</a>':'<a href="/loja/login">Fazer login</a><a href="/loja/cadastro">Criar conta</a>'}<a href="/loja/carrinho">Meu carrinho</a></div></dialog>`;
};
function openStoreMenu(button){const menu=$('#store-menu-dialog');if(!menu)return;storeMenuFocus=button;button.setAttribute('aria-expanded','true');menu.showModal();menu.querySelector('a')?.focus()}
function closeStoreMenu(){const menu=$('#store-menu-dialog');if(menu?.open)menu.close();storeMenuFocus?.setAttribute('aria-expanded','false');storeMenuFocus?.focus();storeMenuFocus=null}
document.addEventListener('click',event=>{if(event.target.closest('#store-menu-dialog a'))closeStoreMenu();if(event.target.id==='store-menu-dialog'){const bounds=event.target.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)closeStoreMenu()}});
document.addEventListener('cancel',event=>{if(event.target.id==='store-menu-dialog'){event.preventDefault();closeStoreMenu()}},true);

function applyStorePageSettings(){
  if(!routePath().startsWith('/loja'))return;
  const key=storefront.pageKey(routePath(),catalogCategory,storeAuthView);
  const cfg=db.storefront?.pageSettings?.[key];if(!cfg)return;
  const root=document.querySelector('.store-content')||document.querySelector('.auth-card');if(!root)return;
  if(typeof cfg.title==='string'&&cfg.title.trim()&&key!=='product'){const h=root.querySelector('h1');if(h)h.textContent=cfg.title}
  if(typeof cfg.intro==='string'&&cfg.intro.trim()){
    const heading=root.querySelector('.heading>div'),auth=root.classList.contains('auth-card');
    let node=heading?.querySelector('p')||(auth?root.querySelector('p'):null);
    if(!node){node=document.createElement('p');node.className='store-page-intro';(heading||root).insertBefore(node,(heading||root).querySelector('h1')?.nextSibling||null)}
    node.textContent=cfg.intro;
  }
  if(key==='product'){
    const copy=root.querySelector('.product-summary');
    if(cfg.showDescription===false)root.querySelector('.product-description')?.setAttribute('hidden','');
    const image=root.querySelector('#main-product-photo');if(image)image.style.objectFit=cfg.galleryFit==='cover'?'cover':'contain';
    if(typeof cfg.note==='string'&&cfg.note.trim()&&copy){const note=document.createElement('p');note.className='store-product-note';note.textContent=cfg.note;copy.querySelector('.store-product-note')?.remove();copy.querySelector('.product-price-block')?.insertAdjacentElement('afterend',note)}
  }
  if(key==='collection'){
    if(cfg.showFilters===false)root.querySelector('.toolbar')?.setAttribute('hidden','');
    if([2,3,4].includes(Number(cfg.columns))){const grid=root.querySelector('.catalog');if(grid){grid.classList.add('store-custom-grid');grid.style.setProperty('--store-columns',Number(cfg.columns))}}
  }
}
const authPageBeforeStoreRuntime=authPage;
authPage=(mode='login')=>{storeAuthView=mode==='signup'?'signup':'login';authPageBeforeStoreRuntime(mode);applyStorePageSettings();notifyStorePreviewRoute()};
const renderBeforeStoreRuntime=render;
render=()=>{
  const path=routePath();storeAuthView='';
  if(booted&&!bootError&&(path==='/loja/cadastro'||path==='/loja/login'))return authPage(path==='/loja/cadastro'?'signup':'login');
  const result=renderBeforeStoreRuntime();applyStorePageSettings();
  if(path.startsWith('/app/store-editor'))storefront.mountPreview();
  notifyStorePreviewRoute();return result;
};
function notifyStorePreviewRoute(){if(!isStorePreview)return;window.parent.postMessage({type:'storefront:route',channel:storePreviewParams.get('channel'),route:routePath(),category:catalogCategory,view:storeAuthView},location.origin)}

if(isStorePreview){
  // No tokens, real cart storage, accounts or database writes are used by the frame.
  for(const storage of [localStore,sessionStore]){const memory=new Map();storage.getItem=key=>memory.get(key)||null;storage.setItem=(key,value)=>memory.set(key,String(value));storage.removeItem=key=>memory.delete(key)}
  save=()=>true;
  backendRequest=async()=>{throw new Error('Esta ação está disponível na loja publicada.')};
  checkoutContact=()=>null;
  const previewGoBefore=go;
  go=path=>{if(!/^\/loja(?:\/|$)/.test(path))return toast('Abra o painel ou os links externos fora da prévia.');closeStoreMenu();previewGoBefore(path)};
  document.addEventListener('click',event=>{
    const link=event.target.closest('a');if(!link)return;
    const href=link.dataset.route||link.getAttribute('href')||'';
    if(/^https?:\/\//i.test(href)&&!href.startsWith(location.origin+basePath)){event.preventDefault();event.stopImmediatePropagation();toast('Este link abre na loja publicada.');return}
    if(link.target==='_blank'){event.preventDefault();event.stopImmediatePropagation();const path=link.dataset.route||new URL(link.href).hash.slice(1);if(path.startsWith('/loja'))go(path)}
  },true);
  function previewSignIn(form,signup=false){
    const data=Object.fromEntries(new FormData(form));
    if(signup&&data.password!==data.passwordConfirm)return toast('As senhas não coincidem.');
    if(signup&&!normalizeRegistrationPhone(data.phone))return toast('Informe um telefone brasileiro com DDD válido.');
    currentProfile={name:signup?String(data.name||'Cliente da prévia'):'Cliente da prévia',role:'customer',email:data.email,phone:signup?normalizeRegistrationPhone(data.phone):'',user_id:'preview-customer'};
    authSession={user:{id:'preview-customer',email:data.email}};sessionStore.setItem('forte-customer',data.email);go('/loja/conta');toast('Acesso simulado na prévia.');
  }
  signInAccount=form=>previewSignIn(form);
  registerAccount=form=>previewSignIn(form,true);
  signOut=async()=>{authSession=null;currentProfile=null;sessionStore.removeItem('forte-customer');go('/loja/conta')};
  checkout=async form=>{
    const fields=Object.fromEntries(new FormData(form));
    if(!validPersonName(fields.firstName)||!validPersonName(fields.lastName))return toast('Confira o nome e o sobrenome.');
    if(String(fields.cpf||'').replace(/\D/g,'').length!==11)return toast('Informe um CPF com 11 números.');
    if(!/^55\d{10,11}$/.test(brazilPhoneDigits(fields.phone)))return toast('Confira o WhatsApp com DDD.');
    if(!db.cart.length)return toast('Seu carrinho está vazio.');
    const shipping=formShippingOption(form);if(!shipping)return toast('Selecione uma opção de frete.');
    if(!checkShippingRestriction(form,shipping))return;
    try{
      updateCheckoutProductOptions();
      const items=db.cart.map(line=>{const product=db.products.find(p=>p.id===line.id&&p.active);if(!product||cartQuantity(line.id)>available(line.id))throw new Error('Revise o estoque do carrinho.');const options=validateProductOptions(product,line.options||{});return {id:product.id,name:product.name+(optionText(options)?' · '+optionText(options):''),options,qty:line.qty,price:salePrice(product)}});
      items.push(...orderBumpPreviewItems());const quote=paymentFromFields(fields,cartTotal()+orderBumpTotal()+Number(shipping.price));
      if(!authSession){authSession={user:{id:'preview-customer',email:fields.email}};currentProfile={user_id:'preview-customer',name:fields.firstName+' '+fields.lastName,email:fields.email,role:'customer'}}
      const id=Math.max(900000,...db.orders.map(o=>Number(o.id)))+1;
      const order={id,createdAt:new Date().toISOString(),date:localToday(),firstName:fields.firstName,lastName:fields.lastName,customer:fields.firstName+' '+fields.lastName,email:fields.email,phone:fields.phone,cpf:fields.cpf,delivery:fields.delivery,address:fields.delivery==='Retirada'?db.settings.address:`${fields.street}, ${fields.number} · ${fields.neighborhood} · ${fields.city} · CEP ${fields.cep}`,paymentTiming:fields.paymentTiming,items,freight:Number(shipping.price),freightPending:false,shippingOptionName:shipping.name,status:'pending',paid:false,user_id:authSession.user.id,...quote};
      db.orders.unshift(order);db.cart=[];sessionStore.setItem('forte-customer',fields.email);sessionStore.setItem('forte-guest-orders',JSON.stringify([id]));go('/loja/pedido/'+id);toast('Pedido simulado. Nenhum pedido foi enviado à loja.');
    }catch(error){toast(error.message)}
  };
  let previewInitialized=false,previewIdentity='';
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='storefront:model'||event.data.channel!==storePreviewParams.get('channel'))return;
    const payload=event.data,model=payload.model;if(!model||!Array.isArray(model.products)||!Array.isArray(model.storefront?.sections))return;
    const cart=previewInitialized?db.cart:[];
    const orders=previewInitialized?db.orders:model.orders||[];
    db={...defaults(),...model,orders,cart};isOwner=false;role='Cliente';booted=true;bootError='';
    const identity=JSON.stringify(payload.identity);
    if(!previewInitialized||previewIdentity!==identity){authSession=payload.identity?{user:{id:payload.identity.id,email:payload.identity.email}}:null;currentProfile=payload.identity?{name:payload.identity.name,email:payload.identity.email,user_id:payload.identity.id,role:'customer'}:null;previewIdentity=identity}
    previewInitialized=true;
    if(payload.route){catalogCategory=payload.category||'Todos';catalogQuery='';go(payload.route)}else render();
  });
  boot=async()=>{booted=false;$('#app').innerHTML='<main class="boot-fallback"><p>Carregando prévia da loja…</p></main>';window.parent.postMessage({type:'storefront:ready',channel:storePreviewParams.get('channel')},location.origin)};
}
boot();
