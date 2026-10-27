// Pickup logistics are independent from payment and delivery routes.
let pickupSearch = '', pickupDayFilter = '';
const canManagePickups = () => isOwner && allowed('pickups') && ['master','admin'].includes(currentProfile?.role) && !isDeliveryDriverView();
const pickupStage = order => order.status === 'delivered' ? 'done' : order.pickupReadyAt ? 'waiting' : 'prepare';
const pickupOrders = () => canManagePickups() ? visibleOrders().filter(order => order.delivery === 'Retirada' && order.status !== 'cancelled') : [];
const pickupNoticePhone = order => normalizeRegistrationPhone(order.phone).replace(/^\+/, '');
function pickupNoticeMessage(order) {
  const name = String(order.firstName || order.customer || 'cliente').trim();
  return `Olá, ${name}! Seu pedido #${order.id} já está pronto para retirada na ${db.settings.name || 'nossa loja'}.\n\nLocal de retirada: ${db.settings.address || 'consulte nossa equipe para confirmar o endereço'}.\n\n${order.paid ? 'Pagamento confirmado. Traga um documento de identificação e o número do pedido.' : `Valor a pagar na retirada: ${money(orderTotal(order))}. Forma de pagamento: ${order.payment || 'conforme combinado no pedido'}. Traga um documento de identificação e o número do pedido.`}\n\nPor favor, combine com nossa equipe o melhor horário para retirar. Até já!`;
}
function pickupCard(order) {
  const stage = pickupStage(order);
  return `<article class="delivery-order pickup-order"><div class="delivery-order-head"><a href="/app/orders/${order.id}"><strong>Pedido #${order.id}</strong></a><span class="badge ${order.paid ? 'green' : 'yellow'}">${order.paid ? 'Pago' : 'Pagamento pendente'}</span></div>
    <h3>${esc(order.customer)}</h3><p class="subtle">${esc(orderMoment(order))}</p>
    <div class="pickup-card-items">${(order.items || []).map(item => `<div>${orderItemVisual(item)}<small>${item.qty} un.</small></div>`).join('')}</div>
    <div class="total-line"><span>${order.paid ? 'Total pago' : 'A receber'}</span><strong>${money(orderTotal(order))}</strong></div>
    ${order.pickupReadyAt ? `<p class="pickup-stamp">Pronto em ${esc(momentLabel(order.pickupReadyAt))}</p>` : ''}
    ${order.pickupNotifiedAt ? `<p class="pickup-stamp">Aviso registrado em ${esc(momentLabel(order.pickupNotifiedAt))}</p>` : ''}
    ${stage === 'done' ? `<p class="pickup-stamp">Retirado em ${esc(momentLabel(order.deliveredAt))}</p>` : ''}
    <div class="delivery-card-actions">
    ${stage === 'prepare' ? button('Pronto para retirada', `onclick="pickupReadyModal(${order.id})"`, 'small primary', 'check') : ''}
    ${stage === 'waiting' ? button(order.pickupNotifiedAt ? 'Reenviar aviso' : 'Avisar pelo WhatsApp', `onclick="pickupNoticeModal(${order.id})"`, 'small'+(!order.pickupNotifiedAt?' primary':''), 'phone') : ''}
    ${stage === 'waiting' && order.pickupNotifiedAt && !order.paid && canPay() ? button('Confirmar pagamento', `onclick="paymentModal(${order.id})"`, 'small primary','wallet') : ''}
    ${stage === 'waiting' && order.pickupNotifiedAt && order.paid ? button('Concluir retirada', `onclick="dispatchOrder(${order.id})"`, 'small primary','check') : ''}
    <a class="btn small" href="/app/orders/${order.id}" aria-label="Acompanhar pedido ${order.id}">Ver pedido</a><a class="btn small" href="/imprimir/${order.id}" aria-label="Imprimir pedido ${order.id}">${icon('print')}Imprimir</a></div></article>`;
}
function pickupsPage() {
  if (!canManagePickups()) return heading('Acesso restrito', 'Seu perfil não tem acesso às retiradas.');
  const orders = pickupOrders().filter(order => (!pickupDayFilter || order.deliveryDate === pickupDayFilter) && matchesSearch(`${order.id} #${order.id} ${order.customer} ${order.phone || ''} ${(order.items || []).map(item=>item.name).join(' ')}`, pickupSearch))
    .sort((a,b)=>String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')) || Number(b.id)-Number(a.id));
  return heading('Retiradas', 'Prepare os pedidos, avise o cliente e acompanhe a retirada na loja.') +
    `<section class="card delivery-filters pickup-filters"><label class="field pickup-search">Buscar pedido ou cliente<input type="search" value="${esc(pickupSearch)}" placeholder="Nome, pedido, telefone ou produto" data-section-search="pickups" oninput="updateSectionSearch(this,'pickups')"></label><label class="field">Data agendada para retirada<input type="date" value="${esc(pickupDayFilter)}" onchange="pickupDayFilter=this.value;render()"></label>${button('Limpar filtros', "onclick=\"pickupSearch='';pickupDayFilter='';render()\"",'small')}</section>
    <div class="delivery-lanes pickup-lanes">${[['prepare','A preparar','Separe e confira os itens do pedido.'],['waiting','Aguardando retirada','Avise o cliente e aguarde sua chegada.'],['done','Retirada concluída','Pagamento e saída confirmados.']].map(([key,title,detail])=>{
      const rows = orders.filter(order=>pickupStage(order)===key);
      return `<section class="delivery-lane ${key}"><div class="delivery-lane-title"><h2>${title}</h2><span aria-label="${rows.length} pedidos">${rows.length}</span></div><p class="pickup-lane-description">${detail}</p>${rows.map(pickupCard).join('') || '<div class="pickup-empty">'+icon(key==='done'?'check':'box')+'<p>Nenhum pedido nesta etapa.</p></div>'}</section>`;
    }).join('')}</div>`;
}
function pickupReadyModal(id) {
  const order = workflowOrder(id);
  if (!canManagePickups() || !order || order.delivery !== 'Retirada' || !['pending','ready'].includes(order.status) || order.pickupReadyAt) return;
  modal('Confirmar pedido pronto para retirada', `<form onsubmit="event.preventDefault();commitPickupReady(${id},this)"><p>Os itens do pedido <strong>#${id}</strong>, de <strong>${esc(order.customer)}</strong>, estão separados e conferidos?</p><p class="subtle pickup-modal-help">O pedido passará para “Aguardando retirada”. Depois, avise o cliente pelo WhatsApp. O estoque será atualizado apenas ao concluir a retirada.</p><div class="form-actions">${button('Voltar','type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar pedido pronto</button></div></form>`);
}
async function commitPickupReady(id, form) {
  if (!canManagePickups()) return;
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try { await performOrderAction(id,'pickup_ready'); closeModal(); render(); toast('Pedido pronto. Avise o cliente pelo WhatsApp.'); }
  catch(error) { toast(error.message); } finally { submit.disabled = false; }
}
function pickupNoticeModal(id) {
  const order = workflowOrder(id);
  if (!canManagePickups() || !order?.pickupReadyAt || order.delivery !== 'Retirada' || ['cancelled','delivered'].includes(order.status)) return;
  const phone = pickupNoticePhone(order);
  modal('Avisar cliente da retirada', `<form onsubmit="event.preventDefault();confirmPickupNotice(${id},this)"><div class="pickup-notice-recipient">${icon('phone')}<div><strong>${esc(order.customer)}</strong><small>${esc(phone ? formatBrazilPhone(phone) : 'Telefone inválido ou não informado')}</small></div></div>
    ${!phone ? '<p class="inline-notice">Corrija o telefone em “Editar dados” do pedido para abrir o WhatsApp.</p>' : ''}
    <label class="field">Mensagem para o cliente<textarea name="message" rows="8" maxlength="2000" minlength="10" required oninput="updatePickupNoticeLink(this.form,${id})">${esc(pickupNoticeMessage(order))}</textarea></label>
    ${phone ? `<a class="btn pickup-whatsapp" data-pickup-whatsapp href="https://wa.me/${phone}?text=${encodeURIComponent(pickupNoticeMessage(order))}" target="_blank" rel="noopener noreferrer">${icon('external')}Abrir WhatsApp</a>` : ''}
    <p class="subtle pickup-modal-help">O WhatsApp abre com o texto preenchido. Envie a mensagem por lá e confirme abaixo. O sistema registra a confirmação da equipe, sem verificar entrega ou leitura da mensagem.</p>
    <label class="pickup-notice-confirm"><input name="sent" type="checkbox" required ${!phone?'disabled':''}>Confirmo que enviei este aviso ao cliente.</label>
    <div class="form-actions">${button('Voltar','type="button" onclick="closeModal()"')}<button class="btn primary" ${!phone?'disabled':''}>Registrar aviso</button></div></form>`);
}
function updatePickupNoticeLink(form,id) {
  const link=form.querySelector('[data-pickup-whatsapp]'),order=workflowOrder(id),phone=order&&pickupNoticePhone(order);
  if(link&&phone)link.href='https://wa.me/'+phone+'?text='+encodeURIComponent(form.elements.namedItem('message').value);
  const sent=form.elements.namedItem('sent');if(sent)sent.checked=false;
}
async function confirmPickupNotice(id,form) {
  if(!canManagePickups() || !form.elements.namedItem('sent')?.checked) return;
  const submit=form.querySelector('button:not([type])');submit.disabled=true;
  try {
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/confirm_pickup_notice',{method:'POST',body:JSON.stringify({p_order_id:id,p_message:form.elements.namedItem('message').value.trim()})},true);
    await refreshOperationalState();closeModal();render();toast('Aviso de retirada registrado.');
  } catch(error) {toast(error.message);} finally {submit.disabled=false;}
}
const orderStepsBeforePickups=orderSteps;
orderSteps=(order,driver=false)=>{
  if(order.delivery!=='Retirada')return orderStepsBeforePickups(order,driver);
  const cancelled=order.status==='cancelled',done=order.status==='delivered',ready=Boolean(order.pickupReadyAt)||done,notified=Boolean(order.pickupNotifiedAt)||done,may=canManagePickups();
  const steps=[
    {title:'Pedido recebido',done:true,detail:'Retirada na loja'},
    {title:'Pronto para retirada',done:ready,detail:order.pickupReadyAt?momentLabel(order.pickupReadyAt):'Separe e confira todos os itens.',available:may,action:`pickupReadyModal(${order.id})`,label:'Pronto para retirada'},
    {title:'Avisar o cliente',done:notified,detail:order.pickupNotifiedAt?'Envio confirmado pela equipe em '+momentLabel(order.pickupNotifiedAt):'Envie a mensagem personalizada pelo WhatsApp.',available:may&&ready,action:`pickupNoticeModal(${order.id})`,label:'Avisar pelo WhatsApp'},
    {title:'Confirmar pagamento',done:Boolean(order.paid),detail:order.paid?momentLabel(order.paidAt):'Confira o recebimento e anexe o comprovante.',available:may&&ready&&notified&&canPay(),action:`paymentModal(${order.id})`,label:'Confirmar pagamento'},
    {title:'Concluir retirada',done,detail:done?momentLabel(order.deliveredAt):'Confirme a entrega dos itens ao cliente.',available:may&&ready&&notified&&order.paid,action:`dispatchOrder(${order.id})`,label:'Concluir retirada'}
  ];
  return `<section class="card pad order-workflow pickup-workflow"><div class="workflow-heading"><span class="task-symbol">${icon('store')}</span><div><h2>Etapas da retirada</h2><p class="subtle">${cancelled?'Pedido cancelado':'Da preparação até a saída na loja.'}</p></div></div><ol class="order-steps">${steps.map((step,index)=>`<li class="order-step ${step.done?'done':step.available&&!cancelled?'current':'locked'}"><span class="order-step-number">${step.done?'✓':index+1}</span><div><h3>${step.title}</h3><p>${esc(step.detail)}</p>${!step.done&&!cancelled?(step.available?button(step.label,`onclick="${step.action}"`,'small primary'):'<span class="step-waiting">Conclua a etapa anterior com a equipe responsável.</span>'):''}${index===2&&notified&&!done&&!cancelled&&may?button('Reenviar aviso',`onclick="pickupNoticeModal(${order.id})"`,'small'):''}</div></li>`).join('')}</ol></section>`;
};
const paymentModalBeforePickups=paymentModal;
paymentModal=id=>{const order=workflowOrder(id);if(order?.delivery==='Retirada'&&(!order.pickupReadyAt||!order.pickupNotifiedAt))return toast('Marque o pedido como pronto e registre o aviso ao cliente antes do pagamento.');return paymentModalBeforePickups(id);};
const dispatchBeforePickups=dispatchOrder;
dispatchOrder=id=>{const order=workflowOrder(id);if(order?.delivery==='Retirada'&&(!order.pickupReadyAt||!order.pickupNotifiedAt))return toast('Conclua a preparação e o aviso ao cliente antes da retirada.');return dispatchBeforePickups(id);};
