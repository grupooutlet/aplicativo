// Catalog membership is independent from product visibility and shared across the shop and editor.
const productCollections = product => [...new Set((Array.isArray(product?.categories) ? product.categories : product?.category ? [product.category] : []).filter(Boolean))];
const collectionConfig = name => db.collectionSettings?.[name] || {};
const visibleCollections = () => db.collections.filter(name => collectionConfig(name).active !== false);
const productInCollection = (product, name) => productCollections(product).includes(name);
const collectionSortOptions=[['manual','Livre · ordem manual'],['price_asc','Preço crescente'],['price_desc','Preço decrescente'],['title_asc','Ordem alfabética · A–Z'],['title_desc','Ordem alfabética · Z–A']];
function sortedCollectionProducts(products, mode='manual', order=[]) {
  const ranks=new Map(order.map((id,index)=>[Number(id),index]));
  const title=(a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'})||a.id-b.id;
  return products.slice().sort((a,b)=>mode==='price_asc'?salePrice(a)-salePrice(b)||title(a,b):mode==='price_desc'?salePrice(b)-salePrice(a)||title(a,b):mode==='title_asc'?title(a,b):mode==='title_desc'?title(b,a):(ranks.get(a.id)??1e9)-(ranks.get(b.id)??1e9));
}
function collectionProducts(name, activeOnly = false) {
  if (activeOnly && name !== 'Todos' && !visibleCollections().includes(name)) return [];
  const products = db.products.filter(p => (!activeOnly || p.active) && (name === 'Todos' || productInCollection(p, name)));
  const order = name === 'Todos' ? [] : collectionConfig(name).productIds || [];
  return sortedCollectionProducts(products,name==='Todos'?'manual':collectionConfig(name).sort||'manual',order);
}
function assignProductCollections(product, names) { product.categories=[...new Set(names)]; product.category=product.categories[0] || ''; }
let catalogSelection = new Set(), collectionSearch = '', collectionSortDraft = null;
let catalogWriteBusy = false;
function remapCollectionListSections(model,previous,name=null){
  for(const section of model.storefront?.sections||[]){
    if(section.type!=='collection-list')continue;
    section.items=(section.items||[]).flatMap(item=>item.category!==previous?[item]:name?[{...item,category:name}]:[]);
  }
}
function applyCollectionEdit(model,previous,name,active,sort,ids=null) {
  model.collectionSettings||={};
  const config={...(model.collectionSettings[previous]||{}),active,sort};
  if(ids!==null)config.productIds=ids.slice();
  if(previous){
    const index=model.collections.indexOf(previous);if(index<0)throw new Error('Esta coleção não existe mais. Atualize a página.');
    model.collections[index]=name;
    if(previous!==name){
      delete model.collectionSettings[previous];
      for(const product of model.products)if(product.category===previous||productInCollection(product,previous)){product.categories=productCollections(product).map(c=>c===previous?name:c);if(product.category===previous)product.category=name;}
      for(const section of model.storefront?.sections||[])if(section.type==='collection'&&section.category===previous)section.category=name;
      remapCollectionListSections(model,previous,name);
      if(model.storefront?.pageSettings?.['collection:'+previous]){model.storefront.pageSettings['collection:'+name]=model.storefront.pageSettings['collection:'+previous];delete model.storefront.pageSettings['collection:'+previous];}
      if(model.navigation)for(const menu of model.navigation.menus)remapMenuCollection(menu.items,previous,name);
    }
  }else model.collections.push(name);
  model.collectionSettings[name]=config;
}
function catalogSaveError(error){return error instanceof TypeError||/Failed to fetch|NetworkError|fetch failed/i.test(error.message)?'Não foi possível conectar ao servidor. Suas alterações foram mantidas nesta tela. Tente salvar novamente.':error.message;}
async function commitCollectionEdit(previous,name,active,sort,ids=null) {
  if(!canConfigureSite())throw new Error('Você não tem permissão para editar coleções.');
  if(catalogWriteBusy)throw new Error('Aguarde a alteração em andamento.');
  if(!name||name.length>100||db.collections.some(c=>c!==previous&&c.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))throw new Error('Informe um nome único para a coleção.');
  catalogWriteBusy=true;
  try{
    await settleAdminWrites();
    const next=structuredClone(db);applyCollectionEdit(next,previous,name,active,sort,ids);
    const result=await backendRequest('/rest/v1/rpc/save_collection',{method:'POST',body:JSON.stringify({p_previous:previous||null,p_name:name,p_active:active,p_sort:sort,p_product_ids:ids,p_expected_version:stateVersion})},true);
    applyCollectionEdit(db,previous,name,active,sort,ids);stateVersion=result.version;
    delete next.cart;savedState=JSON.stringify(next);
    if(catalogCategory===previous)catalogCategory=name;
  }finally{catalogWriteBusy=false;}
}
const catalogChangeKeys = ['products','collections','collectionSettings','orderBumps','attributeCatalog','nextProductId','storefront'];
async function commitCatalogChanges(mutate) {
  if (!canConfigureSite() || catalogWriteBusy) throw new Error('Aguarde a alteração em andamento.');
  catalogWriteBusy=true;
  try {
    await settleAdminWrites();
    const next=structuredClone(db); mutate(next);
    const changes=Object.fromEntries(catalogChangeKeys.filter(key=>JSON.stringify(next[key])!==JSON.stringify(db[key])).map(key=>[key,next[key]]));
    if (!Object.keys(changes).length) return;
    await backendRequest('/rest/v1/rpc/save_catalog',{method:'POST',body:JSON.stringify({p_changes:changes,p_expected_version:stateVersion})},true);
    await loadAdminState();
    catalogSelection=new Set([...catalogSelection].filter(id=>db.products.some(p=>p.id===id)));
  } finally { catalogWriteBusy=false; }
}
function filteredCatalogProducts() {
  return db.products.filter(p => productMatchesStatus(p) && (p.name+' '+p.sku+' '+productCollections(p).join(' ')).toLocaleLowerCase('pt-BR').includes(productQuery.toLocaleLowerCase('pt-BR')));
}
function selectCatalogProduct(id, checked) { checked?catalogSelection.add(id):catalogSelection.delete(id); updateCatalogSelectionBar(); }
function selectVisibleCatalog(checked) { filteredCatalogProducts().forEach(p=>checked?catalogSelection.add(p.id):catalogSelection.delete(p.id)); render(); }
function updateCatalogSelectionBar() {
  const bar=$('#catalog-bulk-bar'); if(bar)bar.innerHTML=catalogBulkBar();
  const all=$('#catalog-select-all'),products=filteredCatalogProducts();
  if(all){all.checked=products.length>0&&products.every(p=>catalogSelection.has(p.id));all.indeterminate=!all.checked&&products.some(p=>catalogSelection.has(p.id));}
}
function catalogBulkBar() { return catalogSelection.size?`<strong>${catalogSelection.size} selecionado${catalogSelection.size===1?'':'s'}</strong><div class="actions"><button class="btn small" onclick="bulkCatalogModal('collections')">${icon('layers')}Adicionar a coleções</button><button class="btn small" onclick="bulkCatalogModal('draft')">Tornar rascunho</button><button class="btn small" onclick="bulkCatalogModal('active')">Ativar</button><button class="btn small danger" onclick="bulkCatalogModal('delete')">${icon('trash')}Excluir</button><button class="text-link" onclick="catalogSelection.clear();render()">Limpar seleção</button></div>`:''; }
productsPage = () => {
  const products=filteredCatalogProducts(),manage=canManage();
  return heading('Produtos','Organize seu catálogo e mantenha sua loja sempre atualizada.',manage?button('Adicionar produto','onclick="productModal()"','primary','plus'):'')+
  `<section class="card catalog-workspace"><div class="toolbar catalog-toolbar"><form class="search" onsubmit="event.preventDefault();productQuery=this.q.value;render()">${icon('search')}<input name="q" value="${esc(productQuery)}" placeholder="Buscar por nome, SKU ou coleção" aria-label="Buscar produtos"><button aria-label="Buscar">${icon('chevron')}</button></form><label class="catalog-status-filter"><span>Exibir</span><select class="control" aria-label="Filtrar produtos" onchange="productStatusFilter=this.value;render()">${[['all','Todos os produtos'],['active','Ativos'],['draft','Rascunhos']].map(([value,label])=>`<option value="${value}" ${productStatusFilter===value?'selected':''}>${label}</option>`).join('')}</select></label><span class="catalog-count">${products.length} produtos</span></div>
  ${manage?`<div id="catalog-bulk-bar" class="catalog-bulk-bar">${catalogBulkBar()}</div>`:''}<div class="tablewrap"><table class="catalog-table"><thead><tr>${manage?`<th class="catalog-check"><input id="catalog-select-all" type="checkbox" aria-label="Selecionar todos os produtos exibidos" ${products.length&&products.every(p=>catalogSelection.has(p.id))?'checked':''} onchange="selectVisibleCatalog(this.checked)"></th>`:''}<th>Produto</th><th>Status</th><th>Estoque</th><th>Coleções</th><th>Preço</th><th>Ações</th></tr></thead><tbody>${products.map(p=>`<tr>${manage?`<td class="catalog-check"><input type="checkbox" aria-label="Selecionar ${esc(p.name)}" ${catalogSelection.has(p.id)?'checked':''} onchange="selectCatalogProduct(${p.id},this.checked)"></td>`:''}<td><div class="product-cell"><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt="" loading="lazy"><div><span class="product-title" title="${esc(p.name)}">${esc(p.name)}</span><small>${esc(p.sku)}</small></div></div></td><td><span class="badge ${p.active?'green':'gray'}">${p.active?'Ativo':'Rascunho'}</span>${productReviewNote(p)?`<small class="product-review-note">${esc(productReviewNote(p))}</small>`:''}</td><td>${p.stock} un.</td><td><div class="collection-tags">${productCollections(p).map(name=>`<span>${esc(name)}</span>`).join('')||'<small>Sem coleção</small>'}</div></td><td>${priceMarkup(p)}</td><td><div class="actions">${manage?button('Editar',`onclick="productModal(${p.id})"`,'small'):''}${p.active?`<a class="btn small icon-button" href="/loja/produto/${p.id}" target="_blank" rel="noopener noreferrer" aria-label="Visualizar ${esc(p.name)}">${icon('eye')}</a>`:''}${manage?button('',`onclick="deleteProduct(${p.id})" aria-label="Excluir ${esc(p.name)}"`,'small danger icon-button','trash'):''}</div></td></tr>`).join('')||`<tr><td colspan="7" class="empty">Nenhum produto encontrado.</td></tr>`}</tbody></table></div></section>`;
};
function collectionCheckboxes(names=[],fieldName='categories') { return `<div class="collection-checkboxes">${db.collections.map(name=>`<label><input type="checkbox" name="${fieldName}" value="${esc(name)}" ${names.includes(name)?'checked':''}><span>${esc(name)}${collectionConfig(name).active===false?'<small>Desativada</small>':''}</span></label>`).join('')||'<p class="subtle">Cadastre uma coleção na seção Coleções.</p>'}</div>`; }
function bulkCatalogModal(action, ids=[...catalogSelection]) {
  if(!canManage()||!ids.length)return;
  const labels={collections:'Adicionar a coleções',draft:'Tornar rascunho',active:'Ativar produtos',delete:'Excluir produtos'};
  modal(labels[action],`<form onsubmit="event.preventDefault();applyBulkCatalog(this,'${action}',${JSON.stringify(ids)})"><p>${action==='delete'?'Excluir':'Alterar'} <strong>${ids.length} produto${ids.length===1?'':'s'}</strong>${action==='delete'?'? A exclusão não poderá ser desfeita pelo painel.':'.'}</p>${action==='collections'?collectionCheckboxes([], 'bulkCollections'):''}<div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn ${action==='delete'?'danger':'primary'}">${action==='delete'?'Excluir produtos':'Confirmar alteração'}</button></div></form>`);
}
async function applyBulkCatalog(form,action,ids) {
  const submit=form.querySelector('button:not([type])');submit.disabled=true;
  try {
    const names=new FormData(form).getAll('bulkCollections');if(action==='collections'&&!names.length)throw new Error('Selecione pelo menos uma coleção.');
    await commitCatalogChanges(next=>{
      if(action==='delete'){
        next.products=next.products.filter(p=>!ids.includes(p.id));
        next.orderBumps=(next.orderBumps||[]).filter(b=>b.kind!=='product'||!ids.includes(b.productId)).map(b=>({...b,targetProductIds:b.targetProductIds.filter(id=>!ids.includes(id))})).map(b=>({...b,active:b.active&&(b.allProducts||b.targetProductIds.length>0)}));
        for(const cfg of Object.values(next.collectionSettings||{}))if(cfg.productIds)cfg.productIds=cfg.productIds.filter(id=>!ids.includes(id));
      } else for(const p of next.products.filter(p=>ids.includes(p.id))) {
        if(action==='collections')assignProductCollections(p,[...productCollections(p),...names]);
        else p.active=action==='active';
      }
    });
    catalogSelection.clear();closeModal();render();toast(action==='delete'?'Produtos excluídos.':'Produtos atualizados.');
  }catch(error){toast(error.message);submit.disabled=false;}
}
deleteProduct = id => bulkCatalogModal('delete',[id]);

const modalBeforeCatalog = modal;
modal = (title,html) => { $('#modal').classList.remove('catalog-product-dialog','catalog-offer-dialog');modalBeforeCatalog(title,html); };
productModal = id => {
  if(!canManage())return;
  const p=db.products.find(item=>item.id===id)||{name:'',description:'',sku:'',price:'',promoPrice:'',cost:0,stock:0,min:3,active:false,categories:[]};
  draftImages=productImages(p).slice();
  modal(id?'Editar produto':'Novo produto',`<form class="product-editor" onsubmit="event.preventDefault();saveProduct(this,${id||0})"><div class="product-editor-layout"><div class="product-editor-main">
  <section class="product-editor-section"><div class="section-caption">${icon('box')}<div><h3>Informações do produto</h3><p>Nome, código e apresentação na loja.</p></div></div><div class="product-identity-grid">${field('Nome do produto','name',p.name,'text','required')}${field('SKU / código','sku',p.sku,'text','maxlength="60" placeholder="Automático"')}</div><label class="field">Descrição<textarea name="description" required placeholder="Descreva os detalhes, materiais e medidas do produto.">${esc(p.description)}</textarea></label></section>
  <section class="product-editor-section"><div class="section-caption">${icon('image')}<div><h3>Fotos do produto</h3><p>A primeira foto será a capa da loja.</p></div></div><label class="product-upload"><span>${icon('plus')}Enviar fotos</span><input name="photos" type="file" accept="image/png,image/jpeg,image/webp" multiple><small>Até ${Math.max(maxPhotos,draftImages.length)} fotos · até 7 MB cada · JPG, PNG ou WebP</small></label><div id="draft-gallery">${draftGallery()}</div></section>
  <section class="product-editor-section"><div class="section-caption">${icon('wallet')}<div><h3>Preços</h3><p>Configure o valor de venda e uma promoção opcional.</p></div></div><div class="product-price-grid">${field('Preço de venda (R$)','price',p.price,'number','min="0.01" step="0.01" required')}${field('Preço promocional (R$)','promoPrice',p.promoPrice||'','number','min="0" step="0.01" placeholder="Opcional"')}${field('Custo do produto (R$)','cost',p.cost,'number','min="0" step="0.01" required')}</div>${p.importInfo?.costPending?'<small class="subtle">Confira o custo de aquisição deste produto importado.</small>':''}</section>
  <section class="product-editor-section"><div class="section-caption">${icon('store')}<div><h3>Estoque</h3><p>Os ajustes serão sincronizados com o estoque.</p></div></div><div class="form-grid">${field('Quantidade em estoque','stock',p.stock,'number','min="0" step="1" required')}${field('Alerta de estoque mínimo','min',p.min,'number','min="0" step="1" required')}</div></section>
  <section class="product-editor-section">${variationEditor(p)}</section></div><aside class="product-editor-aside"><section class="product-editor-section"><h3>Publicação</h3><label class="field">Status<select name="active"><option value="true" ${p.active?'selected':''}>Ativo na loja</option><option value="false" ${!p.active?'selected':''}>Rascunho</option></select></label><p class="subtle">Rascunhos ficam disponíveis apenas no painel.</p></section><section class="product-editor-section"><h3>Coleções</h3><p class="subtle">Selecione todas as coleções em que este produto deve aparecer.</p>${collectionCheckboxes(productCollections(p))}</section></aside></div><div class="product-editor-footer"><span>As alterações serão publicadas após salvar.</span><div class="actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary product-save">Salvar produto</button></div></div></form>`);
  $('#modal').classList.add('catalog-product-dialog');
};
saveProduct = async (form,id) => {
  if(!canManage())return;
  const submit=form.querySelector('.product-save');submit.disabled=true;
  try {
    const fields=new FormData(form),f=Object.fromEntries(fields),previous=db.products.find(p=>p.id===id);
    const files=Array.from(form.elements.namedItem('photos').files),limit=Math.max(maxPhotos,productImages(previous).length);
    if(draftImages.length+files.length>limit)throw new Error(`O limite deste produto é de ${limit} fotos.`);
    if(files.some(file=>file.size>maxPhotoBytes||!['image/jpeg','image/png','image/webp'].includes(file.type)))throw new Error('Envie fotos JPG, PNG ou WebP de até 7 MB.');
    if(f.active==='true'&&!draftImages.length&&!files.length)throw new Error('Envie uma foto antes de ativar o produto.');
    const variations=readVariationEditor(form),price=Number(f.price),promoPrice=f.promoPrice?Number(f.promoPrice):null,cost=Number(f.cost),stock=Number(f.stock),min=Number(f.min);
    if(!(price>0)||!Number.isFinite(cost)||cost<0||(promoPrice!==null&&!(promoPrice>0&&promoPrice<price)))throw new Error('Confira os preços do produto.');
    if(!Number.isInteger(stock)||!Number.isInteger(min)||stock<0||min<0)throw new Error('Informe quantidades inteiras de estoque.');
    const images=draftImages.slice();for(const file of files)images.push(await uploadProductPhoto(file));
    await commitCatalogChanges(next=>{
      const current=next.products.find(p=>p.id===id);if(id&&!current)throw new Error('O produto não está mais disponível.');
      const newId=id||Math.max(Number(next.nextProductId)||1,...next.products.map(p=>p.id+1));
      const sku=String(f.sku||'').trim()||`GO-${String(newId).padStart(5,'0')}`;
      if(next.products.some(p=>p.id!==newId&&p.sku.toLowerCase()===sku.toLowerCase()))throw new Error('Já existe um produto com esse SKU.');
      const product={...(current||{}),id:newId,name:f.name.trim(),description:f.description.trim(),sku,price,promoPrice,cost,stock,min,active:f.active==='true',images,image:images[0]||'',variations};
      assignProductCollections(product,fields.getAll('categories'));
      if(product.importInfo)product.importInfo.costPending=false;
      if(current)Object.assign(current,product);else{next.products.push(product);next.nextProductId=newId+1;}
    });
    closeModal();render();toast('Produto salvo. Catálogo e estoque atualizados.');
  }catch(error){toast(error.message);submit.disabled=false;}
};

collectionsPage = () => heading('Coleções','Organize os produtos e a ordem de exibição na sua loja.',button('Nova coleção','onclick="collectionModal()"','primary','plus'))+
 `<div class="collection-grid">${db.collections.map((name,index)=>{const products=collectionProducts(name),cover=products.find(p=>p.image)?.image;return `<a class="card collection-card collection-entry" href="/app/collections/${encodeURIComponent(name)}"><img src="${esc(cover||'assets/product-placeholder.svg')}" alt="${esc(name)}" loading="lazy"><div class="pad"><div><h2>${esc(name)}</h2><small>${products.length} produtos</small></div><span class="badge ${collectionConfig(name).active===false?'gray':'green'}">${collectionConfig(name).active===false?'Desativada':'Ativa'}</span>${icon('chevron')}</div></a>`;}).join('')}</div>`;
function collectionDetailPage(name) {
  if(!db.collections.includes(name))return heading('Coleção não encontrada','Volte para suas coleções.',`<a class="btn" href="/app/collections">Voltar</a>`);
  let products=collectionProducts(name);const draft=collectionSortDraft?.name===name;
  const mode=draft?collectionSortDraft.mode||'manual':collectionConfig(name).sort||'manual',manual=mode==='manual';
  if(draft)products=sortedCollectionProducts(products,mode,collectionSortDraft.ids);
  const index=db.collections.indexOf(name),active=collectionConfig(name).active!==false;
  return `<a class="back-link" href="/app/collections">${icon('back')}Coleções</a>`+heading(esc(name),`${products.length} produtos · ${active?'Ativa na loja':'Desativada na loja'}`,`<div class="actions">${canConfigureSite()?button('Excluir coleção',`onclick="deleteCollectionModal(${index})"`,'danger','trash'):''}${button('Editar coleção',`onclick="collectionModal(${index})"`,'','edit')}${button('Adicionar produtos',`onclick="collectionProductPicker(${index})"`,'primary','plus')}</div>`)+
  `${draft?`<div class="collection-sort-notice"><span>Nova ordem de exibição ainda não salva.</span><div class="actions">${button('Cancelar','onclick="collectionSortDraft=null;render()"','small')}${button('Salvar ordem',`onclick="saveCollectionOrder(this)"`,'small primary')}</div></div>`:''}<section class="card collection-workspace"><div class="toolbar collection-order-toolbar"><label class="collection-order-control">Organizar produtos<select class="control" aria-label="Ordenação da coleção" onchange="setCollectionSort(${index},this.value)">${collectionSortOptions.map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="collection-switch"><input type="checkbox" ${active?'checked':''} onchange="toggleCollection(${index},this.checked)">Coleção ativa</label></div><p class="collection-order-help">${manual?'Arraste os produtos ou use as setas para decidir a ordem.':'A ordem é atualizada automaticamente na loja. Para mover os produtos, selecione Livre · ordem manual.'}</p><div class="collection-product-list">${products.map((p,i)=>`<article class="collection-product-item" draggable="${manual}" ${manual?`ondragstart="dragCollectionProduct(${p.id},event)" ondragover="event.preventDefault()" ondrop="dropCollectionProduct(${index},${p.id},event)"`:''}><span class="drag-handle" aria-hidden="true">${manual?'⠿':icon('layers')}</span><span class="collection-position">${i+1}</span><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt="" loading="lazy"><div class="collection-product-name"><strong>${esc(p.name)}</strong><small>${esc(p.sku)} · ${p.active?'Ativo':'Rascunho'} · ${money(salePrice(p))}</small></div><div class="actions">${manual?`<button class="btn small icon-button" ${i===0?'disabled':''} onclick="moveCollectionProduct(${index},${p.id},-1)" aria-label="Mover ${esc(p.name)} para cima">↑</button><button class="btn small icon-button" ${i===products.length-1?'disabled':''} onclick="moveCollectionProduct(${index},${p.id},1)" aria-label="Mover ${esc(p.name)} para baixo">↓</button>`:''}${button('Remover',`onclick="removeCollectionProduct(${index},${p.id})"`,'small danger')}</div></article>`).join('')||'<div class="empty">Adicione produtos para começar esta coleção.</div>'}</div></section>`;
}
function collectionModal(index=-1) {
  if(!canConfigureSite())return;
  const name=db.collections[index]||'';
  modal(index<0?'Nova coleção':'Editar coleção',`<form onsubmit="event.preventDefault();saveCollection(this,${index})"><input type="hidden" name="previousName" value="${esc(name)}">${field('Nome da coleção','name',name,'text','required maxlength="100"')}<label class="field">Organizar produtos<select name="sort">${collectionSortOptions.map(([value,label])=>`<option value="${value}" ${(collectionConfig(name).sort||'manual')===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="check-row"><input type="checkbox" name="active" ${collectionConfig(name).active!==false?'checked':''}>Ativa na loja</label><div class="form-actions">${index>=0?button('Excluir coleção',`type="button" onclick="deleteCollectionModal(${index})"`,'danger','trash'):''}${button('Cancelar','type="button" onclick="closeModal()"')}<button type="submit" class="btn primary">Salvar coleção</button></div></form>`);
}
function deleteCollectionModal(index) {
  if(!canConfigureSite())return;
  const name=db.collections[index];if(!name)return;
  const linkedSections=(db.storefront?.sections||[]).some(section=>section.type==='collection'&&section.category===name||section.type==='collection-list'&&section.items?.some(item=>item.category===name));
  modal('Excluir coleção',`<form onsubmit="event.preventDefault();deleteCollection(this)"><input type="hidden" name="collectionName" value="${esc(name)}"><p>Excluir a coleção <strong>${esc(name)}</strong>?</p><p>Os produtos serão mantidos no catálogo e nas outras coleções. Apenas esta coleção será excluída.</p>${linkedSections?'<p>Ela será removida das listas de coleções. As seções da página inicial com produtos vinculados a ela serão desativadas.</p>':''}<div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button type="submit" class="btn danger">Excluir coleção</button></div></form>`);
}
async function deleteCollection(form) {
  if(!canConfigureSite())return;
  const name=form.elements.namedItem('collectionName').value,submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try {
    await commitCatalogChanges(next=>{
      if(!next.collections.includes(name))throw new Error('Esta coleção não existe mais. Atualize a página.');
      next.collections=next.collections.filter(collection=>collection!==name);
      for(const product of next.products)if(productInCollection(product,name))assignProductCollections(product,productCollections(product).filter(collection=>collection!==name));
      if(next.collectionSettings)delete next.collectionSettings[name];
      if(next.storefront?.pageSettings)delete next.storefront.pageSettings['collection:'+name];
      for(const section of next.storefront?.sections||[])if(section.type==='collection'&&section.category===name){section.enabled=false;section.category='Todos';}
      remapCollectionListSections(next,name);
    });
    if(collectionSortDraft?.name===name)collectionSortDraft=null;
    if(catalogCategory===name)catalogCategory='Todos';
    closeModal();go('/app/collections');toast('Coleção excluída. Os produtos foram mantidos.');
  }catch(error){toast(error.message);submit.disabled=false;}
}
saveCollection = async (form,index) => {
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try {
    const name=form.elements.namedItem('name').value.trim(),active=form.elements.namedItem('active').checked,previous=form.elements.namedItem('previousName').value,sort=form.elements.namedItem('sort').value;
    await commitCollectionEdit(previous,name,active,sort);closeModal();collectionSortDraft=null;go('/app/collections/'+encodeURIComponent(name));toast('Coleção salva.');
  }catch(error){toast(catalogSaveError(error));}finally{submit.disabled=false;}
};
async function toggleCollection(index,active) { try{const name=db.collections[index];await commitCollectionEdit(name,name,active,collectionConfig(name).sort||'manual');render();toast(active?'Coleção ativada.':'Coleção desativada.');}catch(error){toast(catalogSaveError(error));render();} }
function productPicker(selected=[],name='products') { return `<div class="product-picker"><label class="search">${icon('search')}<input placeholder="Buscar produtos por nome ou SKU" aria-label="Buscar produtos para selecionar" oninput="filterProductPicker(this)"></label><div class="product-picker-list">${db.products.map(p=>`<label class="product-picker-row" data-search="${esc((p.name+' '+p.sku).toLocaleLowerCase('pt-BR'))}"><input type="checkbox" name="${name}" value="${p.id}" ${selected.includes(p.id)?'checked':''}><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt="" loading="lazy"><span>${esc(p.name)}<small>${esc(p.sku)} · ${p.active?'Ativo':'Rascunho'}</small></span></label>`).join('')}</div></div>`; }
function filterProductPicker(input) { for(const row of input.closest('.product-picker').querySelectorAll('.product-picker-row'))row.hidden=!row.dataset.search.includes(input.value.toLocaleLowerCase('pt-BR')); }
function collectionProductPicker(index) { const name=db.collections[index];modal('Produtos da coleção',`<form onsubmit="event.preventDefault();saveCollectionProducts(this,${index})"><p>Marque os produtos que devem fazer parte de <strong>${esc(name)}</strong>.</p>${productPicker(collectionProducts(name).map(p=>p.id))}<div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary">Salvar produtos</button></div></form>`); }
async function saveCollectionProducts(form,index) {
  const submit=form.querySelector('button:not([type])');submit.disabled=true;
  try{const ids=new FormData(form).getAll('products').map(Number);await commitCatalogChanges(next=>{const name=next.collections[index];for(const p of next.products)assignProductCollections(p,ids.includes(p.id)?[...productCollections(p),name]:productCollections(p).filter(c=>c!==name));});closeModal();render();toast('Produtos da coleção atualizados.');}catch(error){toast(error.message);submit.disabled=false;}
}
async function removeCollectionProduct(index,id) { try{await commitCatalogChanges(next=>{const p=next.products.find(p=>p.id===id);assignProductCollections(p,productCollections(p).filter(c=>c!==next.collections[index]));});render();toast('Produto removido desta coleção.');}catch(error){toast(error.message);} }
function collectionDraftIds(index) { const name=db.collections[index];if(collectionSortDraft?.name!==name)collectionSortDraft={name,mode:collectionConfig(name).sort||'manual',ids:sortedCollectionProducts(collectionProducts(name),'manual',collectionConfig(name).productIds||[]).map(p=>p.id)};return collectionSortDraft.ids; }
function setCollectionSort(index,mode){if(!canConfigureSite()||!collectionSortOptions.some(([value])=>value===mode))return;collectionDraftIds(index);collectionSortDraft.mode=mode;render();}
function moveCollectionProduct(index,id,delta) { if(!canConfigureSite())return;const ids=collectionDraftIds(index);if((collectionSortDraft.mode||'manual')!=='manual')return;const position=ids.indexOf(id),to=position+delta;if(position<0||to<0||to>=ids.length)return;ids.splice(position,1);ids.splice(to,0,id);render(); }
function dragCollectionProduct(id,event) { event.dataTransfer.setData('text/plain',String(id));event.dataTransfer.effectAllowed='move'; }
function dropCollectionProduct(index,target,event) {event.preventDefault();if(!canConfigureSite())return;const id=Number(event.dataTransfer.getData('text/plain')),ids=collectionDraftIds(index);if((collectionSortDraft.mode||'manual')!=='manual')return;const position=ids.indexOf(id),to=ids.indexOf(target);if(position<0||to<0)return;ids.splice(position,1);ids.splice(to,0,id);render();}
async function saveCollectionOrder(submit) { if(!collectionSortDraft)return;if(submit)submit.disabled=true;try{const draft=structuredClone(collectionSortDraft);await commitCollectionEdit(draft.name,draft.name,collectionConfig(draft.name).active!==false,draft.mode||'manual',draft.ids);collectionSortDraft=null;render();toast('Ordem da coleção salva na loja.');}catch(error){toast(catalogSaveError(error));}finally{if(submit)submit.disabled=false;} }

const selectedBumpOffers = new Map();
function clearCheckoutBumps() { selectedBumpOffers.clear(); }
function eligibleOrderBumps() {
  const ids=db.cart.map(line=>line.id);
  if(!ids.length)return [];
  return (db.orderBumps||[]).filter(offer=>offer.active&&(offer.allProducts||offer.targetProductIds?.some(id=>ids.includes(id)))&&(offer.kind==='service'||db.products.some(p=>p.id===offer.productId&&p.active&&available(p.id)>cartQuantity(p.id))));
}
function orderBumpTotal() { return Math.round(eligibleOrderBumps().filter(b=>selectedBumpOffers.has(b.id)).reduce((sum,b)=>sum+Number(b.price),0)*100)/100; }
function selectedCheckoutBumps() {
  const quantities=new Map(db.products.map(p=>[p.id,cartQuantity(p.id)]));
  return eligibleOrderBumps().filter(b=>selectedBumpOffers.has(b.id)).map(b=>{
    const options=selectedBumpOffers.get(b.id)||{};
    if(b.kind==='product'){const qty=(quantities.get(b.productId)||0)+1;quantities.set(b.productId,qty);if(qty>available(b.productId))throw new Error('Revise as ofertas: a quantidade selecionada excede o estoque disponível.');}
    return {offerId:b.id,options:b.kind==='product'?validateProductOptions(db.products.find(p=>p.id===b.productId),options):{}};
  });
}
function orderBumpChoices() {
  const offers=eligibleOrderBumps();if(!offers.length)return '';
  return `<section class="checkout-bumps"><div class="section-caption">${icon('plus')}<div><h2>Aproveite também</h2><p>Adicione uma oferta especial ao seu pedido.</p></div></div>${offers.map((b,index)=>{const selected=selectedBumpOffers.has(b.id),p=db.products.find(p=>p.id===b.productId);return `<article class="checkout-bump ${selected?'selected':''}" data-offer-id="${esc(b.id)}"><label class="checkout-bump-choice"><input type="checkbox" ${selected?'checked':''} onchange="changeCheckoutBump(this)">${b.kind==='product'&&p?.image?`<img class="bump-offer-visual" src="${esc(p.image)}" alt="">`:`<span class="bump-offer-visual" aria-hidden="true">${icon('shield')}</span>`}<span><strong>${esc(b.title)}</strong>${b.description?`<small>${esc(b.description)}</small>`:''}<b>+ ${money(b.price)}</b></span></label>${b.kind==='product'?`<div class="bump-options">${productVariations(p).map(option=>`<label class="field">${esc(option.name)}<select data-bump-option="${esc(option.name)}" ${selected?'required':'disabled'} onchange="changeCheckoutBump(this)">${option.values.length>1?'<option value="" disabled selected>Selecione uma opção</option>':''}${option.values.map(value=>`<option value="${esc(value)}" ${option.values.length===1||selectedBumpOffers.get(b.id)?.[option.name]===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`).join('')}</div>`:''}</article>`;}).join('')}</section>`;
}
function changeCheckoutBump(input) {
  const card=input.closest('.checkout-bump'),checked=card.querySelector('input[type="checkbox"]').checked;
  for(const select of card.querySelectorAll('[data-bump-option]')){select.disabled=!checked;select.required=checked;}
  if(checked)selectedBumpOffers.set(card.dataset.offerId,Object.fromEntries([...card.querySelectorAll('[data-bump-option]')].map(select=>[select.dataset.bumpOption,select.value])));else selectedBumpOffers.delete(card.dataset.offerId);
  card.classList.toggle('selected',checked);
  const summary=$('#checkout-bump-summary');if(summary)summary.innerHTML=checkoutBumpSummary();
  updatePaymentTotal(input.form||input.closest('form'));
}
function checkoutBumpSummary() { return eligibleOrderBumps().filter(b=>selectedBumpOffers.has(b.id)).map(b=>`<div class="total-line"><span>${esc(b.title)}</span><strong>${money(b.price)}</strong></div>`).join(''); }
const paymentBaseBeforeBumps=paymentFormBase;
paymentFormBase=form=>paymentBaseBeforeBumps(form)+(form.id==='order-form'?0:orderBumpTotal());
const checkoutPageBeforeBumps=checkoutPage;
checkoutPage=()=>{let html=checkoutPageBeforeBumps();if(!db.cart.length)return html;html=html.replace('</textarea></label></section>','</textarea></label>'+orderBumpChoices()+'</section>');return html.replace('<div class="total-line"><span>Frete</span>','<div id="checkout-bump-summary">'+checkoutBumpSummary()+'</div><div class="total-line"><span>Frete</span>');};
const renderStoreBeforeBumps=renderStore;
renderStore=()=>{renderStoreBeforeBumps();if(routePath()==='/loja/checkout'){const form=$('#shipping-options')?.closest('form');if(form)updatePaymentTotal(form);}};
function orderBumpPreviewItems() { return selectedCheckoutBumps().map(item=>{const b=db.orderBumps.find(b=>b.id===item.offerId);return {id:b.kind==='product'?b.productId:0,name:b.title+(optionText(item.options)?' · '+optionText(item.options):''),qty:1,price:Number(b.price),options:item.options,orderBumpId:b.id,stockTracked:b.kind==='product'};}); }
function orderBumpsPage() { const offers=db.orderBumps||[];return heading('Order Bumps','Ofertas especiais para complementar o pedido no checkout.',button('Novo Order Bump','onclick="orderBumpModal()"','primary','plus'))+`<div class="bump-admin-grid">${offers.map((b,index)=>`<section class="card pad bump-admin-card"><div class="bump-card-heading"><span class="task-symbol">${icon(b.kind==='service'?'shield':'box')}</span><span class="badge ${b.active?'green':'gray'}">${b.active?'Ativo':'Desativado'}</span></div><h2>${esc(b.title)}</h2><p>${esc(b.description||'Oferta adicional no checkout.')}</p><strong class="bump-price">${money(b.price)}</strong><small>${b.allProducts?'Disponível para todos os produtos':b.targetProductIds.length+' produtos selecionados'} · ${b.kind==='service'?'Serviço':'Produto'}</small><div class="actions">${button('Editar',`onclick="orderBumpModal(${index})"`,'small','edit')}${button(b.active?'Desativar':'Ativar',`onclick="toggleOrderBump(${index})"`,'small')}${button('Excluir',`onclick="deleteOrderBumpModal(${index})"`,'small danger')}</div></section>`).join('')||`<section class="card empty bump-empty">${icon('plus')}<h2>Ofertas que complementam a compra</h2><p>Cadastre um serviço, como impermeabilização, ou uma oferta de um produto do catálogo.</p>${button('Criar primeiro Order Bump','onclick="orderBumpModal()"','primary','plus')}</section>`}</div>`; }
function orderBumpModal(index=-1) {
  if(!canConfigureSite())return;
  const b=db.orderBumps?.[index]||{title:'',description:'',price:'',cost:0,kind:'service',active:false,allProducts:false,targetProductIds:[]};
  modal(index<0?'Novo Order Bump':'Editar Order Bump',`<form class="bump-editor" onsubmit="event.preventDefault();saveOrderBump(this,${index})"><div class="form-grid">${field('Título da oferta','title',b.title,'text','required maxlength="160" data-full')}<label class="field full">Descrição da oferta<textarea name="description" maxlength="2000" placeholder="Explique o benefício desta oferta.">${esc(b.description)}</textarea></label><label class="field">Tipo de oferta<select name="kind" onchange="toggleBumpKind(this.form)"><option value="service" ${b.kind==='service'?'selected':''}>Serviço</option><option value="product" ${b.kind==='product'?'selected':''}>Produto do catálogo</option>${canManage()?'<option value="new_product">Cadastrar novo produto</option>':''}</select></label><label class="field">Status<select name="active"><option value="true" ${b.active?'selected':''}>Ativo</option><option value="false" ${!b.active?'selected':''}>Desativado</option></select></label><label class="field full" data-bump-product ${b.kind==='product'?'':'hidden'}>Produto da oferta<select name="productId" ${b.kind==='product'?'required':'disabled'}><option value="">Selecione o produto</option>${db.products.map(p=>`<option value="${p.id}" ${p.id===b.productId?'selected':''}>${esc(p.name)} · ${esc(p.sku)}${p.active?'':' · Rascunho'}</option>`).join('')}</select><small>Para cadastrar um produto novo, use Adicionar produto em Produtos.</small></label>${field('Preço da oferta (R$)','price',b.price,'number','min="0.01" step="0.01" required')}${canManage()?field('Custo do serviço (R$)','cost',b.cost||0,'number','min="0" step="0.01" data-bump-service'):'<label hidden><input name="cost" type="hidden" value="0"></label>'}</div><section class="new-bump-product" data-bump-new-product hidden><h3>Novo produto no catálogo</h3><div class="form-grid">${field('Preço de venda na loja (R$)','newProductPrice','','number','min="0.01" step="0.01"')}${field('Quantidade em estoque','newProductStock',0,'number','min="0" step="1"')}<label class="field">Status do produto<select name="newProductActive"><option value="true">Ativo na loja</option><option value="false">Rascunho</option></select></label><label class="field full">Foto do produto<input name="newProductPhoto" type="file" accept="image/png,image/jpeg,image/webp"><small>JPG, PNG ou WebP de até 7 MB.</small></label></div></section><section class="bump-targets"><h3>Onde esta oferta aparece?</h3><label class="check-row"><input name="allProducts" type="checkbox" ${b.allProducts?'checked':''} onchange="this.form.querySelector('.bump-target-picker').hidden=this.checked">Em todos os produtos</label><div class="bump-target-picker" ${b.allProducts?'hidden':''}>${productPicker(b.targetProductIds,'targets')}</div></section><div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary">Salvar Order Bump</button></div></form>`);
  $('#modal').classList.add('catalog-offer-dialog');toggleBumpKind($('#modal form'));
}
function toggleBumpKind(form) {
  const kind=form.elements.namedItem('kind').value,product=kind==='product',creating=kind==='new_product';
  form.querySelector('[data-bump-product]').hidden=!product;
  form.elements.namedItem('productId').disabled=!product;form.elements.namedItem('productId').required=product;
  form.querySelector('[data-bump-new-product]').hidden=!creating;
  form.elements.namedItem('newProductPrice').disabled=!creating;form.elements.namedItem('newProductPrice').required=creating;
  form.elements.namedItem('newProductStock').disabled=!creating;form.elements.namedItem('newProductStock').required=creating;
  form.elements.namedItem('cost').closest('label').hidden=product||!canManage();
  if(canManage())form.elements.namedItem('cost').closest('label').firstChild.textContent=creating?'Custo do produto (R$)':'Custo do serviço (R$)';
}
async function saveOrderBump(form,index) {
 const submit=form.querySelector('button:not([type])');submit.disabled=true;
 try {
  const fields=new FormData(form),f=Object.fromEntries(fields),existing=db.orderBumps?.[index],creating=f.kind==='new_product';
  let photo='';
  if(creating){
   const file=form.elements.namedItem('newProductPhoto').files[0];
   if(f.newProductActive==='true'&&!file)throw new Error('Adicione uma foto para ativar o novo produto ou salve-o como rascunho.');
   if(file){if(file.size>maxPhotoBytes||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Envie uma foto JPG, PNG ou WebP de até 7 MB.');photo=await uploadProductPhoto(file);}
  }
  const b={id:existing?.id||crypto.randomUUID(),title:f.title.trim(),description:f.description.trim(),kind:creating?'product':f.kind,productId:f.kind==='product'?Number(f.productId):null,price:Number(f.price),cost:f.kind==='product'?0:Number(f.cost),active:f.active==='true',allProducts:form.elements.namedItem('allProducts').checked,targetProductIds:fields.getAll('targets').map(Number)};
  if(creating&&b.active&&f.newProductActive!=='true')throw new Error('Ative o produto para publicar sua oferta ou deixe o Order Bump desativado.');
  await commitCatalogChanges(next=>{
   if(creating){const id=Math.max(Number(next.nextProductId)||1,...next.products.map(p=>p.id+1));next.products.push({id,name:b.title,description:b.description||b.title,sku:'GO-'+String(id).padStart(5,'0'),price:Number(f.newProductPrice),promoPrice:null,cost:Number(f.cost),stock:Number(f.newProductStock),min:0,active:f.newProductActive==='true',category:'',categories:[],image:photo,images:photo?[photo]:[],variations:[]});next.nextProductId=id+1;b.productId=id;b.cost=0;}
   next.orderBumps||=[];if(index>=0)next.orderBumps[index]=b;else next.orderBumps.push(b);
  });
  closeModal();render();toast('Order Bump salvo.');
 }catch(error){toast(error.message);submit.disabled=false;}
}
async function toggleOrderBump(index) { try{await commitCatalogChanges(next=>{next.orderBumps[index].active=!next.orderBumps[index].active;});render();toast('Oferta atualizada.');}catch(error){toast(error.message);} }
function deleteOrderBumpModal(index) { const b=db.orderBumps?.[index];if(!b)return;modal('Excluir Order Bump',`<p>Excluir a oferta <strong>${esc(b.title)}</strong>? Os pedidos anteriores manterão a oferta registrada.</p><div class="form-actions">${button('Cancelar','onclick="closeModal()"')}${button('Excluir oferta',`onclick="deleteOrderBump(${index},this)"`,'danger')}</div>`); }
async function deleteOrderBump(index,submit) {submit.disabled=true;try{await commitCatalogChanges(next=>next.orderBumps.splice(index,1));closeModal();render();toast('Oferta excluída.');}catch(error){toast(error.message);submit.disabled=false;} }
const adminPageBeforeCatalog = adminPage;
adminPage = page => { if(page==='collections'){const name=routePath().split('/').slice(3).join('/');return name?collectionDetailPage(decodeURIComponent(name)):collectionsPage();}if(page==='order-bumps')return orderBumpsPage();return adminPageBeforeCatalog(page); };
navigation.splice(navigation.findIndex(item=>item[0]==='products')+1,0,['order-bumps','Order Bumps','plus']);
catalogPage = () => {const products=collectionProducts(catalogCategory,true).filter(p=>(p.name+' '+p.sku).toLowerCase().includes(catalogQuery.toLowerCase()));return `<div class="store-content">${heading(catalogCategory==='Todos'?'Encontre o seu próximo móvel':esc(catalogCategory),'Conforto, praticidade e preços que cabem nos seus planos.')}<div class="toolbar catalog-toolbar" style="padding:0 0 25px"><form class="search" onsubmit="event.preventDefault();catalogQuery=this.q.value;render()">${icon('search')}<input name="q" value="${esc(catalogQuery)}" placeholder="Buscar na coleção" aria-label="Buscar na coleção"><button aria-label="Buscar">${icon('chevron')}</button></form><div class="actions"><select class="control" aria-label="Filtrar coleção" onchange="catalogCategory=this.value;render()">${['Todos',...visibleCollections()].map(c=>`<option ${c===catalogCategory?'selected':''}>${esc(c)}</option>`).join('')}</select><span class="catalog-count">${products.length} produtos</span></div></div><div class="catalog">${products.map(p=>shopProduct(p,db.storefront?.pageSettings?.collection||{})).join('')}</div>${products.length?'':'<div class="empty">Nenhum produto encontrado.</div>'}</div>`;};
function storeCollectionLinks() {return `<a href="/loja/catalogo" onclick="catalogCategory='Todos';catalogQuery=''">Todos os móveis</a>${visibleCollections().map(name=>`<a href="/loja/catalogo" onclick="catalogCategory=decodeURIComponent('${encodeURIComponent(name).replace(/'/g,'%27')}');catalogQuery=''">${esc(name)}</a>`).join('')}`;}
const headerBeforeCollections = storeHeader;
storeHeader=()=>headerBeforeCollections().replace(/<nav class="store-nav">[\s\S]*?<\/nav>/,'<nav class="store-nav">'+storeCollectionLinks()+'</nav>');
