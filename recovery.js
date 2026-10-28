// Checkout recovery is independent of orders, inventory, analytics and theme drafts.
const recoveryStorageKey='forte-checkout-recovery-v1';
const recoveryUuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let recoveryRows=[],recoverySummary={},recoveryTotal=0,recoveryPage=1,recoveryQuery='',recoveryStatus='pending',recoveryDays=30;
let recoveryLoading=false,recoveryLoaded=false,recoveryError='',recoveryRequest=0,recoverySearchTimer=0,recoveryPoll=0,recoverySelected=null;
let recoverySaveTimer=0,recoverySaving=false,recoverySaveAgain=false,recoveryLastPayload='',recoveryLastSentAt=0,recoveryTouched=false;
let recoveryConsentChoice=null,recoveryResume=null,recoveryResumeKey='',recoveryResumeLoading=false,recoveryResumeError='';
const recoveryStages={pending:['A recuperar','yellow'],active:['Em andamento','gray'],contacted:['Em atendimento','blue'],waiting:['Aguardando resposta','blue'],converted:['Pedido criado','green'],closed:['Encerrado','gray'],optout:['Não contatar','gray'],unconsented:['Sem autorização','gray']};
const canManageRecovery=()=>isOwner&&allowed('abandoned-checkouts')&&['master','admin'].includes(currentProfile?.role)&&!isDeliveryDriverView();
const onRecoveryPage=()=>canManageRecovery()&&routePath()==='/app/abandoned-checkouts';
function recoveryBadge(row){const stage=recoveryStages[row.stage]||recoveryStages.pending;return `<span class="badge ${stage[1]}">${esc(stage[0])}</span>`;}
function recoveryMoment(value){return value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';}
function recoveryAgo(value){const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return minutes<1?'Agora':minutes<60?`Há ${minutes} min`:minutes<1440?`Há ${Math.floor(minutes/60)} h`:`Há ${Math.floor(minutes/1440)} dia${minutes>=2880?'s':''}`;}
function recoveryName(row){return [row.first_name,row.last_name].filter(Boolean).join(' ')||'Contato do checkout';}
function recoveryCanContact(row){return Boolean(row?.consent&&['pending','contacted','waiting'].includes(row.stage));}
function recoveryItemMarkup(item,compact=false){return `<div class="recovery-product"><img ${mediaImageAttributes(item.image,'thumb',{dimensions:false})} alt="" width="${compact?42:56}" height="${compact?42:56}"><div><strong>${esc(item.name)}</strong><small>${esc(optionText(item.options||{}))}${Object.keys(item.options||{}).length?' · ':''}${item.qty} un.${compact?'':' · '+money(item.price)}</small></div>${compact?'':`<b>${money(item.price*item.qty)}</b>`}</div>`;}
function recoveryListRow(row){return `<article class="recovery-row"><div class="recovery-person"><strong>${esc(recoveryName(row))}</strong><span>${esc(formatBrazilPhone(row.phone))}</span>${row.locality?`<small>${esc(row.locality)}</small>`:''}<small class="recovery-inline-activity">${esc(recoveryAgo(row.last_seen))} · ${esc(recoveryMoment(row.last_seen))}</small></div><div class="recovery-list-products">${recoveryItemMarkup(row.items[0],true)}${row.items.length>1?`<small>+ ${row.items.length-1} produto${row.items.length>2?'s':''}</small>`:''}</div><div class="recovery-value"><strong>${money(row.subtotal)}</strong><small>Em produtos</small></div><div class="recovery-progress">${recoveryBadge(row)}${row.assigned_name?`<small>${esc(row.assigned_name)}</small>`:''}${row.last_contact_at?`<small>Contato ${esc(recoveryAgo(row.last_contact_at).toLowerCase())}</small>`:''}</div><div class="recovery-activity"><strong>${esc(recoveryAgo(row.last_seen))}</strong><small>${esc(recoveryMoment(row.last_seen))}</small></div><div class="recovery-row-actions"><button class="btn small ${recoveryCanContact(row)?'primary':''}" onclick="openRecoveryDetail('${row.id}')">${icon(recoveryCanContact(row)?'phone':'eye')}${recoveryCanContact(row)?'Recuperar':'Ver detalhes'}</button></div></article>`;}
function recoveryResults(){
 if(recoveryError)return `<div class="recovery-empty" role="alert">${icon('refresh')}<h2>Não foi possível atualizar a fila</h2><p>${esc(recoveryError)}</p><button class="btn" onclick="loadRecoveryQueue()">Tentar novamente</button></div>`;
 if(recoveryLoading&&!recoveryLoaded)return '<div class="recovery-empty" role="status">Carregando checkouts…</div>';
 if(!recoveryRows.length)return `<div class="recovery-empty">${icon('bag')}<h2>${recoveryQuery?'Nenhum checkout encontrado':recoveryStatus==='pending'?'Nenhum carrinho aguardando recuperação':'Nenhum checkout neste filtro'}</h2><p>${recoveryQuery?'Tente outro nome, telefone, e-mail ou produto.':'Os contatos informados no checkout aparecerão aqui. A fila de recuperação começa após 30 minutos sem atividade e com autorização para WhatsApp.'}</p>${recoveryQuery||recoveryStatus!=='pending'?'<button class="btn" onclick="resetRecoveryFilters()">Limpar filtros</button>':''}</div>`;
 return '<div class="recovery-table-head" aria-hidden="true"><span>Cliente</span><span>Produtos</span><span>Valor estimado</span><span>Atendimento</span><span>Última atividade</span><span></span></div><div class="recovery-list">'+recoveryRows.map(recoveryListRow).join('')+'</div>';
}
function recoveryPageMarkup(){
 if(!canManageRecovery())return heading('Acesso restrito','Esta área é reservada à equipe de vendas e gestão.');
 return heading('Carrinhos abandonados','Retome conversas e ajude seus clientes a concluir a compra.',button(recoveryLoading?'Atualizando…':'Atualizar',`onclick="loadRecoveryQueue()" ${recoveryLoading?'disabled':''}`,'','refresh'))+
 `<div class="recovery-stats">${[[recoverySummary.pending||0,'A recuperar','Checkouts identificados e autorizados'],[money(recoverySummary.potential||0),'Valor em produtos','Sem frete e taxas · não é receita'],[recoverySummary.contacted||0,'Contatos registrados','Envio confirmado pela equipe'],[recoverySummary.converted||0,'Pedidos criados','Pagamento acompanhado em Pedidos']].map(([value,label,hint])=>`<section class="card recovery-stat"><span>${label}</span><strong>${value}</strong><small>${hint}</small></section>`).join('')}</div>
 <section class="card recovery-queue"><div class="recovery-toolbar"><label class="field recovery-search">Pesquisar<input type="search" value="${esc(recoveryQuery)}" placeholder="Nome, telefone, e-mail ou produto" oninput="searchRecoveryQueue(this)" data-recovery-search></label><label class="field">Atendimento<select onchange="recoveryStatus=this.value;recoveryPage=1;loadRecoveryQueue()">${[['pending','A recuperar'],['contacted','Em atendimento'],['waiting','Aguardando resposta'],['active','Em andamento'],['unconsented','Sem autorização'],['converted','Pedido criado'],['closed','Encerrados'],['optout','Não contatar'],['all','Todos os checkouts']].map(([value,title])=>`<option value="${value}" ${recoveryStatus===value?'selected':''}>${title}</option>`).join('')}</select></label><label class="field">Período<select onchange="recoveryDays=Number(this.value);recoveryPage=1;loadRecoveryQueue()">${[[1,'Hoje'],[7,'Últimos 7 dias'],[30,'Últimos 30 dias']].map(([value,title])=>`<option value="${value}" ${recoveryDays===value?'selected':''}>${title}</option>`).join('')}</select></label></div>
 <div id="recovery-results" aria-busy="${recoveryLoading}">${recoveryResults()}</div><div class="recovery-pagination"><small>${recoveryTotal} checkout${recoveryTotal===1?'':'s'} neste filtro · Horário de Brasília</small><div><button class="btn small" ${recoveryPage<=1||recoveryLoading?'disabled':''} onclick="recoveryPage--;loadRecoveryQueue()" aria-label="Página anterior">${icon('back')}</button><span>${recoveryPage} / ${Math.max(1,Math.ceil(recoveryTotal/30))}</span><button class="btn small" ${recoveryPage*30>=recoveryTotal||recoveryLoading?'disabled':''} onclick="recoveryPage++;loadRecoveryQueue()" aria-label="Próxima página">${icon('arrow')}</button></div></div></section>
 <details class="recovery-explainer"><summary>Como funciona a recuperação</summary><div><p><strong>Oportunidades reais.</strong> Adicionar ao carrinho na Meta não identifica necessariamente uma pessoa. Aqui entram contatos válidos informados no checkout, sem criar cadastro ou reservar estoque.</p><p><strong>Contato com contexto.</strong> Após 30 minutos sem atividade, os checkouts autorizados ficam disponíveis. Revise a mensagem e abra o WhatsApp. Registre o contato somente depois de enviar.</p><p><strong>Sem confundir com vendas.</strong> Um pedido criado encerra a recuperação automaticamente, mesmo com pagamento na entrega. Confirme o recebimento do valor na área de Pedidos.</p><p>Mostramos a tentativa mais recente por telefone. Os dados expiram em 30 dias. Pedidos concluídos, recusas de contato e checkouts ainda ativos ficam fora da fila de contato.</p></div></details>`;
}
function searchRecoveryQueue(input){recoveryQuery=input.value;recoveryPage=1;clearTimeout(recoverySearchTimer);recoverySearchTimer=setTimeout(()=>loadRecoveryQueue(),350);}
function resetRecoveryFilters(){recoveryQuery='';recoveryStatus='pending';recoveryDays=30;recoveryPage=1;loadRecoveryQueue();}
async function recoveryRpc(name,args){await refreshAuth();return backendJson(await fetch(backendUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:requestHeaders(true),body:JSON.stringify(args),cache:'no-store'}));}
async function loadRecoveryQueue(){
 if(!onRecoveryPage())return;const request=++recoveryRequest;recoveryLoading=true;recoveryError='';
 const selected=document.querySelector('[data-recovery-search]')===document.activeElement,position=document.activeElement?.selectionStart;
 if(!recoveryLoaded)render();
 try {const result=await recoveryRpc('list_checkout_recovery',{p_query:recoveryQuery,p_status:recoveryStatus,p_days:recoveryDays,p_page:recoveryPage});
  if(request!==recoveryRequest||!onRecoveryPage())return;
  if(!Array.isArray(result?.rows))throw Error('Resposta inválida do serviço.');
  const lastPage=Math.max(1,Math.ceil((Number(result.total)||0)/30));
  if(recoveryPage>lastPage){recoveryPage=lastPage;return await loadRecoveryQueue();}
  recoveryRows=result.rows;recoverySummary=result.summary||{};recoveryTotal=Number(result.total)||0;recoveryPage=Number(result.page)||1;
 }catch(error){if(request===recoveryRequest&&onRecoveryPage())recoveryError=[401,403].includes(error.status)?'Seu acesso a esta área mudou. Atualize o painel ou entre novamente.':'Confira sua conexão e tente novamente.';}
 finally {if(request===recoveryRequest&&onRecoveryPage()){recoveryLoading=false;recoveryLoaded=true;render();if(selected){const field=document.querySelector('[data-recovery-search]');field?.focus();try{field?.setSelectionRange(position,position);}catch{}}}}
}
function recoveryMessage(row){
 const first=row.first_name||'tudo bem',store=db.settings.name||'nossa loja';
 const names=row.items.slice(0,2).map(item=>`${item.qty} × ${item.name}${optionText(item.options||{})?' ('+optionText(item.options)+')':''}`).join('\n');
 return `Olá, ${first}! Aqui é da ${store}. Você começou um pedido na nossa loja e podemos ajudar a concluir.\n\n${names}${row.items.length>2?'\nE mais '+(row.items.length-2)+' produto(s).':''}\n\nFicou alguma dúvida sobre o produto, pagamento ou entrega? Podemos conferir com você.\n\nPara retomar seu carrinho e revisar os valores atuais:\n${recoveryResumeUrl(row)}\n\nSe preferir não receber este atendimento, é só nos avisar.`;
}
function recoveryResumeUrl(row){return 'https://forteoutlet.com.br/#/loja/recuperar/'+row.recovery_token;}
const recoveryEventNames={claim:'Atendimento assumido',opened:'WhatsApp aberto · envio não confirmado',contacted:'Contato realizado pela equipe',waiting:'Aguardando resposta',close:'Atendimento encerrado',reopen:'Atendimento reaberto',optout:'Contato bloqueado a pedido do cliente',note:'Observação atualizada',converted:'Pedido criado',cart_cleared:'Cliente esvaziou o carrinho'};
async function openRecoveryDetail(id){
 if(!canManageRecovery())return;modal('Detalhes do checkout','<div class="recovery-empty" role="status">Carregando informações…</div>');
 try {const row=await recoveryRpc('checkout_recovery_detail',{p_id:id});if(!canManageRecovery()||!document.querySelector('#modal')?.open)return;recoverySelected=row;renderRecoveryDetail();}
 catch{modal('Checkout indisponível','<p>Não foi possível carregar este atendimento. Atualize a fila e tente novamente.</p>');}
}
function renderRecoveryDetail(){
 const row=recoverySelected;if(!row||!canManageRecovery())return;
 const mine=!row.assigned_to||row.assigned_to===authSession?.user?.id,canContact=recoveryCanContact(row)&&mine;
 modal(recoveryName(row),`<div class="recovery-detail"><div class="recovery-detail-top">${recoveryBadge(row)}<span>Última atividade ${esc(recoveryAgo(row.last_seen).toLowerCase())}</span></div><div class="recovery-detail-grid"><div class="recovery-detail-main"><section class="recovery-detail-section"><h3>Produtos do checkout</h3>${row.items.map(item=>recoveryItemMarkup(item)).join('')}<div class="total-line"><span>Valor estimado em produtos</span><strong>${money(row.subtotal)}</strong></div><p class="subtle">Valores registrados na tentativa, sem frete e taxas. Preços e estoque são conferidos novamente ao retomar.</p></section>
 <section class="recovery-detail-section"><div class="recovery-section-title"><h3>Mensagem de recuperação</h3>${row.consent?'<span class="recovery-permission">'+icon('check')+'Ajuda autorizada</span>':''}</div>${!mine?`<div class="notice">Atendimento com ${esc(row.assigned_name||'outra pessoa da equipe')}. Combine o contato para evitar mensagens duplicadas.</div>`:''}
 ${canContact?`<label class="field">Revise antes de abrir o WhatsApp<textarea id="recovery-message" rows="9" maxlength="4000">${esc(recoveryMessage(row))}</textarea></label><div class="recovery-contact-actions"><button class="btn primary" onclick="openRecoveryWhatsapp(this)">${icon('phone')}Abrir WhatsApp</button><button class="btn" onclick="recoveryDecision('contacted')">Registrar contato realizado</button></div><p class="subtle">A conversa abre com a mensagem pronta. Você decide quando enviar. A abertura não confirma envio nem leitura.</p>`:`<p class="recovery-contact-unavailable">${row.stage==='active'?'O cliente ainda pode estar preenchendo o checkout. Aguarde 30 minutos sem atividade.':row.stage==='converted'?'Já existe um pedido para este contato. A recuperação foi interrompida.':!row.consent?'Este contato não autorizou ajuda pelo WhatsApp. A compra continua disponível normalmente.':!mine?'O responsável pelo atendimento pode abrir a conversa.':'Este atendimento não está disponível para contato.'}</p>`}
 ${row.order_id?`<a class="btn" href="/app/orders/${row.order_id}" onclick="closeModal()">Acompanhar pedido #${row.order_id}</a>`:''}</section>
 <section class="recovery-detail-section"><h3>Observações da equipe</h3><form onsubmit="event.preventDefault();saveRecoveryNotes(this)"><label class="field"><span class="sr-only">Observações</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Registre dúvidas, preferências ou o combinado com o cliente.">${esc(row.notes||'')}</textarea></label><div class="form-actions"><button class="btn small" type="submit">Salvar observação</button></div></form></section></div>
 <aside class="recovery-detail-aside"><section class="recovery-detail-section"><h3>Contato</h3><strong>${esc(formatBrazilPhone(row.phone))}</strong>${row.email?`<span>${esc(row.email)}</span>`:''}${row.locality?`<span>${esc(row.locality)}</span>`:''}<small>${esc(row.delivery||'Modalidade ainda não escolhida')}</small><small>Última etapa: ${esc(({contact:'Contato',delivery:'Entrega ou retirada',payment:'Pagamento',error:'Tentativa de finalização sem sucesso'})[row.phase]||'Contato')}</small><small>Iniciado em ${esc(recoveryMoment(row.created_at))}</small><small>${row.consent?'Autorização em '+esc(recoveryMoment(row.consent_at)):'Sem autorização para WhatsApp'}</small></section>
 <section class="recovery-detail-section"><h3>Atendimento</h3><span>${esc(row.assigned_name||'Sem responsável')}</span>${!row.assigned_to&&['pending','contacted','waiting'].includes(row.stage)?'<button class="btn small" onclick="recoveryUpdate(\'claim\')">Assumir atendimento</button>':''}<div class="recovery-state-actions">${canContact?'<button class="btn small" onclick="recoveryDecision(\'waiting\')">Aguardar resposta</button>':''}${!['converted','closed','optout'].includes(row.stage)?'<button class="btn small" onclick="recoveryDecision(\'close\')">Encerrar atendimento</button>':''}${row.stage==='closed'?'<button class="btn small" onclick="recoveryDecision(\'reopen\')">Reabrir atendimento</button>':''}${row.stage!=='optout'?'<button class="btn small danger" onclick="recoveryDecision(\'optout\')">Não contatar</button>':''}</div></section>
 <section class="recovery-detail-section"><h3>Histórico</h3><ol class="recovery-timeline">${(row.events||[]).slice().reverse().map(event=>`<li><strong>${esc(recoveryEventNames[event.action]||'Atendimento atualizado')}</strong><span>${esc(event.by||'Equipe')}</span><small>${esc(recoveryMoment(event.at))}</small></li>`).join('')||'<li><strong>Checkout identificado</strong><small>'+esc(recoveryMoment(row.created_at))+'</small></li>'}</ol></section></aside></div></div>`);
 normalizeLinks();
}
function recoveryDecision(action){
 const row=recoverySelected;if(!row)return;
 const info={contacted:['Registrar contato realizado','Confirme somente se você enviou a mensagem ao cliente. Abrir a conversa não comprova o envio.'],waiting:['Aguardar resposta','O atendimento ficará marcado como aguardando resposta do cliente.'],close:['Encerrar atendimento','O checkout sairá da fila de recuperação. Você poderá reabrir este atendimento dentro do prazo de retenção.'],reopen:['Reabrir atendimento','O checkout voltará à fila, respeitando a autorização e o tempo de inatividade.'],optout:['Não contatar este cliente','Use esta opção quando a pessoa pedir para não receber contatos. O bloqueio vale também para outras tentativas deste telefone por 90 dias.']};
 if(!info[action])return;
 modal(info[action][0],`<form class="recovery-confirm" onsubmit="event.preventDefault();recoveryUpdate('${action}')"><p>${esc(info[action][1])}</p>${action==='contacted'?'<label class="recovery-check"><input type="checkbox" required>Confirmo que enviei a mensagem para este cliente.</label>':''}<div class="form-actions"><button class="btn" type="button" onclick="renderRecoveryDetail()">Voltar</button><button class="btn primary" type="submit">Confirmar</button></div></form>`);
}
async function recoveryUpdate(action,notes=''){
 if(!canManageRecovery()||!recoverySelected)return;
 const buttons=[...document.querySelectorAll('#modal button')];buttons.forEach(button=>button.disabled=true);
 try {recoverySelected=await recoveryRpc('update_checkout_recovery',{p_id:recoverySelected.id,p_action:action,p_revision:recoverySelected.revision,p_notes:notes});renderRecoveryDetail();recoveryLoaded=false;if(onRecoveryPage())await loadRecoveryQueue();toast(action==='contacted'?'Contato registrado. O pedido será acompanhado automaticamente.':'Atendimento atualizado.');}
 catch(error){toast(error.message||'Não foi possível atualizar. Reabra os detalhes e tente novamente.');}
 finally{buttons.forEach(button=>button.disabled=false);}
}
async function saveRecoveryNotes(form){await recoveryUpdate('note',String(new FormData(form).get('notes')||'').trim());}
async function openRecoveryWhatsapp(button){
 if(!canManageRecovery()||!recoverySelected)return;
 const message=document.querySelector('#recovery-message')?.value.trim();if(!message||message.length>4000)return toast('Revise a mensagem antes de abrir a conversa.');
 // Open from the user's click, then revalidate consent/conversion/ownership on the server.
 const popup=window.open('about:blank','_blank');if(!popup)return toast('Permita abrir uma nova aba para continuar no WhatsApp.');
 popup.opener=null;button.disabled=true;
 try {const row=await recoveryRpc('update_checkout_recovery',{p_id:recoverySelected.id,p_action:'opened',p_revision:recoverySelected.revision,p_notes:''});recoverySelected=row;
  const phone=normalizeRegistrationPhone(row.phone).replace(/^\+/,'');if(!phone||!recoveryCanContact(row))throw Error('Este atendimento não está mais disponível para contato.');
  popup.location.replace('https://wa.me/'+phone+'?text='+encodeURIComponent(message));
  renderRecoveryDetail();const field=document.querySelector('#recovery-message');if(field)field.value=message;toast('Conversa aberta. Registre o contato após enviar a mensagem.');
 }catch(error){popup.close();toast(error.message||'Não foi possível abrir o atendimento. Atualize os detalhes.');}finally{button.disabled=false;}
}

// Deliberately small draft payload: no CPF, password, full address, payment/card details or Meta identifiers.
function recoveryCaptureEligible(){return booted&&routePath()==='/loja/checkout'&&!new URLSearchParams(location.search).has('storePreview')&&db.cart.length>0;}
function recoveryIdentity(){
 let value=safeJson(localStore.getItem(recoveryStorageKey),null);
 if(!value||!recoveryUuidPattern.test(value.id)||!recoveryUuidPattern.test(value.secret)||!Number.isFinite(value.created)||!Number.isSafeInteger(value.sequence)||value.sequence<0||value.sequence>=1000000||Date.now()-value.created>30*86400000){value={id:crypto.randomUUID(),secret:crypto.randomUUID(),sequence:0,created:Date.now()};localStore.setItem(recoveryStorageKey,JSON.stringify(value));}
 return value;
}
function recoveryDraft(form,phase){
 const phone=normalizeRegistrationPhone(form.elements.namedItem('phone')?.value);if(!phone)return null;
 const field=name=>String(form.elements.namedItem(name)?.value||'').trim();
 return {phone,firstName:field('firstName').slice(0,60),lastName:field('lastName').slice(0,60),email:field('email').slice(0,254),
  consent:form.elements.namedItem('recoveryConsent')?.checked===true,delivery:field('delivery'),
  locality:[field('neighborhood'),field('city')].filter(Boolean).join(' · ').slice(0,120),
  phase:phase||(!field('email')?'contact':field('paymentMethodId')?'payment':field('city')?'delivery':'contact'),
  items:db.cart.slice(0,30).map(item=>({id:item.id,qty:item.qty,options:item.options||{}}))};
}
function scheduleRecoveryCapture(event){
 const form=event?.target?.closest?.('form');if(!recoveryCaptureEligible()||!form?.querySelector('[data-recovery-consent]'))return;
 // CPF/address/card edits are not serialized; they can only advance the coarse progress label.
 recoveryTouched=true;const phone=normalizeRegistrationPhone(form.elements.namedItem('phone')?.value);
 const checkbox=form.elements.namedItem('recoveryConsent');
 if(event.target.name==='phone'&&recoveryConsentChoice?.phone!==phone&&checkbox)checkbox.checked=false;
 if(event.target.name==='recoveryConsent'){recoveryConsentChoice={phone,allowed:checkbox.checked};sessionStore.setItem('forte-recovery-choice',JSON.stringify(recoveryConsentChoice));}
 clearTimeout(recoverySaveTimer);
 recoverySaveTimer=setTimeout(()=>saveCheckoutRecovery(form),event.target.name==='recoveryConsent'&&!checkbox.checked?0:event.type==='focusout'?250:2500);
}
async function saveCheckoutRecovery(form,phase='',final=false,leaving=false){
 const allowedCapture=recoveryCaptureEligible()||leaving&&booted&&db.cart.length>0&&!new URLSearchParams(location.search).has('storePreview');
 if(!allowedCapture||!recoveryTouched||!form?.isConnected)return;
 const data=recoveryDraft(form,phase);if(!data)return;
 const serialized=JSON.stringify(data),now=Date.now();if(serialized===recoveryLastPayload&&now-recoveryLastSentAt<60000)return;
 if(recoverySaving){recoverySaveAgain=true;return;}
 const previous=safeJson(recoveryLastPayload,null),consentChanged=previous&&data.consent!==previous.consent;
 if(!final&&!consentChanged&&now-recoveryLastSentAt<12000){clearTimeout(recoverySaveTimer);recoverySaveTimer=setTimeout(()=>saveCheckoutRecovery(form,phase),12000-(now-recoveryLastSentAt));return;}
 recoverySaving=true;
 try {const identity=recoveryIdentity();identity.sequence=Number(identity.sequence||0)+1;localStore.setItem(recoveryStorageKey,JSON.stringify(identity));
  const response=await fetch(backendUrl+'/functions/v1/checkout-recovery',{method:'POST',headers:{apikey:backendKey,'Content-Type':'application/json'},body:JSON.stringify({...identity,data,website:form.elements.namedItem('recoveryWebsite')?.value||''}),keepalive:final,credentials:'omit',cache:'no-store'});
  if(response.ok){recoveryLastPayload=serialized;recoveryLastSentAt=now;if(!db.cart.length)discardCheckoutRecovery(identity);}
 }catch{/* Optional recovery must never prevent a genuine checkout. */}
 finally{recoverySaving=false;if(recoverySaveAgain){recoverySaveAgain=false;clearTimeout(recoverySaveTimer);recoverySaveTimer=setTimeout(()=>saveCheckoutRecovery(form),12000);}}
}
const checkoutPageBeforeRecovery=checkoutPage;
checkoutPage=()=>{
 let html=checkoutPageBeforeRecovery();if(!db.cart.length||new URLSearchParams(location.search).has('storePreview'))return html;
 const privacy=(db.pages||[]).find(page=>page.policyKey==='privacy'&&page.active!==false);
 const phone=normalizeRegistrationPhone(checkoutContact()?.phone),choice=recoveryConsentChoice||safeJson(sessionStore.getItem('forte-recovery-choice'),null);
 const optin=`<div class="checkout-recovery-help full"><label class="recovery-check"><input type="checkbox" name="recoveryConsent" data-recovery-consent ${phone&&choice?.phone===phone&&choice.allowed?'checked':''}><span>Quero receber ajuda pelo WhatsApp se não concluir este pedido.<small>Opcional. Você pode comprar normalmente sem autorizar o contato.</small></span></label></div>`;
 html=html.replace(/(<label class="field\s*">Telefone \/ WhatsApp<input[^>]*><\/label>)/,'$1'+optin);
 html=html.replace('<h2 style="margin-bottom:23px">Seus dados</h2>','<h2 style="margin-bottom:12px">Seus dados</h2><p class="checkout-recovery-notice">Enquanto você preenche, salvamos seus contatos e produtos por até 30 dias para facilitar a retomada. '+(privacy?'<a href="/loja/pagina/'+privacy.id+'" target="_blank" rel="noopener noreferrer">Política de privacidade</a>.':'Você escolhe se deseja ajuda pelo WhatsApp.')+'</p><label class="recovery-honeypot" aria-hidden="true">Website<input name="recoveryWebsite" type="text" tabindex="-1" autocomplete="off"></label>');
 return html;
};
function resetCheckoutRecovery(){clearTimeout(recoverySaveTimer);localStore.removeItem(recoveryStorageKey);sessionStore.removeItem('forte-recovery-choice');recoveryTouched=false;recoveryLastPayload='';recoveryLastSentAt=0;recoveryConsentChoice=null;}
async function discardCheckoutRecovery(identity=safeJson(localStore.getItem(recoveryStorageKey),null)){
 if(!identity?.id||new URLSearchParams(location.search).has('storePreview'))return;
 if(safeJson(localStore.getItem(recoveryStorageKey),null)?.id===identity.id)resetCheckoutRecovery();
 try{await fetch(backendUrl+'/functions/v1/checkout-recovery',{method:'POST',headers:{apikey:backendKey,'Content-Type':'application/json'},body:JSON.stringify({...identity,sequence:Number(identity.sequence||0)+1,data:{cancel:true}}),keepalive:true,credentials:'omit',cache:'no-store'});}catch{}
}
document.addEventListener('input',scheduleRecoveryCapture);
document.addEventListener('change',scheduleRecoveryCapture);
document.addEventListener('focusout',scheduleRecoveryCapture);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'){const form=document.querySelector('form:has([data-recovery-consent])');if(form)saveCheckoutRecovery(form,'',true);}
});
window.addEventListener('pagehide',()=>{const form=document.querySelector('form:has([data-recovery-consent])');if(form)saveCheckoutRecovery(form,'',true);});

// Shared links restore cart contents only after a deliberate click; current prices always win.
function recoveryResumeMarkup(){
 return `<div class="store-content recovery-resume"><section class="card pad"><span class="recovery-resume-kicker">SEU CARRINHO, DE NOVO COM VOCÊ</span><h1>Vamos continuar de onde parou?</h1><p>Confira os produtos e retome sua compra com os valores e opções disponíveis agora.</p>${recoveryResumeLoading?'<div class="recovery-empty" role="status">Conferindo seu carrinho…</div>':recoveryResumeError?'<div class="notice">'+esc(recoveryResumeError)+'</div><a class="btn primary" href="/loja">Continuar na loja</a>':recoveryResume?.items?.length?'<div class="recovery-resume-items">'+recoveryResume.items.map(item=>{const product=db.products.find(product=>product.id===item.id);return product?recoveryItemMarkup({...item,...product,qty:item.qty,options:item.options,price:salePrice(product)}):'';}).join('')+'</div><button class="btn primary" onclick="resumeRecoveryCart()">Retomar compra</button><small>Frete e condições de pagamento são conferidos no checkout. Seus dados pessoais não são compartilhados neste link.</small>':''}</section></div>`;
}
async function loadRecoveryResume(token){
 recoveryResumeKey=token;recoveryResumeLoading=true;recoveryResumeError='';recoveryResume=null;
 render();
 try {if(!/^[0-9a-f-]{36}$/i.test(token))throw Error();const response=await fetch(backendUrl+'/rest/v1/rpc/resume_checkout_recovery',{method:'POST',headers:requestHeaders(),body:JSON.stringify({p_token:token}),cache:'no-store'});const result=await backendJson(response);
  if(token!==recoveryResumeKey)return;if(!result?.items?.length)throw Error();recoveryResume=result;
 }catch{if(token===recoveryResumeKey)recoveryResumeError='Este carrinho não está mais disponível. Ele pode ter sido concluído ou o link expirou. Você pode continuar comprando normalmente na loja.';}
 finally{if(token===recoveryResumeKey){recoveryResumeLoading=false;if(routePath().startsWith('/loja/recuperar/'))render();}}
}
function resumeRecoveryCart(confirmed=false){
 if(!recoveryResume?.items?.length)return;
 if(db.cart.length&&!confirmed){modal('Retomar este carrinho','<p>Você já tem produtos no carrinho deste dispositivo. Ao retomar, eles serão substituídos pelos produtos deste link.</p><div class="form-actions"><button class="btn" onclick="closeModal()">Manter meu carrinho</button><button class="btn primary" onclick="resumeRecoveryCart(true)">Substituir e continuar</button></div>');return;}
 const result=[];let changed=false;
 for(const item of recoveryResume.items){const product=db.products.find(product=>product.id===item.id&&product.active);if(!product){changed=true;continue;}
  const options={};for(const option of productVariations(product)){if(option.values.includes(item.options?.[option.name]))options[option.name]=item.options[option.name];else if(option.values.length===1)options[option.name]=option.values[0];else changed=true;}
  const already=result.filter(line=>line.id===product.id).reduce((sum,line)=>sum+line.qty,0);
  const qty=Math.max(0,Math.min(20,Number(item.qty)||1,available(product.id)-already));if(!qty){changed=true;continue;}if(qty!==item.qty)changed=true;
  const previous=result.find(line=>line.id===product.id&&JSON.stringify(line.options)===JSON.stringify(options));if(previous){previous.qty=Math.min(20,previous.qty+qty);changed=true;}else result.push({id:product.id,qty,options});
 }
 if(!result.length)return toast('Os produtos deste carrinho estão indisponíveis no momento. Confira outras opções na loja.');
 db.cart=result;localStore.setItem(cartStorageKey,JSON.stringify(result));if(typeof clearCheckoutBumps==='function')clearCheckoutBumps();resetCheckoutRecovery();closeModal();go('/loja/checkout');toast(changed?'Carrinho retomado. Confira quantidades e opções atualizadas.':'Carrinho retomado. Confira seus dados para continuar.');
}
const renderStoreBeforeRecovery=renderStore;
renderStore=()=>{if(routePath().startsWith('/loja/recuperar/')){document.querySelector('#app').innerHTML='<div class="store">'+storeHeader()+recoveryResumeMarkup()+storeFooter()+'</div>';document.title='Retomar carrinho · '+(db.settings.name||'Forte Outlet');return;}return renderStoreBeforeRecovery();};
navigation.push(['abandoned-checkouts','Carrinhos abandonados','bag']);
const adminPageBeforeRecovery=adminPage;
adminPage=page=>page==='abandoned-checkouts'?recoveryPageMarkup():adminPageBeforeRecovery(page);
const renderBeforeRecovery=render;
render=()=>{
 const oldCheckout=document.querySelector('form:has([data-recovery-consent])');
 if(oldCheckout&&routePath()!=='/loja/checkout')saveCheckoutRecovery(oldCheckout,'',true,true);
 const result=renderBeforeRecovery();
 if(!db.cart.length&&recoveryLastPayload)discardCheckoutRecovery();
 if(!canManageRecovery()){recoveryRows=[];recoverySummary={};recoverySelected=null;recoveryLoaded=false;recoveryRequest++;}
 if(onRecoveryPage()){if(!recoveryLoaded&&!recoveryLoading)loadRecoveryQueue();if(!recoveryPoll)recoveryPoll=setInterval(()=>{if(document.visibilityState!=='hidden'&&!document.querySelector('#modal')?.open&&!document.activeElement?.matches('input,textarea,select'))loadRecoveryQueue();},60000);}
 else {clearInterval(recoveryPoll);recoveryPoll=0;recoveryLoaded=false;recoveryRequest++;recoveryLoading=false;}
 if(routePath().startsWith('/loja/recuperar/')){const token=routePath().split('/')[3]||'';if(recoveryResumeKey!==token&&!new URLSearchParams(location.search).has('storePreview'))loadRecoveryResume(token);}
 return result;
};
