// Store editing is shared with sellers. Audit records and reversal remain management-only.
let siteWriteBusy=false;
function storeConfigSnapshot(){return Object.fromEntries(['name','phone','address','addressParts'].filter(key=>Object.hasOwn(db.settings,key)).map(key=>[key,structuredClone(db.settings[key])]));}
async function persistSiteSection(section,value,expected,{form,close=false,message='Alterações salvas.'}={}){
  if(!isOwner||!canConfigureSite()||siteWriteBusy)return false;
  siteWriteBusy=true;const submit=form?.querySelector('button[type="submit"],button:not([type])');if(submit)submit.disabled=true;
  const baseline=structuredClone(expected??null);let committed=false;
  try{
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/save_site_section',{method:'POST',body:JSON.stringify({p_section:section,p_value:value,p_expected:baseline})},true);
    committed=true;await loadAdminState();if(close)closeModal();render();toast(message);return true;
  }catch(error){toast(committed?'Alteração salva. Atualize a página antes de continuar.':catalogSaveError(error));return false;}
  finally{siteWriteBusy=false;if(submit)submit.disabled=false;}
}
savePage=async(form,id)=>{
  if(!canConfigureSite())return;
  const fields=Object.fromEntries(new FormData(form)),next=structuredClone(db.pages);
  const page={title:String(fields.title||'').trim(),content:String(fields.content||'').trim(),active:fields.active==='true'};
  if(!page.title||page.title.length>160||!page.content||page.content.length>50000)return toast('Informe o título e um conteúdo de até 50 mil caracteres.');
  if(id){const existing=next.find(p=>p.id===id);if(!existing)return toast('Esta página foi removida. Atualize a lista.');Object.assign(existing,page);}
  else next.push({...page,id:Math.max(Date.now(),...next.map(p=>Number(p.id)+1))});
  return persistSiteSection('pages',next,db.pages,{form,close:true,message:'Página salva na loja.'});
};

const auditAreas={products:'Produtos',orders:'Pedidos',movements:'Estoque',collections:'Coleções',collectionSettings:'Coleções',orderBumps:'Order Bumps',attributeCatalog:'Variações',storefront:'Loja online',navigation:'Menus',pages:'Páginas',shippingOptions:'Fretes',paymentMethods:'Pagamentos',settings:'Configurações',profiles:'Equipe e perfis',customer_contacts:'Clientes',team:'Equipe'};
const canSeeChangeHistory=()=>isOwner&&canManage()&&['master','admin'].includes(currentProfile?.role);
const modalBeforeChangeHistory=modal;
modal=(...args)=>{document.querySelector('#modal')?.classList.remove('audit-detail-dialog');return modalBeforeChangeHistory(...args);};
let auditRows=[],auditLoading=false,auditLoaded=false,auditError='',auditArea='',auditQuery='',auditBefore=null,auditNext=null,auditCursors=[],auditSerial=0,auditReverting=false;
function auditTime(value){return value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}):'—';}
function auditStatus(row){return row.reverted_at?'Revertida':row.reversal_of?'Reversão registrada':'Registrada';}
function historyRowsMarkup(){
  if(auditLoading)return '<div class="empty" role="status">Carregando histórico…</div>';
  if(auditError)return `<div class="empty"><p>${esc(auditError)}</p>${button('Tentar novamente','onclick="loadChangeHistory()"')}</div>`;
  if(!auditRows.length)return '<div class="empty"><h3>Nenhuma alteração neste filtro</h3><p>As alterações realizadas a partir da ativação deste histórico aparecem aqui automaticamente.</p></div>';
  return `<div class="table-wrap"><table class="change-history-table"><thead><tr><th>Data e horário</th><th>Responsável</th><th>Alteração</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${auditRows.map(row=>`<tr><td class="audit-date">${esc(auditTime(row.created_at))}</td><td><strong>${esc(row.actor_name)}</strong><small>${esc(row.actor_position||row.actor_role||'Sistema')}</small></td><td><strong>${esc(row.summary)}</strong><small>${row.areas.map(area=>esc(auditAreas[area]||area)).join(' · ')} · ${row.change_count} registro(s)</small></td><td><span class="badge ${row.reverted_at?'gray':'green'}">${auditStatus(row)}</span>${row.reverted_at?`<small>${esc(row.reverted_by_name||'Gestão')} · ${esc(auditTime(row.reverted_at))}</small>`:''}</td><td>${button('Ver alterações',`onclick="changeHistoryDetail(${row.id})"`,'small','eye')}</td></tr>`).join('')}</tbody></table></div><div class="audit-pagination"><span>Página ${auditCursors.length+1}</span><div class="actions">${button('Anterior',`onclick="previousChangeHistory()" ${auditCursors.length?'':'disabled'}`,'small')}${button('Próxima',`onclick="nextChangeHistory()" ${auditNext?'':'disabled'}`,'small')}</div></div>`;
}
function changeHistoryPage(){
  if(!canSeeChangeHistory())return heading('Acesso restrito','O histórico é reservado à conta principal e aos gerentes.');
  return heading('Histórico de alterações','Acompanhe o que mudou, quem alterou e restaure uma versão anterior.',button('Atualizar','onclick="loadChangeHistory()"'))+`<section class="card pad"><div class="audit-history-note">Cada ação mantém o responsável e os dados anteriores. Reversões também ficam registradas no histórico.</div><div class="audit-filters"><form onsubmit="event.preventDefault();filterChangeHistory(this)"><label class="field">Buscar por responsável ou alteração<input name="query" type="search" value="${esc(auditQuery)}" placeholder="Nome, produto, página ou configuração"></label><label class="field">Área<select name="area"><option value="">Todas as áreas</option>${Object.entries(auditAreas).filter(([key])=>!['collectionSettings','team'].includes(key)).map(([key,name])=>`<option value="${key}" ${key===auditArea?'selected':''}>${name}</option>`).join('')}</select></label><button class="btn" type="submit">Filtrar</button></form></div><div id="change-history-results">${historyRowsMarkup()}</div></section>`;
}
function refreshHistoryRows(){const target=document.querySelector('#change-history-results');if(target)target.innerHTML=historyRowsMarkup();}
async function loadChangeHistory(){
  if(!canSeeChangeHistory())return;
  const serial=++auditSerial;auditLoading=true;auditError='';refreshHistoryRows();
  try{const result=await backendRequest('/rest/v1/rpc/list_change_history',{method:'POST',body:JSON.stringify({p_before:auditBefore,p_area:auditArea||null,p_query:auditQuery||null})},true);if(serial!==auditSerial||!canSeeChangeHistory())return;auditRows=(result.entries||[]).map(row=>({...row,actor_role:({master:'Principal',admin:'Equipe',customer:'Cliente',driver:'Entregador',system:'Sistema'})[row.actor_role]||row.actor_role}));auditNext=result.next_cursor||null;auditLoaded=true;}
  catch(error){if(serial===auditSerial)auditError=catalogSaveError(error);}
  finally{if(serial===auditSerial){auditLoading=false;refreshHistoryRows();}}
}
function filterChangeHistory(form){const fields=Object.fromEntries(new FormData(form));auditArea=fields.area;auditQuery=String(fields.query||'').trim().slice(0,120);auditBefore=null;auditCursors=[];loadChangeHistory();}
function nextChangeHistory(){if(!auditNext||auditLoading)return;auditCursors.push(auditBefore);auditBefore=auditNext;loadChangeHistory();}
function previousChangeHistory(){if(!auditCursors.length||auditLoading)return;auditBefore=auditCursors.pop();loadChangeHistory();}
const auditFieldNames={name:'Nome',title:'Título',price:'Preço',promoPrice:'Preço promocional',cost:'Custo',active:'Ativo',stock:'Estoque',min:'Estoque mínimo',phone:'WhatsApp',email:'E-mail',address:'Endereço',addressParts:'Endereço',city:'Cidade',state:'UF',neighborhood:'Bairro',street:'Rua',number:'Número',cep:'CEP',note:'Observação',notes:'Observações do pedido',notesUpdatedAt:'Observação atualizada em',content:'Conteúdo',role:'Tipo de perfil',position:'Cargo',paid:'Pagamento confirmado',status:'Status',deliveryDate:'Data da entrega',freight:'Frete',description:'Descrição',shippingOptions:'Fretes',paymentMethods:'Pagamentos',categories:'Coleções',category:'Coleção',sort:'Ordenação',enabled:'Visível',items:'Itens',receipt:'Comprovante',created_at:'Cadastro',updated_at:'Atualização'};
function auditValue(value){
  if(value===undefined)return 'Não existia';if(value===null)return 'Sem valor';if(typeof value==='boolean')return value?'Sim':'Não';
  if(typeof value==='string'&&value.startsWith('data:image/'))return 'Comprovante / imagem anexada';
  const text=typeof value==='object'?JSON.stringify(value,null,2):String(value);
  return text.length>1600?text.slice(0,1600)+'…':text;
}
function auditFieldDiff(before,after,prefix='',depth=0){
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(depth<3&&(before&&typeof before==='object'||after&&typeof after==='object')&&!Array.isArray(before)&&!Array.isArray(after))return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].flatMap(key=>auditFieldDiff(before?.[key],after?.[key],[prefix,auditFieldNames[key]||key].filter(Boolean).join(' → '),depth+1));
  return [{name:prefix||'Registro',before:auditValue(before),after:auditValue(after)}];
}
async function changeHistoryDetail(id){
  if(!canSeeChangeHistory())return;
  try{
    const row=await backendRequest('/rest/v1/rpc/change_history_detail',{method:'POST',body:JSON.stringify({p_id:id})},true);
    const changes=row.changes.map(change=>{const before=change.beforeExists?change.before:undefined,after=change.afterExists?change.after:undefined;const differences=auditFieldDiff(before,after);return `<section class="audit-change"><h3>${esc(change.label)}</h3>${differences.slice(0,80).map(diff=>`<div class="audit-diff"><strong>${esc(diff.name)}</strong><div><small>Antes</small><pre>${esc(diff.before)}</pre></div><div><small>Depois</small><pre>${esc(diff.after)}</pre></div></div>`).join('')}${differences.length>80?'<p class="subtle">Há outros campos neste registro.</p>':''}</section>`;}).join('');
    modal('Detalhes da alteração',`<div class="audit-detail-heading"><strong>${esc(row.actor_name)}</strong><span>${esc(auditTime(row.created_at))}</span><p>${esc(row.summary)}</p></div><div class="audit-detail-changes">${changes}</div>${row.reverted_at?`<p class="audit-history-note">Revertida por ${esc(row.reverted_by_name)} em ${esc(auditTime(row.reverted_at))}.</p>`:row.revert_reason?`<p class="audit-history-note">${esc(row.revert_reason)}</p>`:''}<div class="form-actions">${button('Fechar','onclick="closeModal()"')}${row.can_revert?button('Reverter esta alteração',`onclick="confirmHistoryReversal(${id})"`,'danger'):''}</div>`);
    document.querySelector('#modal')?.classList.add('audit-detail-dialog');
  }catch(error){toast(catalogSaveError(error));}
}
function confirmHistoryReversal(id){if(!canSeeChangeHistory()||auditReverting)return;modal('Reverter alteração',`<p>Restaurar os dados anteriores desta ação?</p><p class="subtle" style="margin-top:12px">Se algum registro foi alterado novamente, a reversão será interrompida para preservar as mudanças mais recentes. Esta reversão também ficará registrada.</p><form onsubmit="event.preventDefault();revertHistoryChange(${id},this)"><div class="form-actions">${button('Voltar',`type="button" onclick="changeHistoryDetail(${id})"`)}<button class="btn danger" type="submit">Confirmar reversão</button></div></form>`);}
async function revertHistoryChange(id,form){
  if(!canSeeChangeHistory()||auditReverting)return;auditReverting=true;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try{await settleAdminWrites();await backendRequest('/rest/v1/rpc/revert_change_history',{method:'POST',body:JSON.stringify({p_id:id})},true);await loadAdminState();menusBaseline=null;menusDraft=null;collectionSortDraft=null;closeModal();auditLoaded=false;auditBefore=null;auditCursors=[];await loadChangeHistory();render();toast('Alteração revertida. A reversão foi registrada no histórico.');}
  catch(error){toast(catalogSaveError(error));}finally{auditReverting=false;submit.disabled=false;}
}
navigation.push(['change-history','Histórico de alterações','calendar']);
const adminPageBeforeHistory=adminPage;
adminPage=page=>page==='change-history'?changeHistoryPage():adminPageBeforeHistory(page);
const renderBeforeHistory=render;
render=()=>{const result=renderBeforeHistory();if(!canSeeChangeHistory()){auditRows=[];auditLoaded=false;auditLoading=false;auditSerial++;}else if(routePath()!=='/app/change-history')auditLoaded=false;else if(!auditLoaded&&!auditLoading)loadChangeHistory();return result;};

function editOrderNotes(id){
  const order=visibleOrders().find(item=>item.id===id);if(!order||!canEditOrderNotes())return;
  modal('Observações do pedido #'+id,`<form data-order-id="${id}" onsubmit="event.preventDefault();saveOrderNotes(this,${id})"><input type="hidden" name="expectedNotes" value="${esc(order.notes||'')}"><label class="field">Observação<textarea name="notes" maxlength="5000" rows="6" placeholder="Ex.: referência do endereço ou detalhe combinado com o cliente.">${esc(order.notes||'')}</textarea><small>Esta observação ficará disponível para a equipe no pedido. A alteração será registrada no histórico.</small></label><div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary" type="submit">Salvar observação</button></div></form>`);
}
async function saveOrderNotes(form,id){
  const order=visibleOrders().find(item=>item.id===id);if(!order||!canEditOrderNotes())return;
  const fields=new FormData(form),notes=String(fields.get('notes')||'').trim(),expected=String(fields.get('expectedNotes')||'');
  if(notes.length>5000)return toast('Use até 5.000 caracteres na observação.');
  if(notes===String(order.notes||'')){closeModal();return toast('Nenhuma alteração na observação.');}
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;let committed=false;
  try{
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/save_order_notes',{method:'POST',body:JSON.stringify({p_order_id:id,p_notes:notes,p_expected_notes:expected})},true);committed=true;
    await loadAdminState();closeModal();render();toast('Observação do pedido atualizada.');
  }catch(error){if(committed)closeModal();toast(committed?'Observação salva. Atualize a página para carregar a versão mais recente.':catalogSaveError(error));}
  finally{submit.disabled=false;}
}

// One confirmation surface for published business changes; form drafts stay in place.
let activeBusinessConfirmation=null;
function resolveBusinessConfirmation(accepted){
  const pending=activeBusinessConfirmation;if(!pending)return;
  activeBusinessConfirmation=null;pending.dialog.close();pending.focus?.focus?.({preventScroll:true});pending.resolve(Boolean(accepted));
}
function confirmBusinessChange(spec){
  if(activeBusinessConfirmation)return Promise.resolve(false);
  let dialog=document.querySelector('#business-confirmation');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='business-confirmation';dialog.className='business-confirmation';document.body.appendChild(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();resolveBusinessConfirmation(false)});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)resolveBusinessConfirmation(false)});
  }
  dialog.setAttribute('aria-labelledby','business-confirm-title');dialog.setAttribute('aria-describedby','business-confirm-description');
  dialog.innerHTML=`<div class="business-confirm-heading"><span class="business-confirm-symbol ${spec.danger?'danger':''}">${icon(spec.danger?'trash':'shield')}</span><button aria-label="Fechar confirmação" onclick="resolveBusinessConfirmation(false)">×</button></div><h2 id="business-confirm-title">${esc(spec.title||'Confirmar alteração')}</h2><p id="business-confirm-description">${esc(spec.description||'Você confirma esta alteração?')}</p>${spec.details?.length?`<dl class="business-confirm-details">${spec.details.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}${spec.impact?`<p class="business-confirm-impact">${esc(spec.impact)}</p>`:''}<small class="business-confirm-audit">As alterações realizadas ficam registradas no histórico com o responsável.</small><div class="business-confirm-actions"><button class="btn" autofocus onclick="resolveBusinessConfirmation(false)">Voltar e revisar</button><button class="btn ${spec.danger?'danger':'primary'}" onclick="resolveBusinessConfirmation(true)">${esc(spec.confirmLabel||'Sim, confirmar')}</button></div>`;
  const focus=document.activeElement;
  return new Promise(resolve=>{activeBusinessConfirmation={dialog,resolve,focus};dialog.showModal();dialog.querySelector('[autofocus]')?.focus()});
}
const businessActionRules={
 saveProduct:['Salvar produto','Os preços, o estoque e a apresentação deste produto serão atualizados.'],
 saveCollection:['Salvar coleção','O nome, a visibilidade ou a ordenação desta coleção serão atualizados na loja.'],
 toggleCollection:['Alterar visibilidade da coleção','A disponibilidade desta coleção na loja será alterada.'],
 saveCollectionProducts:['Alterar produtos da coleção','A lista de produtos desta coleção será atualizada.'],
 removeCollectionProduct:['Remover produto da coleção','O produto será mantido no catálogo e nas demais coleções.'],
 saveCollectionOrder:['Salvar ordem dos produtos','A nova ordem será aplicada na coleção publicada.'],
 saveOrderBump:['Salvar oferta','A oferta e os produtos em que ela aparece no checkout serão atualizados.'],
 toggleOrderBump:['Alterar disponibilidade da oferta','A exibição desta oferta no checkout será alterada.'],
 'storefront.publish':['Publicar mudanças da loja','A loja publicada será atualizada com o conteúdo do rascunho.'],
 saveMenus:['Publicar menus','Os links e a organização dos menus da loja serão atualizados.'],
 savePage:['Salvar página','O conteúdo e a visibilidade desta página serão atualizados na loja.'],
 saveShippingOption:['Salvar região de entrega','A cobertura e o valor de frete desta região serão aplicados aos novos pedidos.'],
 toggleFreight:['Alterar região de entrega','A disponibilidade desta região no checkout será alterada.'],
 savePaymentMethod:['Salvar forma de pagamento','O título, a disponibilidade e as taxas configuradas serão aplicados no checkout.'],
 togglePaymentMethod:['Alterar forma de pagamento','As opções disponíveis aos clientes no checkout serão atualizadas.'],
 saveSettings:['Salvar configurações da loja','Os dados da loja usados no site e nos pedidos serão atualizados.'],
 saveStock:['Confirmar movimentação de estoque','A quantidade disponível para novas vendas será alterada e a movimentação ficará registrada.'],
 saveAttribute:['Salvar atributo','O catálogo compartilhado de atributos será atualizado para os próximos cadastros.'],
 claimDriverDelivery:['Assumir entrega','Este pedido será atribuído a você na rota de entregas.'],
 createAdminOrder:['Criar pré-venda','O pedido será criado e as unidades dos produtos serão reservadas.'],
 scheduleDelivery:['Confirmar agendamento','A data de entrega e a modalidade de frete deste pedido serão atualizadas.'],
 saveOrderData:['Alterar dados do pedido','As informações do cliente, da entrega e as observações deste pedido serão atualizadas.'],
 saveOrderNotes:['Salvar observação do pedido','A observação ficará disponível para a equipe no pedido.'],
 promoteCustomer:['Alterar acesso à equipe','O cargo e o acesso administrativo deste perfil serão atualizados.'],
 saveTeam:['Alterar integrante da equipe','Os dados e as permissões desta pessoa serão atualizados.'],
 applyBulkCatalog:['Alterar produtos selecionados','A alteração será aplicada a todos os produtos selecionados.']
};
function businessActionRule(handler,element){
  const matches=String(handler||'').matchAll(/\b([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)?)\s*\(/g);
  for(const match of matches){
    const rule=Object.hasOwn(businessActionRules,match[1])?businessActionRules[match[1]]:null;if(!rule)continue;
    if(match[1]==='applyBulkCatalog'&&/['"]delete['"]/.test(handler))return null; // The deletion dialog already confirms it.
    const form=element.tagName==='FORM'?element:element.form||element.closest?.('form');
    const fields=form?new FormData(form):null;
    if(match[1]==='saveOrderNotes'&&String(fields?.get('notes')||'').trim()===String(fields?.get('expectedNotes')||''))return null;
    const details=[],name=fields?.get('name')||fields?.get('title')||element.closest?.('.attribute-card')?.querySelector('.attribute-name-input')?.value;
    if(name)details.push(['Registro',String(name).slice(0,250)]);
    const numbers=[...String(handler).matchAll(/(?:\(|,)\s*(\d+)\s*(?=[,)])/g)].map(item=>Number(item[1])),index=numbers[0];
    if(['toggleCollection','saveCollectionProducts','removeCollectionProduct'].includes(match[1])&&db.collections[index])details.push(['Coleção',db.collections[index]]);
    if(match[1]==='removeCollectionProduct'){const product=db.products.find(item=>item.id===numbers[1]);if(product)details.push(['Produto',product.name]);}
    if(match[1]==='saveCollectionOrder'&&collectionSortDraft?.name)details.push(['Coleção',collectionSortDraft.name]);
    if(match[1]==='toggleOrderBump'&&db.orderBumps?.[index])details.push(['Oferta',db.orderBumps[index].title]);
    if(match[1]==='toggleFreight'&&allShippingOptions()[index])details.push(['Região',allShippingOptions()[index].name]);
    if(match[1]==='togglePaymentMethod'&&paymentMethods()[index])details.push(['Pagamento',paymentMethods()[index].title]);
    if(match[1]==='scheduleDelivery'){details.push(['Pedido','#'+(index||'')]);if(fields?.get('deliveryDate'))details.push(['Data',deliveryDateLabel(fields.get('deliveryDate'))]);}
    if(match[1]==='saveStock'){const product=db.products.find(item=>item.id===Number(fields?.get('product')));if(product)details.push(['Produto',product.name]);}

    if(['saveOrderData','saveOrderNotes'].includes(match[1]))details.push(['Pedido','#'+(form?.dataset.orderId||routePath().split('/')[3]||'')]);
    if(match[1]==='saveOrderNotes')details.push(['Nova observação',String(fields?.get('notes')||'').trim().slice(0,800)||'Remover a observação atual']);
    if(['saveProduct','saveShippingOption'].includes(match[1])&&fields?.get('price'))details.push(['Preço',money(Number(fields.get('price')))]);
    if(match[1]==='applyBulkCatalog')details.push(['Produtos selecionados',String(catalogSelection.size)]);
    if(match[1]==='promoteCustomer')details.push(['Novo cargo',String(fields?.get('position')||'Equipe')]);
    if(match[1]==='saveStock')details.push(['Movimentação',(fields?.get('type')==='out'?'Saída':'Entrada')+' de '+String(fields?.get('qty')||'')+' unidade(s)']);
    return {title:rule[0],description:'Você confirma esta alteração?',impact:rule[1],details,confirmLabel:match[1]==='storefront.publish'||match[1]==='saveMenus'?'Sim, publicar':'Sim, confirmar'};
  }
  return null;
}
function businessActionFingerprint(element){
  const form=element.tagName==='FORM'?element:element.form||element.closest?.('form');
  return JSON.stringify(form?[...form.querySelectorAll('input,select,textarea')].map(input=>[input.name||input.className||input.id,input.type==='file'?[...input.files].map(file=>[file.name,file.size,file.lastModified]):input.value,input.checked]):[element.getAttribute('onclick'),element.checked]);
}
const approvedBusinessEvents=new WeakSet();
async function guardBusinessEvent(event){
  if(!routePath().startsWith('/app')||!['master','admin','driver'].includes(currentProfile?.role))return;
  const element=event.type==='submit'?event.target:event.type==='change'?event.target:event.target.closest?.('button,input[type="button"],input[type="submit"]');
  if(!element)return;
  if(approvedBusinessEvents.has(element)){approvedBusinessEvents.delete(element);return;}
  const attribute=event.type==='submit'?'onsubmit':event.type==='change'?'onchange':'onclick',handler=element.getAttribute(attribute),spec=businessActionRule(handler,element);
  if(!spec)return;
  event.preventDefault();event.stopImmediatePropagation();
  const checked=event.type==='change'&&element.type==='checkbox'?element.checked:null;
  if(checked!==null)element.checked=!checked;
  const fingerprint=businessActionFingerprint(element),version=stateVersion,submitter=event.submitter;
  if(!await confirmBusinessChange(spec))return;
  if(!element.isConnected||element.getAttribute(attribute)!==handler||businessActionFingerprint(element)!==fingerprint||stateVersion!==version)return toast('A tela ou os dados mudaram. Revise a alteração antes de confirmar novamente.');
  approvedBusinessEvents.add(element);
  try{
    if(event.type==='submit')element.requestSubmit(submitter?.isConnected?submitter:undefined);
    else if(event.type==='change'){if(checked!==null)element.checked=checked;element.dispatchEvent(new Event('change',{bubbles:true}));}
    else element.click();
  }finally{approvedBusinessEvents.delete(element);}
}
for(const type of ['click','submit','change'])document.addEventListener(type,guardBusinessEvent,true);
// Existing operational dialogs already form their own explicit confirmation step.
const modalBeforeBusinessConfirmations=modal;
modal=(title,html)=>{
  if(routePath().startsWith('/app')&&/^(Excluir|Cancelar pedido|Confirmar|Liberar para entrega|Liberar pedidos|Reverter alteração)/.test(title))html=`<div class="business-confirm-intro">${icon('shield')}<span>Você confirma esta ação? Confira os dados abaixo antes de continuar.</span></div>`+html;
  return modalBeforeBusinessConfirmations(title,html);
};
