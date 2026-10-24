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
const auditFieldNames={name:'Nome',title:'Título',price:'Preço',promoPrice:'Preço promocional',cost:'Custo',active:'Ativo',stock:'Estoque',min:'Estoque mínimo',phone:'WhatsApp',email:'E-mail',address:'Endereço',addressParts:'Endereço',city:'Cidade',state:'UF',neighborhood:'Bairro',street:'Rua',number:'Número',cep:'CEP',note:'Observação',content:'Conteúdo',role:'Tipo de perfil',position:'Cargo',paid:'Pagamento confirmado',status:'Status',deliveryDate:'Data da entrega',freight:'Frete',description:'Descrição',shippingOptions:'Fretes',paymentMethods:'Pagamentos',categories:'Coleções',category:'Coleção',sort:'Ordenação',enabled:'Visível',items:'Itens',receipt:'Comprovante',created_at:'Cadastro',updated_at:'Atualização'};
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
