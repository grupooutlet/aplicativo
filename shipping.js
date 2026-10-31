// Regional delivery quotes. The database independently checks the same address and price.
function shippingKey(value) {
  const words=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);
  const aliases={jd:'jardim',jard:'jardim',pq:'parque',vl:'vila',sta:'santa',sto:'santo',eng:'engenheiro',conj:'conjunto'};
  return words.map(word=>aliases[word]||word).join(' ');
}
function regionalShippingEnabled(){return db.settings?.shippingMode==='regional';}
function shippingFormAddress(form){
  const value=name=>String(form?.elements.namedItem(name)?.value||'').trim();
  const city=value('city').split(/\s*\/\s*/);
  return {cep:value('cep'),street:value('street'),number:value('number'),neighborhood:value('neighborhood'),city:city[0],state:value('state')||city[1]||'',complement:value('complement')};
}
function regionalShippingMatch(options,address={}){
  const city=shippingKey(address.city),state=shippingKey(address.state),neighborhood=shippingKey(address.neighborhood);
  if(!city||!state||!neighborhood)return null;
  const candidates=options.filter(option=>option.delivery==='Entrega'&&option.region&&shippingKey(option.region.city)===city&&shippingKey(option.region.state)===state);
  // A paused local override must not fall back to a cheaper city-wide rate.
  const exact=candidates.filter(option=>option.region.neighborhoods?.some(name=>shippingKey(name)===neighborhood));
  const matches=exact.length?exact:candidates.filter(option=>!option.region.neighborhoods?.length);
  return matches.length===1&&matches[0].active!==false?matches[0]:null;
}
const shippingOptionsBeforeRegions=shippingOptionsFor;
shippingOptionsFor=(delivery,address)=>{
  if(!regionalShippingEnabled()||delivery!=='Entrega')return shippingOptionsBeforeRegions(delivery);
  const match=regionalShippingMatch(allShippingOptions(),address);
  return match?[match]:[];
};
function shippingSupportUrl(address){
  const phone=String(db.settings.phone||'').replace(/\D/g,'');
  const place=[address.neighborhood,address.city,address.state].filter(Boolean).join(', ');
  const detail=[address.street,address.number,address.cep&&'CEP '+address.cep].filter(Boolean).join(', ');
  return phone?'https://wa.me/'+phone+'?text='+encodeURIComponent('Olá! Gostaria de saber se vocês fazem entrega para '+place+(detail?' ('+detail+')':'')+'. Podem confirmar a disponibilidade e o valor do frete?'):'';
}
function regionalShippingNotice(address){
  if(!address.city||!address.state||!address.neighborhood)return '<div class="regional-shipping-prompt">Preencha o CEP, a cidade e o bairro para consultar o frete.</div>';
  const url=shippingSupportUrl(address);
  return `<div class="regional-shipping-alert" role="status"><strong>Vamos consultar a entrega para sua região</strong><p>Ainda não há frete disponível para ${esc(address.neighborhood)}, ${esc(address.city)} / ${esc(address.state)}. Fale com nossa equipe antes de finalizar com entrega.</p>${url?`<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Consultar entrega pelo WhatsApp</a>`:'<p>Entre em contato com o atendimento da loja para consultar a entrega.</p>'}</div>`;
}
function adminRegionalShippingNotice(address){
  if(!address.city||!address.state||!address.neighborhood)return '<div class="regional-shipping-prompt">Preencha o CEP, a cidade e o bairro para consultar o frete deste pedido.</div>';
  return `<div class="regional-shipping-alert presale-shipping-alert" role="status"><p>Ainda não há frete disponível para <strong>${esc(address.neighborhood)}, ${esc(address.city)} / ${esc(address.state)}</strong>. Configure um frete para essa região em <strong>Entregas → Fretes</strong>.</p><button class="btn small" type="button" onclick="openPresaleFreightSettings()">${icon('external')}Configurar frete</button><small>As configurações abrem em outra aba. Depois de salvar, atualize os fretes deste pedido.</small><button class="text-link" type="button" onclick="reloadPresaleFreight(this)">Atualizar fretes</button></div>`;
}
function openPresaleFreightSettings(){window.open(basePath+'#/app/deliveries?tab=freight','_blank','noopener,noreferrer');}
async function reloadPresaleFreight(button){
  const form=button.closest('form');button.disabled=true;
  try{await settleAdminWrites();await loadAdminState();if(form.isConnected){refreshRegionalShipping(form,true);toast('Fretes atualizados para este endereço.');}}
  catch{toast('Não foi possível atualizar os fretes. Tente novamente.');}
  finally{button.disabled=false;}
}
const shippingChoicesBeforeRegions=shippingChoices;
shippingChoices=(delivery,address)=>{
  if(!regionalShippingEnabled()||delivery!=='Entrega')return shippingChoicesBeforeRegions(delivery);
  address=address||shippingFormAddress(document.querySelector('form:has(#shipping-options)'));
  const option=shippingOptionsFor(delivery,address)[0];
  if(!option)return regionalShippingNotice(address);
  return `<fieldset class="shipping-choices regional-shipping-quote"><legend>Frete para seu endereço</legend><label class="shipping-choice"><input type="radio" name="shippingOptionId" value="${esc(option.id)}" checked required><span><strong>${esc(option.name)}</strong><b>${money(option.price)}</b><small>${esc(address.city)} / ${esc(address.state)}</small></span></label>${option.note?`<p class="regional-shipping-note">${esc(option.note)}</p>`:''}${option.confirmationRequired?'<label class="regional-shipping-confirm"><input type="checkbox" name="shippingRestrictionConfirmed" required value="true">Confirmo que o endereço está dentro da área de entrega indicada acima.</label>':''}</fieldset>`;
};
const formShippingBeforeRegions=formShippingOption;
formShippingOption=form=>{
  if(!regionalShippingEnabled())return formShippingBeforeRegions(form);
  const delivery=form.elements.namedItem('delivery')?.value;
  const selected=form.id==='order-form'?form.elements.namedItem('shippingOptionId')?.value:form.querySelector('input[name="shippingOptionId"]:checked')?.value;
  return shippingOptionsFor(delivery,shippingFormAddress(form)).find(option=>option.id===selected);
};
function checkShippingRestriction(form,option){
  if(option?.confirmationRequired&&!form.elements.namedItem('shippingRestrictionConfirmed')?.checked){toast('Confirme que o endereço fica dentro da área de entrega indicada.');return false;}
  return true;
}
const updateCheckoutShippingBeforeRegions=updateCheckoutShipping;
updateCheckoutShipping=()=>{
  if(!regionalShippingEnabled())return updateCheckoutShippingBeforeRegions();
  const form=document.querySelector('form:has(#shipping-options)');if(!form)return;
  const option=formShippingOption(form),freight=form.querySelector('#checkout-freight');
  if(freight)freight.textContent=option?money(option.price):'Aguardando endereço atendido';
  updatePaymentTotal(form);
};
const adminShippingBeforeRegions=updateAdminShippingOptions;
updateAdminShippingOptions=form=>{
  if(!regionalShippingEnabled())return adminShippingBeforeRegions(form);
  const select=form.elements.namedItem('shippingOptionId');if(!select)return;
  const address=shippingFormAddress(form),delivery=form.elements.namedItem('delivery').value;
  const options=shippingOptionsFor(delivery,address);
  select.innerHTML=options.length?options.map(option=>`<option value="${esc(option.id)}">${esc(option.name)} · ${money(option.price)}</option>`).join(''):'<option value="">Preencha um endereço atendido</option>';
  let notice=form.querySelector('#admin-shipping-coverage');
  if(!notice){select.closest('label').insertAdjacentHTML('afterend','<div id="admin-shipping-coverage" class="full"></div>');notice=form.querySelector('#admin-shipping-coverage');}
  if(notice){const option=options[0];notice.innerHTML=delivery!=='Entrega'?'':!option?adminRegionalShippingNotice(address):`${option.note?`<p class="regional-shipping-note">${esc(option.note)}</p>`:''}${option.confirmationRequired?'<label class="regional-shipping-confirm"><input type="checkbox" name="shippingRestrictionConfirmed" required value="true">Endereço dentro da área atendida indicada.</label>':''}`;}
};
function refreshRegionalShipping(form,force=false){
  if(!form||!regionalShippingEnabled())return;
  const key=JSON.stringify([form.elements.namedItem('delivery')?.value,shippingFormAddress(form),db.settings.shippingOptions]);
  if(!force&&form.dataset.regionalQuote===key)return;
  form.dataset.regionalQuote=key;
  if(form.id==='order-form'){updateAdminShippingOptions(form);updateOrderEstimate();}
  else{const target=form.querySelector('#shipping-options');if(target){target.innerHTML=shippingChoices(form.elements.namedItem('delivery')?.value,shippingFormAddress(form));updateCheckoutShipping();}}
}
const lookupCepBeforeRegions=lookupCep;
lookupCep=async input=>{await lookupCepBeforeRegions(input);refreshRegionalShipping(input.form);};
const lookupAdminCepBeforeRegions=lookupAdminCep;
lookupAdminCep=async input=>{await lookupAdminCepBeforeRegions(input);refreshRegionalShipping(input.form);};
const newOrderBeforeRegions=newOrder;
newOrder=()=>{newOrderBeforeRegions();const form=document.querySelector('#order-form');if(!form)return;setupPresaleProductPicker(form);setupPresaleSellers(form);refreshRegionalShipping(form,true);organizeNewOrder(form);};

function organizeNewOrder(form){
  if(form.classList.contains('new-order-form'))return;
  form.classList.add('new-order-form');
  const grid=form.querySelector('.form-grid'), summary=form.querySelector('.order-summary'), actions=form.querySelector('.form-actions');
  const intro=form.querySelector(':scope > .notice');
  if(intro){intro.className='new-order-intro';intro.textContent='Crie o pedido da loja física. Os produtos serão reservados após a confirmação.';}
  const layout=document.createElement('div');layout.className='new-order-layout';
  const main=document.createElement('div');main.className='new-order-main';layout.append(main);
  const section=(number,title,description)=>{const node=document.createElement('section');node.className='new-order-section';node.innerHTML=`<header><span class="new-order-step">${number}</span><div><h3>${title}</h3><p>${description}</p></div></header><div class="new-order-fields"></div>`;main.append(node);return node.lastElementChild;};
  const field=name=>form.elements.namedItem(name)?.closest('.field');
  const move=(target,...nodes)=>nodes.filter(Boolean).forEach(node=>target.append(node));
  const customer=section(1,'Cliente','Dados para contato e identificação.');
  move(customer,field('customer'),field('phone'),field('cpf'),field('email'));
  const phone=form.elements.namedItem('phone');if(phone){phone.placeholder='+55 (21) 99999-9999';phone.setAttribute('onblur','this.value=formatBrazilPhone(this.value)');}
  const product=section(2,'Produto','Busque o produto e confira as opções e a quantidade.');
  move(product,form.querySelector('.presale-product-picker'),form.querySelector('#admin-variation-fields'),field('qty'));
  setupOrderPriceControl(form,product);
  const delivery=section(3,'Entrega ou retirada','Defina o recebimento. O frete é calculado pelo endereço.');
  const deliveryField=field('delivery');deliveryField?.classList.remove('full');
  move(delivery,deliveryField,field('deliveryDate'),form.querySelector('#admin-address-fields'),form.querySelector('#admin-cep-feedback'),field('shippingOptionId'),form.querySelector('#admin-shipping-coverage'));
  const payment=section(4,'Pagamento e responsável','Confira a condição combinada com o cliente.');
  move(payment,field('paymentMethodId'),form.querySelector('.payment-choice-details'),field('paymentTiming'),field('seller'));
  const notes=section(5,'Observações','Informações úteis para a equipe e para a entrega.');
  const notesField=field('notes');if(notesField){notesField.firstChild.textContent='';form.elements.namedItem('notes').setAttribute('aria-label','Observações do pedido');}move(notes,notesField);
  const aside=document.createElement('aside');aside.className='new-order-sidebar';
  summary.querySelector('.final > span').textContent='Total do pedido';
  move(aside,summary,actions);layout.append(aside);form.append(layout);grid?.remove();
  actions.querySelector('.primary').textContent='Criar pedido';
}
const toggleDeliveryBeforeNewOrderLayout=toggleAdminDelivery;
toggleAdminDelivery=value=>{
  toggleDeliveryBeforeNewOrderLayout(value);
  const form=document.querySelector('#order-form');if(!form?.classList.contains('new-order-form'))return;
  const pickup=value==='Retirada';
  for(const selector of ['#admin-address-fields','#admin-cep-feedback']){const element=form.querySelector(selector);if(element)element.hidden=pickup;}
};

function presaleProductMatches(query){
  return searchText(query)?db.products.filter(product=>product.active&&available(product.id)>0&&matchesSearch(product.name,query)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):[];
}
function setupPresaleProductPicker(form){
  const old=form.elements.namedItem('product');if(!old)return;
  old.closest('label').outerHTML=`<div class="field full presale-product-picker"><label for="presale-product-search">Produto</label><div class="presale-search-input">${icon('search')}<input id="presale-product-search" type="search" placeholder="Busque pelo nome do produto" autocomplete="off" required aria-autocomplete="list" aria-controls="presale-product-results" oninput="searchPresaleProducts(this)" onfocus="showPresaleProductResults(this)" onkeydown="presaleSearchKey(event,this)"></div><input type="hidden" name="product" value=""><div id="presale-product-results" class="presale-product-results" hidden aria-label="Produtos encontrados"></div><div id="presale-selected-product" hidden></div><small id="presale-product-feedback" role="status">Digite o nome e selecione um produto para incluir no pedido.</small></div>`;
  updateAdminVariationFields();updateOrderEstimate();
}
function searchPresaleProducts(input){
  const form=input.form;form.elements.namedItem('product').value='';
  resetOrderPriceOverride(form);
  const selected=form.querySelector('#presale-selected-product');selected.hidden=true;selected.innerHTML='';
  input.setCustomValidity(input.value?'Selecione um produto nos resultados da busca.':'');
  updateAdminVariationFields();updateOrderEstimate();showPresaleProductResults(input);
}
function showPresaleProductResults(input){
  const form=input.form,target=form.querySelector('#presale-product-results');if(!target)return;
  if(form.elements.namedItem('product').value||!searchText(input.value)){target.hidden=true;target.innerHTML='';return;}
  const matches=presaleProductMatches(input.value),rows=matches.slice(0,15);
  target.innerHTML=rows.map(product=>`<button class="presale-product-result" type="button" onclick="selectPresaleProduct(${Number(product.id)},this.form)" onkeydown="presaleResultKey(event,this)"><img ${mediaImageAttributes(product.image,'thumb',{dimensions:false})} width="42" height="42" alt=""><span><strong>${esc(product.name)}</strong><small>${money(salePrice(product))} · ${available(product.id)} disponíveis</small></span>${icon('plus')}</button>`).join('')||'<p class="presale-no-results">Nenhum produto disponível com esse nome.</p>';
  target.hidden=false;
  form.querySelector('#presale-product-feedback').textContent=matches.length>15?`${matches.length} produtos encontrados. Exibindo os primeiros 15; refine o nome para encontrar o produto.`:matches.length?`${matches.length} produto(s) encontrado(s). Selecione uma opção.`:'Tente outro nome para buscar no catálogo.';
}
function selectPresaleProduct(id,form){
  const product=db.products.find(item=>item.id===id&&item.active&&available(id)>0);if(!product)return;
  form.elements.namedItem('product').value=String(id);const input=form.querySelector('#presale-product-search');input.value=product.name;input.setCustomValidity('');
  const results=form.querySelector('#presale-product-results');results.hidden=true;results.innerHTML='';
  const selected=form.querySelector('#presale-selected-product');selected.hidden=false;selected.innerHTML=`<div class="presale-product-selected"><img ${mediaImageAttributes(product.image,'thumb',{dimensions:false})} width="42" height="42" alt=""><div><strong>${esc(product.name)}</strong><small>${money(salePrice(product))} · ${available(id)} disponíveis</small></div><button class="btn small" type="button" onclick="clearPresaleProduct(this.form)" aria-label="Remover produto selecionado">${icon('trash')}</button></div>`;
  form.querySelector('#presale-product-feedback').textContent='Confira as variações e a quantidade abaixo.';
  resetOrderPriceOverride(form);
  updateAdminVariationFields();updateOrderEstimate();
}
function orderUnitPrice(form,product){
  const change=form?.orderPriceOverride;
  return change&&change.productId===product?.id?change.unitPrice:salePrice(product);
}
function validOrderPrice(value){return Number.isFinite(value)&&value>=0.01&&value<=1000000&&Math.abs(value*100-Math.round(value*100))<0.00001;}
function setupOrderPriceControl(form,container){
  container.insertAdjacentHTML('beforeend',`<div class="field order-price-control"><span>Preço neste pedido</span><button class="btn" type="button" data-order-price-open onclick="openOrderPriceEditor(this.form)" disabled>${icon('edit')}Personalizar preço</button><small data-order-price-status>Selecione um produto para personalizar.</small><button class="text-link order-price-reset" type="button" onclick="resetOrderPriceOverride(this.form);updateOrderEstimate()" hidden>Usar preço do catálogo</button></div><section class="order-price-editor full" hidden><header><h4>Personalizar preço unitário</h4><p>Válido apenas neste pedido. O catálogo da loja não será alterado.</p></header><div class="order-price-editor-fields"><label class="field">Novo valor unitário (R$)<input data-order-price-value type="number" min="0.01" max="1000000" step="0.01" disabled></label><label class="field full">Motivo da alteração<textarea data-order-price-reason minlength="3" maxlength="1000" rows="3" placeholder="Ex.: desconto negociado para pagamento à vista." disabled></textarea></label></div><div class="order-price-editor-actions"><button class="btn small" type="button" onclick="closeOrderPriceEditor(this.form)">Cancelar</button><button class="btn small primary" type="button" onclick="confirmOrderPrice(this.form)">Confirmar preço</button></div></section>`);
  form.orderRequestId=crypto.randomUUID();
}
function refreshOrderPriceControl(form){
  const product=db.products.find(p=>p.id===Number(form.elements.namedItem('product')?.value));
  const button=form.querySelector('[data-order-price-open]'),status=form.querySelector('[data-order-price-status]'),reset=form.querySelector('.order-price-reset');if(!button)return;
  button.disabled=!product;button.innerHTML=icon('edit')+(form.orderPriceOverride?money(orderUnitPrice(form,product))+' · Editar':'Personalizar preço');
  status.textContent=product?(form.orderPriceOverride?'Preço personalizado · Catálogo: ':'Preço do catálogo: ')+money(salePrice(product)):'Selecione um produto para personalizar.';
  reset.hidden=!form.orderPriceOverride;
}
function openOrderPriceEditor(form){
  const product=db.products.find(p=>p.id===Number(form.elements.namedItem('product')?.value));if(!product)return;
  const panel=form.querySelector('.order-price-editor'),value=panel.querySelector('[data-order-price-value]'),reason=panel.querySelector('[data-order-price-reason]');
  panel.hidden=false;value.disabled=reason.disabled=false;value.required=reason.required=true;
  value.value=orderUnitPrice(form,product);reason.value=form.orderPriceOverride?.reason||'';
  form.querySelector('.new-order-sidebar .primary').disabled=true;
  value.focus();value.select();
}
function closeOrderPriceEditor(form){
  const panel=form.querySelector('.order-price-editor');if(!panel)return;panel.hidden=true;
  panel.querySelectorAll('input,textarea').forEach(input=>{input.disabled=true;input.required=false;input.setCustomValidity('');});
  form.querySelector('.new-order-sidebar .primary').disabled=Boolean(form.orderSaving);
  form.querySelector('[data-order-price-open]')?.focus();
}
function confirmOrderPrice(form){
  const product=db.products.find(p=>p.id===Number(form.elements.namedItem('product')?.value));if(!product)return;
  const value=form.querySelector('[data-order-price-value]'),reason=form.querySelector('[data-order-price-reason]'),unitPrice=Number(value.value),why=reason.value.trim();
  value.setCustomValidity(value.value&&validOrderPrice(unitPrice)?'':'Informe um valor maior que zero, com até duas casas decimais.');
  reason.setCustomValidity(why.length>=3&&why.length<=1000?'':'Escreva o motivo da alteração, entre 3 e 1.000 caracteres.');
  if(!value.reportValidity()||!reason.reportValidity())return;
  form.orderPriceOverride=unitPrice===salePrice(product)?null:{productId:product.id,expectedUnitPrice:salePrice(product),unitPrice,reason:why};
  closeOrderPriceEditor(form);refreshOrderPriceControl(form);updateOrderEstimate();
}
function resetOrderPriceOverride(form){form.orderPriceOverride=null;closeOrderPriceEditor(form);refreshOrderPriceControl(form);}
function clearPresaleProduct(form){const input=form.querySelector('#presale-product-search');input.value='';searchPresaleProducts(input);form.querySelector('#presale-product-feedback').textContent='Digite o nome e selecione um produto para incluir no pedido.';input.focus();}
const estimateBeforePresaleSearch=updateOrderEstimate;
updateOrderEstimate=()=>{
  const form=document.querySelector('#order-form');
  if(form&&!form.elements.namedItem('product')?.value){
    const products=form.querySelector('#order-products'),total=form.querySelector('#order-estimate'),quote=form.querySelector('.payment-preview');
    if(products)products.textContent='—';if(total)total.textContent='—';const freight=form.querySelector('#order-freight');if(freight)freight.textContent='A calcular';if(quote)quote.innerHTML='';return;
  }
  return estimateBeforePresaleSearch();
};
function presaleSearchKey(event,input){
  if(event.key==='Escape'){input.form.querySelector('#presale-product-results').hidden=true;return;}
  if(['ArrowDown','Enter'].includes(event.key)&&!input.form.elements.namedItem('product').value){const first=input.form.querySelector('.presale-product-result');event.preventDefault();if(first){if(event.key==='Enter')first.click();else first.focus();}}
}
function presaleResultKey(event,button){
  const rows=[...button.form.querySelectorAll('.presale-product-result')],index=rows.indexOf(button);
  if(event.key==='Escape'){event.preventDefault();button.form.querySelector('#presale-product-search').focus();button.form.querySelector('#presale-product-results').hidden=true;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:rows.length-1))%rows.length]?.focus();}
}
document.addEventListener('click',event=>{const picker=document.querySelector('.presale-product-picker');if(picker&&!picker.contains(event.target)){const results=picker.querySelector('#presale-product-results');if(results)results.hidden=true;}});

function presaleSellerProfiles(profiles=accountProfiles){
  return profiles.filter(profile=>profile.role==='admin'&&profile.position==='Vendedor'&&String(profile.name||'').trim()&&(currentProfile?.role!=='admin'||currentProfile.position!=='Vendedor'||profile.user_id===currentProfile.user_id))
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
function fillPresaleSellers(form,profiles){
  const select=form.elements.namedItem('seller'),previous=select.value;
  form.presaleSellers=presaleSellerProfiles(profiles);
  const own=currentProfile?.role==='admin'&&currentProfile.position==='Vendedor'?currentProfile.user_id:'';
  select.innerHTML='<option value="">Selecione o vendedor responsável</option>'+form.presaleSellers.map(profile=>`<option value="${esc(profile.user_id)}">${esc(profile.name)}</option>`).join('');
  select.value=form.presaleSellers.some(profile=>profile.user_id===previous)?previous:own;
  select.required=true;select.disabled=!form.presaleSellers.length;
  const hint=form.querySelector('#presale-seller-feedback');if(hint)hint.textContent=form.presaleSellers.length?'Selecione o perfil responsável por esta venda na loja física.':'Nenhum perfil de vendedor disponível. Cadastre um integrante com o cargo Vendedor em Equipe e permissões.';
}
function presaleSelectedSeller(form){return form.presaleSellers?.find(profile=>profile.user_id===form.elements.namedItem('seller').value)||null;}
function setupPresaleSellers(form){
  const select=form.elements.namedItem('seller');if(!select)return;
  select.closest('label').insertAdjacentHTML('beforeend','<small id="presale-seller-feedback" role="status"></small>');
  fillPresaleSellers(form,accountProfiles);loadPresaleSellers(form);
}
async function loadPresaleSellers(form){
  try{const profiles=await backendRequest('/rest/v1/profiles?select=user_id,name,role,position&role=eq.admin&position=eq.Vendedor&order=name.asc',{},true);if(form.isConnected)fillPresaleSellers(form,profiles);}
  catch{if(form.isConnected){const hint=form.querySelector('#presale-seller-feedback');hint.textContent='Não foi possível atualizar os vendedores. Feche e abra o formulário de pedido para tentar novamente.';}}
}
const createAdminBeforeRegions=createAdminOrder;
createAdminOrder=form=>{const option=formShippingOption(form);if(!checkShippingRestriction(form,option))return;return createAdminBeforeRegions(form);};
const renderBeforeRegions=render;
render=()=>{const result=renderBeforeRegions();refreshRegionalShipping(document.querySelector('form:has(#shipping-options)'));return result;};
for(const eventName of ['input','change'])document.addEventListener(eventName,event=>{
  if(['cep','street','number','neighborhood','city','state','delivery'].includes(event.target?.name)){
    const form=event.target.form;if(form&&(form.id==='order-form'||form.querySelector('#shipping-options')))refreshRegionalShipping(form);
  }
});

let freightQuery='',freightCity='',freightStatus='all',freightPage=1,freightSaving=false;
const regionalFreightRows=()=>allShippingOptions().map((option,index)=>({option,index})).filter(({option})=>option.delivery==='Entrega'&&(!freightCity||option.region?.city===freightCity)&&(freightStatus==='all'||(option.active!==false)===(freightStatus==='active'))&&matchesSearch([option.name,option.region?.city,...(option.region?.neighborhoods||[])].join(' '),freightQuery)).sort((a,b)=>(a.option.region?.city||'').localeCompare(b.option.region?.city||'','pt-BR')||a.option.name.localeCompare(b.option.name,'pt-BR'));
function updateFreightFilter(name,value){if(name==='query')freightQuery=value;if(name==='city')freightCity=value;if(name==='status')freightStatus=value;freightPage=1;const target=document.querySelector('#regional-freight-list');if(target)target.innerHTML=regionalFreightTable();}
function regionalFreightTable(){
  const rows=regionalFreightRows(),pages=Math.max(1,Math.ceil(rows.length/25));freightPage=Math.min(freightPage,pages);
  return `<div class="table-wrap"><table class="regional-freight-table"><thead><tr><th>Região / localidade</th><th>Cidade</th><th>Frete</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${rows.slice((freightPage-1)*25,freightPage*25).map(({option,index})=>`<tr><td><strong>${esc(option.name)}</strong><small>${option.region?.neighborhoods?.length?'Bairros e localidades':'Toda a cidade'}${option.note?' · '+esc(option.note):''}</small></td><td>${esc(option.region?.city||'Sem região')} / ${esc(option.region?.state||'RJ')}</td><td class="freight-price">${money(option.price)}</td><td><span class="badge ${option.active===false?'':'green'}">${option.active===false?'Pausada':'Ativa'}</span></td><td><div class="actions">${button('Editar',`onclick="shippingModal(${index})"`,'small','edit')}${button(option.active===false?'Ativar':'Pausar',`onclick="toggleFreight(${index})"`,'small')}${button('Excluir',`onclick="deleteShippingOption(${index})"`,'small danger','trash')}</div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhuma região encontrada.</td></tr>'}</tbody></table></div><div class="regional-freight-pagination"><span>${rows.length} região(ões) · Página ${freightPage} de ${pages}</span><div class="actions">${button('Anterior',`onclick="freightPage--;refreshFreightTable()" ${freightPage<=1?'disabled':''}`,'small')}${button('Próxima',`onclick="freightPage++;refreshFreightTable()" ${freightPage>=pages?'disabled':''}`,'small')}</div></div>`;
}
function refreshFreightTable(){const target=document.querySelector('#regional-freight-list');if(target)target.innerHTML=regionalFreightTable();}
freightSettingsPage=()=>{
  const options=allShippingOptions().filter(o=>o.delivery==='Entrega'),cities=[...new Set(options.map(o=>o.region?.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return `<section class="card pad regional-freight"><div class="shipping-settings-head"><div><h2>Regiões de entrega</h2><p class="subtle">O frete é calculado pelo endereço no checkout. Cadastre cidades inteiras ou localidades específicas.</p></div>${button('Adicionar região','onclick="shippingModal()"','primary','plus')}</div><div class="regional-freight-stats"><span><strong>${options.filter(o=>o.active!==false).length}</strong> regiões ativas</span><span><strong>${cities.length}</strong> cidades</span><span>Retirada na loja <strong>grátis</strong></span></div><div class="regional-freight-filters"><label class="field">Buscar região<input type="search" placeholder="Cidade, bairro ou localidade" value="${esc(freightQuery)}" oninput="updateFreightFilter('query',this.value)"></label><label class="field">Cidade<select onchange="updateFreightFilter('city',this.value)"><option value="">Todas as cidades</option>${cities.map(city=>`<option ${city===freightCity?'selected':''}>${esc(city)}</option>`).join('')}</select></label><label class="field">Situação<select onchange="updateFreightFilter('status',this.value)">${[['all','Todas'],['active','Ativas'],['paused','Pausadas']].map(([value,label])=>`<option value="${value}" ${freightStatus===value?'selected':''}>${label}</option>`).join('')}</select></label></div><div id="regional-freight-list">${regionalFreightTable()}</div><p class="subtle regional-freight-help">Localidades específicas têm prioridade sobre o preço da cidade. Fora da cobertura, o cliente poderá consultar o WhatsApp da loja.</p></section>`;
};
shippingModal=(index=-1)=>{
  if(!canConfigureFreight()||freightSaving)return;
  const option=allShippingOptions()[index]||{name:'',price:'',region:{city:'',state:'RJ',neighborhoods:[]}};
  if(option.delivery&&option.delivery!=='Entrega')return;
  const region=option.region||{},cities=[...new Set(allShippingOptions().map(o=>o.region?.city).filter(Boolean))];
  modal(index<0?'Adicionar região de entrega':'Editar região de entrega',`<form onsubmit="event.preventDefault();saveShippingOption(this,${index})"><div class="form-grid"><label class="field full">Nome da região<input name="name" value="${esc(option.name)}" required maxlength="120" placeholder="Ex.: Camboinhas e Piratininga"></label><label class="field">Cidade<input name="city" value="${esc(region.city||'')}" list="freight-cities" required maxlength="100" placeholder="Ex.: Niterói"><datalist id="freight-cities">${cities.map(city=>`<option value="${esc(city)}">`).join('')}</datalist></label>${field('Estado (UF)','state',region.state||'RJ','text','required minlength="2" maxlength="2" pattern="[A-Za-z]{2}" oninput="this.value=this.value.toUpperCase()"')}${field('Preço do frete (R$)','price',option.price,'number','required min="0" max="100000" step="0.01"')}<label class="field">Situação<select name="active"><option value="true" ${option.active!==false?'selected':''}>Ativa</option><option value="false" ${option.active===false?'selected':''}>Pausada</option></select></label><label class="field full">Cobertura<select name="scope" onchange="this.form.querySelector('#freight-neighborhoods').hidden=this.value==='city'"><option value="city" ${!region.neighborhoods?.length?'selected':''}>Toda a cidade</option><option value="neighborhoods" ${region.neighborhoods?.length?'selected':''}>Bairros / localidades específicas</option></select></label><label class="field full" id="freight-neighborhoods" ${!region.neighborhoods?.length?'hidden':''}>Bairros e nomes alternativos<textarea name="neighborhoods" rows="4" maxlength="5000" placeholder="Um por linha. Ex.:\nCamboinhas\nPiratininga">${esc((region.neighborhoods||[]).join('\n'))}</textarea><small class="subtle">Inclua os nomes usados no endereço. Abreviações como Jd. e Pq. são reconhecidas.</small></label><label class="field full">Observação de cobertura (opcional)<input name="note" value="${esc(option.note||'')}" maxlength="240" placeholder="Ex.: Entrega somente até a UPA"></label><label class="regional-shipping-confirm full"><input type="checkbox" name="confirmationRequired" ${option.confirmationRequired?'checked':''}>Exigir confirmação de que o endereço está dentro da área indicada.</label></div><div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary" type="submit">Salvar região</button></div></form>`);
};
function validateRegionalFreight(options){
  const keys=new Set(),ids=new Set();
  if(options.length>500)throw Error('Cadastre até 500 opções de frete.');
  for(const option of options){
    if(!option.id||ids.has(option.id))throw Error('Identificador de frete duplicado.');ids.add(option.id);
    if(!option.name?.trim()||option.name.length>120||!Number.isFinite(option.price)||option.price<0||option.price>100000||Math.abs(option.price*100-Math.round(option.price*100))>0.000001)throw Error('Confira o nome e o preço do frete.');
    if(typeof option.active!=='boolean'||!['Entrega','Retirada'].includes(option.delivery))throw Error('Confira a situação e a modalidade.');
    if(option.delivery!=='Entrega'){if(option.price!==0)throw Error('A retirada na loja deve ser gratuita.');continue;}
    const region=option.region;
    if(!region?.city?.trim()||region.city.length>100||!/^[A-Z]{2}$/.test(region.state)||!Array.isArray(region.neighborhoods)||region.neighborhoods.length>50)throw Error('Confira a cidade, a UF e os bairros.');
    if(option.confirmationRequired&&!option.note?.trim())throw Error('Descreva a restrição de cobertura para exigir confirmação.');
    for(const name of region.neighborhoods.length?region.neighborhoods:['*']){
      if(name!=='*'&&!shippingKey(name)||name.length>120)throw Error('Confira os nomes dos bairros.');
      const key=[shippingKey(region.state),shippingKey(region.city),name==='*'?'*':shippingKey(name)].join('|');
      if(keys.has(key))throw Error('Esta cidade ou localidade já tem uma tarifa cadastrada. Edite a região existente.');keys.add(key);
    }
  }
}
async function persistRegionalFreight(next,form){
  if(!canConfigureFreight()||freightSaving)return false;
  try{validateRegionalFreight(next);}catch(error){toast(error.message);return false;}
  freightSaving=true;const submit=form?.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
  let committed=false;
  try{
    await settleAdminWrites();
    const expected={mode:db.settings.shippingMode||null,options:structuredClone(allShippingOptions())};
    await backendRequest('/rest/v1/rpc/save_shipping_settings',{method:'POST',body:JSON.stringify({p_options:next,p_expected:expected})},true);
    committed=true;db.settings.shippingMode='regional';db.settings.shippingOptions=next;
    await loadAdminState();closeModal();render();toast('Regiões de entrega atualizadas.');return true;
  }catch(error){toast(committed?'Frete salvo. Atualize a página antes de continuar.':catalogSaveError(error));return false;}
  finally{freightSaving=false;if(submit)submit.disabled=false;}
}
saveShippingOption=async(form,index)=>{
  if(!canConfigureFreight())return;
  const data=Object.fromEntries(new FormData(form)),options=structuredClone(allShippingOptions());
  const neighborhoods=data.scope==='city'?[]:[...new Set(String(data.neighborhoods||'').split(/\r?\n/).map(n=>n.trim()).filter(Boolean))];
  if(data.scope!=='city'&&!neighborhoods.length)return toast('Informe pelo menos um bairro ou localidade.');
  const option={id:options[index]?.id||'ship-'+crypto.randomUUID(),name:String(data.name||'').trim(),price:data.price===''?NaN:Number(data.price),active:data.active==='true',delivery:'Entrega',region:{state:String(data.state||'').toUpperCase().trim(),city:String(data.city||'').trim(),neighborhoods},note:String(data.note||'').trim(),confirmationRequired:data.confirmationRequired==='on'};
  if(index>=0)options[index]=option;else options.push(option);
  return persistRegionalFreight(options,form);
};
deleteShippingOption=async index=>{
  if(!canConfigureFreight()||freightSaving)return;
  const option=allShippingOptions()[index];if(option?.delivery!=='Entrega')return;
  if(!await confirmBusinessChange({title:'Excluir região de entrega',description:`Você confirma a exclusão de “${option.name}”?`,impact:'A região deixará de estar disponível no checkout. Os pedidos anteriores manterão o frete registrado.',confirmLabel:'Sim, excluir região',danger:true}))return;
  await persistRegionalFreight(allShippingOptions().filter((_,i)=>i!==index));
};
toggleFreight=async index=>{
  if(!canConfigureFreight()||freightSaving||allShippingOptions()[index]?.delivery!=='Entrega')return;
  const options=structuredClone(allShippingOptions());options[index].active=options[index].active===false;await persistRegionalFreight(options);
};
