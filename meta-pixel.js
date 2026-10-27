// Marketing is independent of anonymous audience measurement. No staff or previews.
const metaPixelId='2999298787072098',metaConsentKey='forte-meta-consent-v1',metaOrdersKey='forte-meta-orders-v1';
let metaLastRoute='',metaInitialized=false,metaAllowed=false,metaCheckoutId='',metaPaymentSelection='';
// Keep an incoming click in memory across the SPA redirect. Persist it only after opt-in.
const metaLandingClick=new URLSearchParams(location.search).get('fbclid'),metaLandingTime=Date.now();
const metaSent=new Set();
function metaEligible(){return typeof audienceEligible==='function'&&audienceEligible();}
function metaHasConsent(){return localStore.getItem(metaConsentKey)==='yes';}
function metaCookie(name){return document.cookie.split('; ').find(row=>row.startsWith(name+'='))?.slice(name.length+1)||'';}
function metaBootstrap(){
 if(metaInitialized)return;metaInitialized=true;
 if(!window.fbq){const n=window.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments);};window._fbq=n;n.push=n;n.loaded=true;n.version='2.0';n.queue=[];}
 if(!document.querySelector('#forte-meta-pixel')){const s=document.createElement('script');s.id='forte-meta-pixel';s.async=true;s.src='https://connect.facebook.net/en_US/fbevents.js';s.onerror=()=>{s.remove();metaInitialized=false;};document.head.append(s);}
 // Explicit events only: automatic button/form discovery is disabled.
 window.fbq('consent','grant');window.fbq('set','autoConfig',false,metaPixelId);window.fbq('init',metaPixelId);
}
function metaEvent(name,data={},eventId=crypto.randomUUID(),custom=false){
 if(!metaEligible()||!metaHasConsent()||metaSent.has(eventId))return false;
 try{metaBootstrap();window.fbq(custom?'trackSingleCustom':'trackSingle',metaPixelId,name,data,{eventID:eventId});metaSent.add(eventId);if(metaSent.size>500)metaSent.delete(metaSent.values().next().value);return true;}catch{return false;}
}
function metaCartData(lines=db.cart){const contents=lines.map(item=>{const p=db.products.find(p=>p.id===item.id);return p?{id:String(p.id),quantity:item.qty,item_price:Number(salePrice(p))}:null;}).filter(Boolean);return {content_type:'product',content_ids:contents.map(i=>i.id),contents,num_items:contents.reduce((n,i)=>n+i.quantity,0),currency:'BRL',value:Math.round(contents.reduce((n,i)=>n+i.quantity*i.item_price,0)*100)/100};}
function metaCheckoutContext(){
 if(!metaEligible()||!metaHasConsent())return null;
 metaCheckoutId=crypto.randomUUID();
 const fbc=metaCookie('_fbc'),fbp=metaCookie('_fbp'),click=new URLSearchParams(location.search).get('fbclid')||metaLandingClick;
 return {id:metaCheckoutId,consent:true,consentVersion:'meta-2026-10',fbp:/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(fbp)?fbp:'',
 fbc:/^fb\.\d+\.\d+\.[A-Za-z0-9_.-]+$/.test(fbc)?fbc:click&&/^[A-Za-z0-9_.-]{10,500}$/.test(click)?'fb.1.'+metaLandingTime+'.'+click:'',userAgent:navigator.userAgent.slice(0,500)};
}
function metaOrderPlaced(order,context){
 if(!context?.consent)return;
 if(order.paymentMethodId)metaPaymentInfo(order.paymentMethodId,order.installments,Number(order.total));
 const ids=safeJson(localStore.getItem(metaOrdersKey),[]);localStore.setItem(metaOrdersKey,JSON.stringify([...new Set([...ids,context.id])].slice(-50)));
 const contents=(order.items||[]).map(i=>({id:String(i.id),quantity:Number(i.qty),item_price:Number(i.price)}));
 metaEvent('OrderPending',{content_type:'product',content_ids:contents.map(i=>i.id),contents,num_items:contents.reduce((n,i)=>n+i.quantity,0),currency:'BRL',value:Number(order.total),order_id:String(order.id),payment_status:'pending'},'fo:'+context.id+':OrderPending',true);
}
function metaPaymentInfo(method,installments=1,total){const data=metaCartData(),selection=JSON.stringify([method,Number(installments)||1,data.contents]);if(selection===metaPaymentSelection)return;if(metaEvent('AddPaymentInfo',{...data,...(Number.isFinite(total)?{value:total}:{}),payment_method:String(method),installments:Number(installments)||1}))metaPaymentSelection=selection;}
function metaRevoke(){
 metaAllowed=false;metaLastRoute='';metaSent.clear();if(window.fbq)window.fbq('consent','revoke');
 for(const name of ['_fbp','_fbc'])for(const domain of ['',location.hostname,'.'+location.hostname,'.forteoutlet.com.br'])document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax; Secure'+(domain?'; Domain='+domain:'');
 const ids=safeJson(localStore.getItem(metaOrdersKey),[]);if(ids.length)backendRequest('/rest/v1/rpc/revoke_meta_marketing',{method:'POST',body:JSON.stringify({p_ids:ids})}).then(()=>localStore.removeItem(metaOrdersKey)).catch(()=>{});
}
function syncMetaPixel(){
 const eligible=metaEligible()&&metaHasConsent();if(!eligible){if(metaAllowed&&window.fbq)window.fbq('consent','revoke');metaAllowed=false;metaLastRoute='';return;}if(!metaAllowed&&window.fbq)window.fbq('consent','grant');metaAllowed=true;
 const route=routePath();if(route===metaLastRoute)return;metaLastRoute=route;
 metaEvent('PageView');const parts=route.split('?')[0].split('/');
 if(parts[2]==='produto'){const p=db.products.find(p=>p.active&&p.id===Number(parts[3]));if(p)metaEvent('ViewContent',{content_type:'product',content_ids:[String(p.id)],content_name:p.name,currency:'BRL',value:Number(salePrice(p))});}
 if(parts[2]==='checkout'&&db.cart.length){metaPaymentSelection='';metaEvent('InitiateCheckout',metaCartData());}
 if(parts[2]==='catalogo'&&typeof catalogQuery==='string'&&catalogQuery.trim())metaEvent('Search',{search_string:catalogQuery.trim().slice(0,100)});
}
const renderBeforeMeta=render;render=()=>{const result=renderBeforeMeta();syncMetaPixel();return result;};
const addToCartBeforeMeta=addToCart;addToCart=(id,qty=1,choices={})=>{const before=cartQuantity(id),result=addToCartBeforeMeta(id,qty,choices);if(cartQuantity(id)>before)metaEvent('AddToCart',metaCartData([{id,qty:cartQuantity(id)-before}]));return result;};
document.addEventListener('change',event=>{if(routePath().split('?')[0]!=='/loja/checkout'||!['paymentMethodId','installments'].includes(event.target?.name))return;metaPaymentInfo(event.target.form?.elements.namedItem('paymentMethodId')?.value||'',event.target.form?.elements.namedItem('installments')?.value||1);});
document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(!link)return;try{const url=new URL(link.href,location.href);if(['wa.me','api.whatsapp.com'].includes(url.hostname))metaEvent('Contact',{contact_method:'whatsapp'});}catch{}});
const audienceConsentBeforeMeta=setAudienceConsent;
setAudienceConsent=value=>{if(!value){localStore.setItem(metaConsentKey,'no');metaRevoke();}audienceConsentBeforeMeta(value);syncMetaPixel();};
function allowAllStoreCookies(){localStore.setItem(metaConsentKey,'yes');audienceConsentBeforeMeta(true);syncMetaPixel();}
audienceChoices=()=>'<div class="audience-actions"><button onclick="setAudienceConsent(false)">Só necessários</button><button onclick="audiencePreferences()">Personalizar</button><button onclick="allowAllStoreCookies()">Permitir todos</button></div>';
audiencePreferences=()=>{modal('Preferências de privacidade','<div class="audience-preferences"><p>Os recursos necessários mantêm sua conta e seu carrinho funcionando.</p><form onsubmit="event.preventDefault();saveStorePrivacy(this)"><label style="display:flex;gap:12px;align-items:start;margin:20px 0"><input type="checkbox" name="audience" '+(localStore.getItem(liveConsentKey)==='yes'?'checked':'')+'><span><strong>Medição de visitas</strong><br>Identificadores aleatórios do navegador e da sessão distinguem visitas e visitantes por até 90 dias, sem vínculo com cadastro ou pedido. Cidade aproximada e etapa ao vivo expiram após 30 minutos sem atividade. Revogar solicita a exclusão do histórico deste navegador.</span></label><label style="display:flex;gap:12px;align-items:start;margin:20px 0"><input type="checkbox" name="marketing" '+(metaHasConsent()?'checked':'')+'><span><strong>Publicidade e conversões da Meta</strong><br>Permite o Pixel e a API de Conversões para medir produtos, carrinho, checkout, pedidos e pagamentos. A Meta recebe identificadores de anúncios e, nos pedidos, e-mail e telefone protegidos por hash SHA-256. Não enviamos CPF, endereço completo, comprovantes nem dados do cartão. Identificadores de pedido são mantidos por até 90 dias.</span></label><p>Você pode recusar ou revogar sem afetar sua compra. Eventos já enviados seguem a política da Meta. Sinais de não rastrear e de privacidade global são respeitados.</p><button class="btn primary" type="submit">Salvar preferências</button></form></div>');document.querySelector('#modal').dataset.audience='1';};
function saveStorePrivacy(form){const marketing=form.elements.namedItem('marketing').checked;localStore.setItem(metaConsentKey,marketing?'yes':'no');if(!marketing)metaRevoke();audienceConsentBeforeMeta(form.elements.namedItem('audience').checked);syncMetaPixel();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncMetaPixel();});
window.addEventListener('storage',event=>{if([metaConsentKey,liveConsentKey].includes(event.key)){if(!metaHasConsent())metaRevoke();syncMetaPixel();}});
