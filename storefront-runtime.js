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
    root.querySelectorAll('.detail-main-photo').forEach(image=>image.style.objectFit=cfg.galleryFit==='cover'?'cover':'contain');
    if(typeof cfg.note==='string'&&cfg.note.trim()&&copy){const note=document.createElement('p');note.className='store-product-note';note.textContent=cfg.note;copy.querySelector('.store-product-note')?.remove();copy.querySelector('.product-price-block')?.insertAdjacentElement('afterend',note)}
  }
  if(key==='collection'){
    root.classList.toggle('content-align-center',cfg.contentAlign==='center');
    if([2,3,4].includes(Number(cfg.columns))){const grid=root.querySelector('.catalog');if(grid){grid.classList.add('store-custom-grid');grid.style.setProperty('--store-columns',Number(cfg.columns))}}
  }
}
// Buffered copies keep native touch scrolling continuous in either direction.
const carouselModulo=(value,count)=>count>0?((value%count)+count)%count:0;
function createInfiniteRail(rail,items){
  if(items.length<2||!rail.insertBefore||!items[0]?.cloneNode)return null;
  rail._carouselLoop?.destroy();
  const copies=[];let origin=0,period=0,offsets=[],settleTimer=null,frame=null,disposed=false,jumping=false;
  const clone=item=>{
    const copy=item.cloneNode(true);copy.setAttribute('data-loop-copy','');copy.setAttribute('aria-hidden','true');copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    copy.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(node=>node.setAttribute('tabindex','-1'));
    if(copy.matches('a,button,input,select,textarea,[tabindex]'))copy.setAttribute('tabindex','-1');
    copy.querySelectorAll('img').forEach(image=>image.loading='lazy');copies.push(copy);return copy;
  };
  items.forEach((item,index)=>item.setAttribute('data-loop-index',String(index)));
  for(let repeat=0;repeat<2;repeat++)for(const item of items)rail.insertBefore(clone(item),items[0]);
  const after=[];for(let repeat=0;repeat<2;repeat++)for(const item of items){const copy=clone(item);rail.appendChild(copy);after.push(copy)}
  const requestFrame=callback=>typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,0);
  const jump=left=>{
    if(disposed||Math.abs(rail.scrollLeft-left)<.5)return;
    const delta=left-rail.scrollLeft;jumping=true;rail.classList.add('is-recentering');rail.scrollTo({left,behavior:'instant'});jumping=false;
    controller.onShift?.(delta);
    if(frame!==null){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);else clearTimeout(frame)}
    frame=requestFrame(()=>{frame=null;rail.classList.remove('is-recentering')});
  };
  const controller={
    count:items.length,onShift:null,
    get step(){return period/items.length||rail.clientWidth},
    index(){return carouselModulo(Math.round((rail.scrollLeft-origin)/(period/items.length||1)),items.length)},
    measure(index=this.index()){
      if(disposed||!rail.clientWidth)return;
      const first=rail.firstElementChild.getBoundingClientRect().left,base=items[0].getBoundingClientRect().left;
      origin=base-first;period=after[0].getBoundingClientRect().left-base;
      offsets=items.map(item=>item.getBoundingClientRect().left-base);
      if(period>0)jump(origin+offsets[carouselModulo(index,items.length)]);
    },
    go(index,behavior='smooth'){
      if(disposed||!Number.isInteger(index)||!period)return;
      const canonical=origin+offsets[carouselModulo(index,items.length)];
      const nearest=canonical+Math.round((rail.scrollLeft-canonical)/period)*period;
      rail.scrollTo({left:Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,nearest)),behavior});
    },
    normalize(){if(!disposed&&period>0)jump(origin+carouselModulo(rail.scrollLeft-origin,period))},
    elements:()=>[...items,...copies],
    destroy(){
      if(disposed)return;disposed=true;clearTimeout(settleTimer);
      if(frame!==null){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);else clearTimeout(frame)}
      rail.removeEventListener('scroll',scroll);rail.removeEventListener('scrollend',settled);
      copies.forEach(copy=>copy.remove());items.forEach(item=>item.removeAttribute('data-loop-index'));
      rail.classList.remove('is-recentering');delete rail._carouselLoop;
    }
  };
  const settled=()=>{clearTimeout(settleTimer);controller.normalize()};
  const scroll=()=>{
    if(jumping||disposed||!period)return;
    // Keep a full spare cycle in reserve even during a long drag or fast flick.
    if(rail.scrollLeft<period*.5||rail.scrollLeft>origin+period*1.5)controller.normalize();
    clearTimeout(settleTimer);settleTimer=setTimeout(settled,140);
  };
  rail._carouselLoop=controller;rail.addEventListener('scroll',scroll,{passive:true});rail.addEventListener('scrollend',settled);
  controller.measure(0);return controller;
}
// Native touch gestures are preserved; mouse dragging uses the same loop positions.
function bindGalleryDrag(rail,snap=false,loop=null){
  let start=null,dragged=false;
  if(loop)loop.onShift=delta=>{if(start)start.left+=delta};
  const down=event=>{start=null;dragged=false;if(event.pointerType==='mouse'&&event.button===0)start={x:event.clientX,left:rail.scrollLeft}};
  const move=event=>{
    if(!start)return;if(!(event.buttons&1))return end(event);
    const delta=event.clientX-start.x;if(!dragged&&Math.abs(delta)<5)return;
    if(!dragged){dragged=true;rail.setPointerCapture(event.pointerId);rail.classList.add('is-dragging')}
    event.preventDefault();rail.scrollLeft=Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,start.left-delta));
  };
  const end=event=>{
    const initial=start;start=null;rail.classList.remove('is-dragging');
    if(rail.hasPointerCapture(event.pointerId))rail.releasePointerCapture(event.pointerId);
    if(snap&&dragged&&initial&&rail.clientWidth){
      const delta=rail.scrollLeft-initial.left,width=loop?.step||rail.clientWidth;
      const index=Math.round(initial.left/width)+(Math.abs(delta)>Math.min(80,width*.2)?Math.sign(delta):0);
      rail.scrollTo({left:Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,index*width)),behavior:'smooth'});
    }
  };
  const click=event=>{if(dragged){event.preventDefault();event.stopImmediatePropagation();dragged=false}};
  const preventDrag=event=>event.preventDefault();
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',end],['pointercancel',end],['click',click,true],['dragstart',preventDrag]];
  for(const [name,fn,capture]of listeners)rail.addEventListener(name,fn,capture);
  return ()=>{if(loop)loop.onShift=null;for(const [name,fn,capture]of listeners)rail.removeEventListener(name,fn,capture)};
}
let productGalleryCleanup=()=>{},collectionCarouselsCleanup=()=>{};
function setupProductGallery(){
  productGalleryCleanup();productGalleryCleanup=()=>{};
  const main=document.querySelector('.product-photo-rail');if(!main)return;
  const rail=document.querySelector('.detail-thumbs'),slides=[...main.querySelectorAll('.product-photo-slide')],buttons=rail?[...rail.querySelectorAll('button')]:[];
  const loop=createInfiniteRail(main,slides),thumbLoop=rail&&rail.scrollWidth>rail.clientWidth+1?createInfiniteRail(rail,buttons):null;
  const counter=document.querySelector('.product-photo-counter');let active=-1;
  const updateThumbEdges=()=>{if(!rail)return;rail.classList.toggle('has-more-before',rail.scrollLeft>2);rail.classList.toggle('has-more-after',rail.scrollLeft+rail.clientWidth<rail.scrollWidth-2)};
  const update=()=>{
    const index=loop?loop.index():Math.max(0,Math.min(slides.length-1,Math.round(main.scrollLeft/(main.clientWidth||1))));if(index===active)return;active=index;
    if(counter)counter.textContent=(index+1)+' / '+slides.length;
    (thumbLoop?thumbLoop.elements():buttons).forEach((button,i)=>{const selected=thumbLoop?Number(button.getAttribute('data-loop-index'))===index:i===index;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected))});
    if(thumbLoop){thumbLoop.go(index);return;}
    const selected=buttons[index];if(rail&&selected){
      const box=selected.getBoundingClientRect(),viewport=rail.getBoundingClientRect();
      if(box.left<viewport.left)rail.scrollTo({left:rail.scrollLeft+box.left-viewport.left,behavior:'smooth'});
      else if(box.right>viewport.right)rail.scrollTo({left:rail.scrollLeft+box.right-viewport.right,behavior:'smooth'});
    }
  };
  const key=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();selectProductPhoto(event.key==='Home'?0:event.key==='End'?slides.length-1:loop?carouselModulo(active+(event.key==='ArrowRight'?1:-1),slides.length):Math.max(0,Math.min(slides.length-1,active+(event.key==='ArrowRight'?1:-1))))};
  const resize=()=>{if(loop)loop.measure(Math.max(0,active));else main.scrollTo({left:Math.max(0,active)*main.clientWidth,behavior:'instant'});thumbLoop?.measure();updateThumbEdges()};
  const cleanupMain=bindGalleryDrag(main,true,loop),cleanupThumbs=rail?bindGalleryDrag(rail,false,thumbLoop):()=>{};
  main.addEventListener('scroll',update,{passive:true});main.addEventListener('keydown',key);rail?.addEventListener('scroll',updateThumbEdges,{passive:true});
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;
  if(observer)observer.observe(main);else window.addEventListener('resize',resize);
  update();updateThumbEdges();
  productGalleryCleanup=()=>{observer?.disconnect();if(!observer)window.removeEventListener('resize',resize);cleanupMain();cleanupThumbs();main.removeEventListener('scroll',update);main.removeEventListener('keydown',key);rail?.removeEventListener('scroll',updateThumbEdges);loop?.destroy();thumbLoop?.destroy()};
}
function setupCollectionCarousels(){
  collectionCarouselsCleanup();const cleanups=[];
  document.querySelectorAll('.collection-list-grid.is-mobile-carousel').forEach(rail=>{
    const items=[...rail.children];let loop=null,dragCleanup=()=>{};
    const resize=()=>{
      const mobile=window.matchMedia('(max-width:650px)').matches;
      if(mobile&&(loop||rail.scrollWidth>rail.clientWidth+1)&&items.length>1){if(loop)loop.measure();else{loop=createInfiniteRail(rail,items);dragCleanup=bindGalleryDrag(rail,false,loop)}}
      else if(loop){dragCleanup();loop.destroy();loop=null;rail.scrollLeft=0}
    };
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;
    if(observer)observer.observe(rail);window.addEventListener('resize',resize);resize();
    cleanups.push(()=>{observer?.disconnect();window.removeEventListener('resize',resize);dragCleanup();loop?.destroy()});
  });
  collectionCarouselsCleanup=()=>cleanups.forEach(cleanup=>cleanup());
}
const authPageBeforeStoreRuntime=authPage;
authPage=(mode='login')=>{storeAuthView=mode==='signup'?'signup':'login';authPageBeforeStoreRuntime(mode);applyStorePageSettings();setupProductGallery();setupCollectionCarousels();notifyStorePreviewRoute()};
const renderBeforeStoreRuntime=render;
render=()=>{
  const path=routePath();storeAuthView='';
  if(booted&&!bootError&&(path==='/loja/cadastro'||path==='/loja/login'))return authPage(path==='/loja/cadastro'?'signup':'login');
  const result=renderBeforeStoreRuntime();applyStorePageSettings();setupProductGallery();setupCollectionCarousels();
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
