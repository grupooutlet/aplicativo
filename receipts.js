// One document for individual orders and the daily delivery printout.
function receiptPaymentStatus(order){
 if(order.status==='cancelled')return {key:'cancelled',label:'CANCELADO',detail:'Pedido cancelado · não realizar cobrança ou entrega'};
 if(order.paid===true)return {key:'paid',label:'PAGO',detail:'Pagamento confirmado'};
 return {key:'pending',label:'PENDENTE',detail:'Pagamento ainda não confirmado'};
}
function receiptDateTime(value){
 if(!value||!/[T ]\d{2}:\d{2}/.test(String(value))||Number.isNaN(Date.parse(value)))return 'Data e horário não registrados';
 return new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function receiptDay(value){return typeof validBusinessDay==='function'&&validBusinessDay(value)?value.split('-').reverse().join('/'):'A agendar';}
function receiptCpf(value){const digits=String(value||'').replace(/\D/g,'');return digits.length===11?digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):String(value||'Não informado');}
function receiptDriver(order){
 if(order.driverName)return order.driverName;
 const id=order.driver_id;if(!id)return 'Ainda não definido';
 if(currentProfile?.user_id===id||authSession?.user?.id===id)return currentProfile?.name||'Entregador';
 const driver=[...(db.team||[]),...(typeof accountProfiles!=='undefined'?accountProfiles:[])].find(person=>String(person.user_id||person.id)===String(id));
 return driver?.name||'Entregador designado';
}
function receiptLogistics(order){if(order.delivery==='Retirada'&&!['delivered','cancelled'].includes(order.status))return order.pickupReadyAt?'Aguardando retirada':'Em preparação';return ({pending:'Em preparação',ready:'Aguardando saída',transit:'Em rota de entrega',delivered:order.delivery==='Retirada'?'Retirada concluída':'Entrega concluída',cancelled:'Entrega cancelada'})[order.status]||'Em acompanhamento';}
function receiptField(label,value,extra=''){return '<div class="order-sheet-field '+extra+'"><dt>'+esc(label)+'</dt><dd>'+esc(value||'Não informado')+'</dd></div>';}
function receiptAddress(order){
 if(order.delivery==='Retirada')return '<p class="order-sheet-address">'+esc(db.settings.address||'Endereço da loja não informado')+'</p>';
 const a=orderAddressParts(order),lines=[a.street?[a.street,a.number].filter(Boolean).join(', '):'',a.complement,[a.neighborhood,[a.city,a.state].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),a.cep?'CEP '+a.cep:''].filter(Boolean);
 return '<p class="order-sheet-address">'+(lines.length?lines.map(esc).join('<br>'):esc(order.address||'Endereço não informado'))+'</p>';
}
function receiptItems(order){return (order.items||[]).map(item=>{
 const product=db.products.find(p=>p.id===item.id),service=item.stockTracked===false;
 const name=String(item.name||product?.name||'Produto'),variation=typeof optionText==='function'?optionText(item.options||{}):'';
 const extra=variation&&!name.includes(variation)?'<small>'+esc(variation)+'</small>':'';
 const rawImage=item.image||product?.image;
 const image=typeof mediaVariant==='function'?mediaVariant(rawImage,'thumb').url:typeof publicMediaUrl==='function'?publicMediaUrl(rawImage):rawImage;
 return '<tr><td class="order-sheet-sku">'+esc(service?'SERV':item.sku||product?.sku||item.id)+'</td><td><div class="order-sheet-item">'+(image&&!service?'<img src="'+esc(image)+'" width="38" height="38" alt="" onerror="this.remove()">':'')+'<div><strong>'+esc(name)+'</strong>'+extra+'</div></div></td><td class="order-sheet-qty">'+esc(item.qty)+'</td><td class="order-sheet-money">'+money(item.price)+'</td><td class="order-sheet-money"><strong>'+money(item.price*item.qty)+'</strong></td></tr>';
}).join('');}
function orderDocument(order,{deliveryNote=false,generatedAt=new Date()}={}){
 const s=db.settings,status=receiptPaymentStatus(order),created=orderCreatedParts(order),total=orderTotal(order),subtotal=(order.items||[]).reduce((sum,item)=>sum+Number(item.qty)*Number(item.price),0);
 const units=(order.items||[]).reduce((sum,item)=>sum+Number(item.qty),0),pickup=order.delivery==='Retirada',cancelled=order.status==='cancelled';
 const phone=formatBrazilPhone(s.phone),customerPhone=formatBrazilPhone(order.phone)||'Não informado';
 const host=location.hostname&&!/^(localhost|127\.|\[?::1)/.test(location.hostname)?location.hostname:'forteoutlet.com.br';
 const credit=order.paymentKind==='credit'||/cr[eé]dito/i.test(order.payment||''),count=credit?Math.max(1,Number(order.installments)||1):1;
 const installments=installmentText({...order,installments:count,total,installmentAmount:Number(order.installmentAmount)||Math.floor(total*100/count)/100,lastInstallmentAmount:Number(order.lastInstallmentAmount)||total-(Math.floor(total*100/count)/100)*(count-1)});
 const timing=order.paymentTiming||(pickup?'Na retirada':'Na entrega');
 const paymentMessage=cancelled?'Não cobrar':order.paid===true?'Valor confirmado':order.freightPending?'Valor parcial a receber':'Valor a receber';
 const restriction=typeof order.shippingRegion==='object'&&order.shippingRegion?.note?order.shippingRegion.note:'';
 const confirmations=[order.paid===true?['Pagamento',receiptDateTime(order.paidAt)]:null,order.releasedAt?['Saída',receiptDateTime(order.releasedAt)]:null,order.deliveredAt?[pickup?'Retirada':'Entrega',receiptDateTime(order.deliveredAt)]:null,order.cancelledAt?['Cancelamento',receiptDateTime(order.cancelledAt)]:null].filter(Boolean);
 return `<article class="receipt order-sheet status-${status.key}${deliveryNote?' delivery-note':''}" aria-label="Pedido ${esc(order.id)} · ${status.label}">
  <div class="order-sheet-watermark" aria-hidden="true">${status.label}</div>
  <header class="order-sheet-header"><div class="order-sheet-brand"><img src="assets/logo.webp" width="174" height="62" alt="Grupo Outlet"><div class="order-sheet-store-contact"><span>${esc(host)}</span>${phone?'<span>WhatsApp '+esc(phone)+'</span>':''}${s.email?'<span>'+esc(s.email)+'</span>':''}<span>${esc(s.address||'Endereço da loja não informado')}</span></div></div><div class="order-sheet-number"><span>Pedido de venda</span><h1>#${esc(order.id)}</h1><p>${esc(created.date)} · ${esc(created.time)}</p></div></header>
  <section class="order-sheet-status" aria-label="Situação do pedido"><div><span class="order-sheet-status-label"><i></i>${status.label}</span><p>${esc(status.detail)}</p></div><div class="order-sheet-logistics"><span>${pickup?'Retirada':'Entrega'}</span><strong>${esc(receiptLogistics(order))}</strong></div></section>
  <dl class="order-sheet-meta">${receiptField('Canal',order.channel||'Não registrado')}${receiptField('Vendedor(a)',responsibleName(order.seller||'Loja online'))}${receiptField(pickup?'Retirada agendada':'Entrega agendada',receiptDay(order.deliveryDate))}${receiptField('Entregador',pickup?'Retirada pelo cliente':receiptDriver(order))}</dl>
  <div class="order-sheet-parties"><section class="order-sheet-card"><h2>Informações do cliente</h2><strong class="order-sheet-customer">${esc(order.customer||[order.firstName,order.lastName].filter(Boolean).join(' ')||'Não informado')}</strong><dl>${receiptField('WhatsApp / telefone',customerPhone)}${receiptField('E-mail',order.email)}${receiptField('CPF',receiptCpf(order.cpf))}</dl></section><section class="order-sheet-card"><h2>${pickup?'Local de retirada':'Endereço de entrega'}</h2>${receiptAddress(order)}${!pickup&&order.shippingOptionName?'<p class="order-sheet-shipping"><b>Frete:</b> '+esc(order.shippingOptionName)+'</p>':''}${restriction?'<p class="order-sheet-restriction">'+esc(restriction)+'</p>':''}</section></div>
  <section class="order-sheet-products"><div class="order-sheet-section-head"><h2>Itens do pedido</h2><span>${order.items.length} ${order.items.length===1?'item':'itens'} · ${units} ${units===1?'unidade':'unidades'}</span></div><table><colgroup><col style="width:12%"><col style="width:46%"><col style="width:8%"><col style="width:17%"><col style="width:17%"></colgroup><thead><tr><th scope="col">Código</th><th scope="col">Produto / variação</th><th scope="col" class="order-sheet-qty">Qtd.</th><th scope="col" class="order-sheet-money">Unitário</th><th scope="col" class="order-sheet-money">Total</th></tr></thead><tbody>${receiptItems(order)}</tbody></table></section>
  <div class="order-sheet-financial"><section class="order-sheet-payment"><h2>Pagamento</h2><dl>${receiptField('Forma',order.payment||'Não informada')}${receiptField('Momento',timing)}${receiptField(credit?'Parcelamento':'Condição',installments)}</dl><div class="order-sheet-collect"><span>${paymentMessage}</span><strong>${cancelled?money(0):money(total)}</strong></div>${cancelled&&order.paid===true?'<p class="order-sheet-payment-note">Pagamento registrado antes do cancelamento. Consulte a loja sobre a restituição.</p>':''}${!cancelled&&order.freightPending?'<p class="order-sheet-payment-note">Frete a confirmar. O total final deve ser conferido com a loja.</p>':''}</section><section class="order-sheet-totals" aria-label="Resumo de valores"><dl>${receiptField('Produtos',money(subtotal))}${receiptField('Frete',order.freightPending?'A confirmar':money(Number(order.freight)||0))}${receiptField('Taxa de pagamento'+(Number(order.paymentRate)?' ('+String(order.paymentRate).replace('.',',')+'%)':''),money(Number(order.paymentFee)||0))}${receiptField(order.freightPending?'TOTAL PARCIAL':'TOTAL DO PEDIDO',money(total),'order-sheet-grand-total')}</dl></section></div>
  <section class="order-sheet-notes"><h2>Observações e orientações</h2><p>${esc(order.notes||'Nenhuma observação registrada.')}</p></section>
  ${confirmations.length?'<dl class="order-sheet-confirmations">'+confirmations.map(([title,date])=>receiptField(title,date)).join('')+'</dl>':''}
  <footer class="order-sheet-footer"><div class="order-sheet-signatures"><div><span>Assinatura do cliente / recebedor</span><small>Nome: __________________________________</small></div><div><span>Responsável pela ${pickup?'retirada':'entrega'}</span><small>Data e hora: _____________________________</small></div></div><div class="order-sheet-legal">${s.legalName||s.cnpj?'<p>'+esc(s.legalName||'')+(s.cnpj?' · CNPJ '+esc(formatStoreCnpj(s.cnpj)):'')+'</p>':''}<p>Pedido de venda · Documento não fiscal</p><small>Gerado em ${esc(receiptDateTime(generatedAt.toISOString()))} · Horário de Brasília</small></div></footer>
 </article>`;
}
renderReceipt=id=>{
 const order=visibleOrders().find(order=>order.id===id);
 if(!order){$('#app').innerHTML='<div class="empty">Pedido não encontrado.</div>';return;}
 document.title='Pedido #'+id+' · Grupo Outlet';
 $('#app').innerHTML='<div class="print-actions">'+button('Voltar ao pedido',`onclick="go('/app/orders/${Number(id)}')"`,'','back')+button('Imprimir / salvar PDF','onclick="window.print()"','primary','print')+'</div>'+orderDocument(order);
};
deliveryNote=order=>orderDocument(order,{deliveryNote:true});
