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
  const configs=[model.storefront,...(model.storeThemes||[]).map(theme=>theme.config)].filter(Boolean);
  for(const config of configs)for(const section of [...(config.sections||[]),...Object.values(config.pageSettings||{}).flatMap(page=>page.sections||[])]){
    if(section.type==='collection'&&section.category===previous){section.category=name||'Todos';if(!name)section.enabled=false;}
    if(section.type==='collection-list')section.items=(section.items||[]).flatMap(item=>item.category!==previous?[item]:name?[{...item,category:name}]:[]);
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
  const products=db.products.filter(p=>productMatchesStatus(p)&&
    (catalogCollectionFilter==='all'||catalogCollectionFilter==='none'&&!productCollections(p).length||productInCollection(p,catalogCollectionFilter))&&
    matchesSearch([p.name,p.sku,...productCollections(p)].join(' '),productQuery));
  const title=(a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR',{numeric:true,sensitivity:'base'})||a.id-b.id;
  const created=p=>Date.parse(p.createdAt||p.created_at||'')||0;
  const recent=(a,b)=>created(b)-created(a)||b.id-a.id;
  return products.sort((a,b)=>catalogAdminSort==='price_asc'?salePrice(a)-salePrice(b)||title(a,b):catalogAdminSort==='price_desc'?salePrice(b)-salePrice(a)||title(a,b):catalogAdminSort==='title_asc'?title(a,b):catalogAdminSort==='title_desc'?title(b,a):catalogAdminSort==='oldest'?recent(b,a):recent(a,b));
}
let catalogCollectionFilter='all',catalogAdminSort='newest';
const catalogAdminSortOptions=[['newest','Mais recentes'],['oldest','Mais antigos'],['price_asc','Menor preço'],['price_desc','Maior preço'],['title_asc','Nome: A–Z'],['title_desc','Nome: Z–A']];
function selectCatalogProduct(id, checked) { checked?catalogSelection.add(id):catalogSelection.delete(id); updateCatalogSelectionBar(); }
function selectVisibleCatalog(checked) { filteredCatalogProducts().forEach(p=>checked?catalogSelection.add(p.id):catalogSelection.delete(p.id)); render(); }
function updateCatalogSelectionBar() {
  const bar=$('#catalog-bulk-bar'); if(bar)bar.innerHTML=catalogBulkBar();
  const all=$('#catalog-select-all'),products=filteredCatalogProducts();
  if(all){all.checked=products.length>0&&products.every(p=>catalogSelection.has(p.id));all.indeterminate=!all.checked&&products.some(p=>catalogSelection.has(p.id));}
}
function catalogBulkBar() { return catalogSelection.size?`<strong>${catalogSelection.size} selecionado${catalogSelection.size===1?'':'s'}</strong><div class="actions"><button class="btn small primary" onclick="openBulkEditor()">${icon('edit')}Editar em massa</button><details class="catalog-bulk-menu"><summary class="btn small">${icon('layers')}Coleções ${icon('down')}</summary><div><button onclick="bulkCatalogModal('collections')">Adicionar a coleções</button><button onclick="bulkCatalogModal('removeCollections')">Remover de coleções</button></div></details><button class="btn small" onclick="openBulkEditor('variations')">Variações</button><button class="btn small" onclick="bulkCatalogModal('draft')">Tornar rascunho</button><button class="btn small" onclick="bulkCatalogModal('active')">Ativar</button><button class="btn small danger" onclick="bulkCatalogModal('delete')">${icon('trash')}Excluir</button><button class="text-link" onclick="catalogSelection.clear();render()">Limpar seleção</button></div>`:''; }

productsPage = () => {
  const products=filteredCatalogProducts(),manage=canManage();
  return heading('Produtos','Organize seu catálogo e mantenha sua loja sempre atualizada.',manage?button('Adicionar produto','onclick="productModal()"','primary','plus'):'')+
  `<section class="card catalog-workspace"><div class="toolbar catalog-toolbar"><form class="search" onsubmit="event.preventDefault();productQuery=this.q.value;render()">${icon('search')}<input name="q" type="search" data-section-search="products" oninput="updateSectionSearch(this,'products')" value="${esc(productQuery)}" placeholder="Buscar por nome, SKU ou coleção" aria-label="Buscar produtos"><button aria-label="Buscar">${icon('chevron')}</button></form><label class="catalog-status-filter"><span>Exibir</span><select class="control" aria-label="Filtrar produtos" onchange="productStatusFilter=this.value;render()">${[['all','Todos os produtos'],['active','Ativos'],['draft','Rascunhos']].map(([value,label])=>`<option value="${value}" ${productStatusFilter===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="catalog-filter"><span>Coleção</span><select class="control" aria-label="Filtrar produtos por coleção" onchange="catalogCollectionFilter=this.value;render()"><option value="all">Todas as coleções</option><option value="none" ${catalogCollectionFilter==='none'?'selected':''}>Sem coleção</option>${db.collections.map(name=>`<option value="${esc(name)}" ${catalogCollectionFilter===name?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="catalog-filter"><span>Ordenar por</span><select class="control" aria-label="Ordenar produtos" onchange="catalogAdminSort=this.value;render()">${catalogAdminSortOptions.map(([value,label])=>`<option value="${value}" ${catalogAdminSort===value?'selected':''}>${label}</option>`).join('')}</select></label><span class="catalog-count" role="status">${products.length} ${products.length===1?'produto':'produtos'}</span></div>
  ${manage?`<div id="catalog-bulk-bar" class="catalog-bulk-bar">${catalogBulkBar()}</div>`:''}<div class="tablewrap"><table class="catalog-table"><thead><tr>${manage?`<th class="catalog-check"><input id="catalog-select-all" type="checkbox" aria-label="Selecionar todos os produtos exibidos" ${products.length&&products.every(p=>catalogSelection.has(p.id))?'checked':''} onchange="selectVisibleCatalog(this.checked)"></th>`:''}<th>Produto</th><th>Status</th><th>Estoque</th><th>Coleções</th><th>Preço</th><th>Ações</th></tr></thead><tbody>${products.map(p=>`<tr>${manage?`<td class="catalog-check"><input type="checkbox" aria-label="Selecionar ${esc(p.name)}" ${catalogSelection.has(p.id)?'checked':''} onchange="selectCatalogProduct(${p.id},this.checked)"></td>`:''}<td><div class="product-cell"><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt="" loading="lazy"><div><span class="product-title" title="${esc(p.name)}">${esc(p.name)}</span><small>${esc(p.sku)}</small></div></div></td><td><span class="badge ${p.active?'green':'gray'}">${p.active?'Ativo':'Rascunho'}</span>${productReviewNote(p)?`<small class="product-review-note">${esc(productReviewNote(p))}</small>`:''}</td><td>${p.stock} un.</td><td><div class="collection-tags">${productCollections(p).map(name=>`<span>${esc(name)}</span>`).join('')||'<small>Sem coleção</small>'}</div></td><td>${priceMarkup(p)}</td><td><div class="actions">${manage?button('Editar',`onclick="productModal(${p.id})"`,'small'):''}${p.active?`<a class="btn small icon-button" href="/loja/produto/${p.id}" target="_blank" rel="noopener noreferrer" aria-label="Visualizar ${esc(p.name)}">${icon('eye')}</a>`:''}${manage?button('',`onclick="deleteProduct(${p.id})" aria-label="Excluir ${esc(p.name)}"`,'small danger icon-button','trash'):''}</div></td></tr>`).join('')||`<tr><td colspan="7" class="empty">Nenhum produto encontrado.</td></tr>`}</tbody></table></div></section>`;
};
function collectionCheckboxes(names=[],fieldName='categories') { return `<div class="collection-checkboxes">${db.collections.map(name=>`<label><input type="checkbox" name="${fieldName}" value="${esc(name)}" ${names.includes(name)?'checked':''}><span>${esc(name)}${collectionConfig(name).active===false?'<small>Desativada</small>':''}</span></label>`).join('')||'<p class="subtle">Cadastre uma coleção na seção Coleções.</p>'}</div>`; }
function bulkCatalogModal(action, ids=[...catalogSelection]) {
  if(!canManage()||!ids.length)return;
  const labels={collections:'Adicionar a coleções',removeCollections:'Remover de coleções',draft:'Tornar rascunho',active:'Ativar produtos',delete:'Excluir produtos'};
  modal(labels[action],`<form onsubmit="event.preventDefault();applyBulkCatalog(this,'${action}',${JSON.stringify(ids)})"><p>${action==='delete'?'Excluir':'Alterar'} <strong>${ids.length} produto${ids.length===1?'':'s'}</strong>${action==='delete'?'? A exclusão não poderá ser desfeita pelo painel.':'.'}</p>${['collections','removeCollections'].includes(action)?`<p class="subtle">${action==='removeCollections'?'Somente as coleções marcadas serão removidas. As demais serão mantidas.':'As coleções atuais serão mantidas.'}</p>${collectionCheckboxes([], 'bulkCollections')}`:''}<div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn ${action==='delete'?'danger':'primary'}">${action==='delete'?'Excluir produtos':'Confirmar alteração'}</button></div></form>`);
}
async function applyBulkCatalog(form,action,ids) {
  if(!canManage()||!['collections','removeCollections','draft','active','delete'].includes(action))return;
  const submit=form.querySelector('button:not([type])');submit.disabled=true;
  try {
    const names=new FormData(form).getAll('bulkCollections');if(['collections','removeCollections'].includes(action)&&!names.length)throw new Error('Selecione pelo menos uma coleção.');
    await commitCatalogChanges(next=>{
      if(ids.some(id=>!next.products.some(p=>p.id===id)))throw Error('Um produto selecionado foi removido. Atualize a lista.');
      if(names.some(name=>!next.collections.includes(name)))throw Error('Uma coleção selecionada não existe mais.');
      if(action==='delete'){
        next.products=next.products.filter(p=>!ids.includes(p.id));
        next.orderBumps=(next.orderBumps||[]).filter(b=>b.kind!=='product'||!ids.includes(b.productId)).map(b=>({...b,targetProductIds:b.targetProductIds.filter(id=>!ids.includes(id))})).map(b=>({...b,active:b.active&&(b.allProducts||b.targetProductIds.length>0)}));
        for(const cfg of Object.values(next.collectionSettings||{}))if(cfg.productIds)cfg.productIds=cfg.productIds.filter(id=>!ids.includes(id));
      } else for(const p of next.products.filter(p=>ids.includes(p.id))) {
        if(action==='collections')assignProductCollections(p,[...productCollections(p),...names]);
        else if(action==='removeCollections')assignProductCollections(p,productCollections(p).filter(name=>!names.includes(name)));
        else p.active=action==='active';
      }
    });
    catalogSelection.clear();closeModal();render();toast(action==='delete'?'Produtos excluídos.':'Produtos atualizados.');
  }catch(error){toast(error.message);submit.disabled=false;}
}
deleteProduct = id => bulkCatalogModal('delete',[id]);

const modalBeforeCatalog = modal;
modal = (title,html) => { $('#modal').classList.remove('catalog-product-dialog','catalog-offer-dialog','catalog-bulk-dialog');modalBeforeCatalog(title,html); };
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
      const product={...(current||{}),id:newId,createdAt:current?.createdAt||current?.created_at||(!current?new Date().toISOString():undefined),name:f.name.trim(),description:f.description.trim(),sku,price,promoPrice,cost,stock,min,active:f.active==='true',images,image:images[0]||'',variations};
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
function productPicker(selected=[],name='products') { return `<div class="product-picker"><label class="search">${icon('search')}<input placeholder="Buscar produtos por nome ou SKU" aria-label="Buscar produtos para selecionar" oninput="filterProductPicker(this)"></label><div class="product-picker-list">${db.products.map(p=>`<label class="product-picker-row" data-search="${esc(searchText(p.name+' '+p.sku))}"><input type="checkbox" name="${name}" value="${p.id}" ${selected.includes(p.id)?'checked':''}><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt="" loading="lazy"><span>${esc(p.name)}<small>${esc(p.sku)} · ${p.active?'Ativo':'Rascunho'}</small></span></label>`).join('')}</div><p class="product-picker-empty subtle" role="status" hidden>Nenhum produto encontrado.</p></div>`; }
function filterProductPicker(input) { const picker=input.closest('.product-picker');let count=0;for(const row of picker.querySelectorAll('.product-picker-row')){row.hidden=!matchesSearch(row.dataset.search,input.value);if(!row.hidden)count++;}const empty=picker.querySelector('.product-picker-empty');if(empty)empty.hidden=count>0; }
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
paths.sliders='M4 7h16M4 17h16M8 4v6M16 14v6';
const collectionFilterKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
const shopSortOptions=[['featured','Em destaque'],['price_asc','Menor preço'],['price_desc','Maior preço'],['title_asc','Nome: A–Z'],['title_desc','Nome: Z–A'],['bestsellers','Mais vendidos']];
let shopFilters={scope:'',query:'',min:null,max:null,selected:[],sort:'featured'},shopFilterHash=null,shopFilterFocus=null;
function parseCollectionPrice(raw){
  let text=String(raw??'').trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');if(!text)return null;
  if(text.includes(',')){
    if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text))throw Error('Informe um preço válido, como 1.500,00.');
    text=text.replace(/\./g,'').replace(',','.');
  }else if(/^\d{1,3}(?:\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
  else if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('Informe um preço válido, como 1.500,00.');
  const value=Number(text);if(!Number.isFinite(value)||value<0||value>999999999.99)throw Error('Informe um preço válido.');return Math.round(value*100)/100;
}
function collectionFilterState(){
  const hash=location.hash,params=new URLSearchParams(hash.split('?')[1]||''),fromUrl=hash!==shopFilterHash;
  if(fromUrl&&params.has('q'))catalogQuery=String(params.get('q')).slice(0,200);
  if(fromUrl||shopFilters.scope!==catalogCategory||shopFilters.query!==catalogQuery){
    let selected=[];try{const value=JSON.parse((params.get('f')||'[]').slice(0,8000));if(Array.isArray(value))selected=value.filter(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&Array.isArray(entry[1])).slice(0,40).map(([key,values])=>[key,values.filter(v=>typeof v==='string').slice(0,100)])}catch{}
    const price=key=>{const value=params.get(key);return value!==null&&/^\d+(?:\.\d{1,2})?$/.test(value)&&Number(value)<=999999999.99?Number(value):null};
    shopFilters={scope:catalogCategory,query:catalogQuery,min:fromUrl?price('min'):null,max:fromUrl?price('max'):null,selected:fromUrl?selected:[],sort:fromUrl&&shopSortOptions.some(([key])=>key===params.get('sort'))?params.get('sort'):'featured'};
    if(shopFilters.min!==null&&shopFilters.max!==null&&shopFilters.min>shopFilters.max){shopFilters.min=null;shopFilters.max=null}
    shopFilterHash=hash;
  }
  return shopFilters;
}
function completedProductSales(orders){
  const sales={};for(const order of orders||[])if(order.status==='delivered'&&order.paid===true)for(const line of order.items||[]){const id=String(line.id),qty=Number(line.qty);if(/^\d+$/.test(id)&&Number.isInteger(qty)&&qty>0)sales[id]=(sales[id]||0)+qty}return sales;
}
function collectionSales(){return db.productSales&&typeof db.productSales==='object'?db.productSales:isOwner?completedProductSales(db.orders):{}}
function collectionFilterModel(state=collectionFilterState()){
  const groups=new Map();
  const products=collectionProducts(catalogCategory,true).filter(p=>matchesSearch(p.name+' '+p.sku,catalogQuery));
  const rows=products.map(product=>{
    const attributes=new Map();
    for(const attribute of productVariations(product)){
      const name=String(attribute.name||'').trim(),key=collectionFilterKey(name);if(!key)continue;
      if(!groups.has(key))groups.set(key,{key,name,values:new Map()});
      if(!attributes.has(key))attributes.set(key,new Set());
      for(const raw of Array.isArray(attribute.values)?attribute.values:[]){const value=String(raw).trim(),valueKey=collectionFilterKey(value);if(valueKey){attributes.get(key).add(valueKey);if(!groups.get(key).values.has(valueKey))groups.get(key).values.set(valueKey,value)}}
    }
    return {product,attributes};
  });
  const facets=[...groups.values()].filter(group=>group.values.size).sort((a,b)=>{
    const priority=key=>/^(cor|cores)$/.test(key)?0:/^(tamanho|medida|medidas)$/.test(key)?1:/^caracteristica/.test(key)?2:3;
    return priority(a.key)-priority(b.key)||a.name.localeCompare(b.name,'pt-BR');
  });
  state.selected=state.selected.flatMap(([key,values])=>{const group=groups.get(key),valid=[...new Set(values)].filter(value=>group?.values.has(value));return valid.length?[[key,valid]]:[]});
  const matches=(row,skip='')=>{
    const price=salePrice(row.product);if(state.min!==null&&price<state.min||state.max!==null&&price>state.max)return false;
    return state.selected.every(([key,values])=>key===skip||values.some(value=>row.attributes.get(key)?.has(value)));
  };
  for(const group of facets){group.available=new Set(rows.filter(row=>matches(row,group.key)).flatMap(row=>[...(row.attributes.get(group.key)||[])]));group.values=[...group.values].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR',{numeric:true,sensitivity:'base'}))}
  const filtered=rows.filter(row=>matches(row)).map(row=>row.product),sales=collectionSales();
  if(state.sort==='bestsellers')filtered.sort((a,b)=>(Number(sales[b.id])||0)-(Number(sales[a.id])||0));
  else if(state.sort!=='featured'){const ordered=sortedCollectionProducts(filtered,state.sort);filtered.splice(0,filtered.length,...ordered)}
  return {products:filtered,facets,prices:products.map(salePrice)};
}
function collectionFilterUrl(){
  const params=new URLSearchParams({colecao:catalogCategory});
  if(catalogQuery)params.set('q',catalogQuery);if(shopFilters.min!==null)params.set('min',String(shopFilters.min));if(shopFilters.max!==null)params.set('max',String(shopFilters.max));
  if(shopFilters.selected.length)params.set('f',JSON.stringify(shopFilters.selected));if(shopFilters.sort!=='featured')params.set('sort',shopFilters.sort);
  const hash='#/loja/catalogo?'+params;history.replaceState({},'',basePath+hash);shopFilterHash=hash;
}
function updateCollectionResults(focus=null){collectionFilterUrl();render();if(focus){const node=[...document.querySelectorAll('#desktop-collection-filters input')].find(input=>input.name===focus.name&&input.value===focus.value);node?.focus({preventScroll:true})}}
function applyCollectionFilters(form,focus=null){
  const state=collectionFilterState(),model=collectionFilterModel(state),data=new FormData(form),error=form.querySelector('[data-filter-error]');
  try{
    const min=parseCollectionPrice(data.get('min')),max=parseCollectionPrice(data.get('max'));
    if(min!==null&&max!==null&&min>max)throw Error('O valor máximo deve ser maior ou igual ao mínimo.');
    state.min=min;state.max=max;state.selected=model.facets.flatMap(group=>{const values=[...new Set(data.getAll('facet:'+group.key))].filter(value=>group.values.some(([key])=>key===value));return values.length?[[group.key,values]]:[]});
    const mobile=form.id==='mobile-collection-filters';if(mobile)closeCollectionFilters(false);
    updateCollectionResults(focus?{name:focus.name,value:focus.value}:null);if(!mobile&&!focus)document.querySelector('#desktop-collection-filters .collection-apply-price')?.focus({preventScroll:true});if(mobile)document.querySelector('#open-collection-filters')?.focus({preventScroll:true});
  }catch(reason){if(error){error.textContent=reason.message;error.hidden=false;error.focus()}else toast(reason.message)}
}
function setShopSort(value){if(!shopSortOptions.some(([key])=>key===value))return;collectionFilterState().sort=value;updateCollectionResults();document.querySelector('#collection-sort')?.focus({preventScroll:true})}
function clearCollectionFilters(){const state=collectionFilterState();state.min=null;state.max=null;state.selected=[];updateCollectionResults()}
function removeCollectionFilter(key,value){const state=collectionFilterState();if(key==='price'){state.min=null;state.max=null}else if(key==='query'){catalogQuery='';state.query=''}else state.selected=state.selected.flatMap(([name,values])=>{const next=name===key?values.filter(v=>v!==value):values;return next.length?[[name,next]]:[]});updateCollectionResults()}
function clearCollectionFilterForm(form){form.querySelectorAll('input').forEach(input=>{if(input.type==='checkbox')input.checked=false;else input.value=''});const error=form.querySelector('[data-filter-error]');if(error)error.hidden=true}
function openCollectionFilters(button){const dialog=document.querySelector('#collection-filters-dialog');if(!dialog)return;shopFilterFocus=button;document.body.classList.add('collection-filters-open');dialog.showModal()}
function closeCollectionFilters(restore=true){const dialog=document.querySelector('#collection-filters-dialog');if(restore){dialog?.querySelector('form')?.reset();const error=dialog?.querySelector('[data-filter-error]');if(error)error.hidden=true}dialog?.close();document.body.classList.remove('collection-filters-open');if(restore)shopFilterFocus?.focus({preventScroll:true});shopFilterFocus=null}
function collectionFilterForm(model,mobile=false){
  const state=shopFilters,format=value=>value===null?'':value.toLocaleString('pt-BR',{useGrouping:false,maximumFractionDigits:2});
  const palette={preto:'#222222',branco:'#ffffff',bege:'#d9c8a5',cinza:'#8d9295',marrom:'#795548',azul:'#416a98',verde:'#5f785c',rosa:'#dc9baf',vermelho:'#b54949',amarelo:'#e4bb4b',chumbo:'#4d5458',areia:'#d9cfb5',caramelo:'#b88351',cafe:'#634b3e'};
  return `<form id="${mobile?'mobile':'desktop'}-collection-filters" class="collection-filter-form" onsubmit="event.preventDefault();applyCollectionFilters(this)"><div class="collection-filter-title"><h2>Filtros</h2><button class="filter-clear" type="button" onclick="${mobile?'clearCollectionFilterForm(this.form)':'clearCollectionFilters()'}">Limpar</button></div><details class="collection-filter-group" open><summary>Faixa de preço ${icon('down')}</summary><div class="collection-price-range"><label>Mínimo<div><span>R$</span><input name="min" inputmode="decimal" maxlength="18" value="${format(state.min)}" placeholder="${format(model.prices.length?Math.min(...model.prices):0)}" aria-label="Preço mínimo"></div></label><label>Máximo<div><span>R$</span><input name="max" inputmode="decimal" maxlength="18" value="${format(state.max)}" placeholder="${format(model.prices.length?Math.max(...model.prices):0)}" aria-label="Preço máximo"></div></label></div>${mobile?'':'<button class="btn small collection-apply-price" type="submit">Aplicar preço</button>'}</details>${model.facets.map(group=>{const selected=new Set(state.selected.find(([key])=>key===group.key)?.[1]||[]);return `<details class="collection-filter-group" open><summary>${esc(group.name)} ${icon('down')}</summary><div class="collection-filter-values">${group.values.map(([key,label])=>{const checked=selected.has(key),disabled=!checked&&!group.available.has(key),color=/^(cor|cores)$/.test(group.key)?palette[key.split(' ')[0]]:null;return `<label class="collection-filter-option ${!mobile&&disabled?'is-unavailable':''}"><input type="checkbox" name="facet:${esc(group.key)}" value="${esc(key)}" ${checked?'checked':''} ${!mobile&&disabled?'disabled':''} ${mobile?'':'onchange="applyCollectionFilters(this.form,this)"'}>${color?`<i class="filter-color-swatch" style="--swatch:${color}" aria-hidden="true"></i>`:''}<span>${esc(label)}</span></label>`}).join('')}</div></details>`}).join('')}<p class="collection-filter-error" data-filter-error role="alert" tabindex="-1" hidden></p>${mobile?'<div class="collection-filter-apply"><button class="btn primary" type="submit">Aplicar filtros</button></div>':''}</form>`;
}
function collectionActiveFilters(model){
  const state=shopFilters,arg=value=>`decodeURIComponent('${encodeURIComponent(value).replace(/'/g,'%27')}')`,chips=[];
  if(catalogQuery)chips.push(['query','','Busca: '+catalogQuery]);
  if(state.min!==null||state.max!==null)chips.push(['price','',state.min!==null&&state.max!==null?`${money(state.min)} a ${money(state.max)}`:state.min!==null?'A partir de '+money(state.min):'Até '+money(state.max)]);
  for(const [key,values] of state.selected){const group=model.facets.find(g=>g.key===key);for(const value of values)chips.push([key,value,(group?.name||key)+': '+(group?.values.find(([k])=>k===value)?.[1]||value)])}
  return chips.length?`<div class="collection-active-filters" aria-label="Filtros aplicados">${chips.map(([key,value,label])=>`<button type="button" onclick="removeCollectionFilter(${arg(key)},${arg(value)})" aria-label="Remover filtro ${esc(label)}">${esc(label)}<span aria-hidden="true">×</span></button>`).join('')}</div>`:'';
}
catalogPage=()=>{
  const model=collectionFilterModel(),cfg=db.storefront?.pageSettings?.collection||{},filters=cfg.showFilters!==false;
  return `<div class="store-content collection-shop-page"><header class="heading collection-page-header"><div><h1>${catalogCategory==='Todos'?'Encontre o seu próximo móvel':esc(catalogCategory)}</h1><p>Conforto, praticidade e preços que cabem nos seus planos.</p></div>${filters?`<button id="open-collection-filters" class="btn collection-mobile-filter-toggle" type="button" onclick="openCollectionFilters(this)">${icon('sliders')}Filtrar</button>`:''}<label class="collection-sort-control">Ordenar por<select id="collection-sort" onchange="setShopSort(this.value)">${shopSortOptions.map(([key,label])=>`<option value="${key}" ${shopFilters.sort===key?'selected':''}>${label}</option>`).join('')}</select></label></header><div class="collection-layout ${filters?'':'without-filters'}">${filters?`<aside class="collection-filter-sidebar" aria-label="Filtrar produtos">${collectionFilterForm(model)}</aside>`:''}<section class="collection-filter-results" aria-label="Produtos da coleção" aria-live="polite">${collectionActiveFilters(model)}<div class="catalog">${model.products.map(p=>shopProduct(p,cfg)).join('')}</div>${model.products.length?'':`<div class="collection-filter-empty"><h2>Nenhum produto encontrado</h2><p>Tente outras opções ou amplie a faixa de preço.</p><button class="btn" onclick="clearCollectionFilters()">Limpar filtros</button>${catalogQuery?'<button class="text-link" onclick="removeCollectionFilter(\'query\',\'\')">Limpar busca</button>':''}</div>`}</section></div>${filters?`<dialog id="collection-filters-dialog" class="collection-filters-dialog" aria-label="Filtrar produtos" oncancel="event.preventDefault();closeCollectionFilters()" onclick="if(event.target===this){const r=this.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeCollectionFilters()}"><div class="collection-filter-dialog-head"><strong>Encontre seu móvel</strong><button type="button" aria-label="Fechar filtros" onclick="closeCollectionFilters()">×</button></div>${collectionFilterForm(model,true)}</dialog>`:''}</div>`;
};
function storeCollectionLinks() {return `<a href="/loja/catalogo" onclick="catalogCategory='Todos';catalogQuery=''">Todos os móveis</a>${visibleCollections().map(name=>`<a href="/loja/catalogo" onclick="catalogCategory=decodeURIComponent('${encodeURIComponent(name).replace(/'/g,'%27')}');catalogQuery=''">${esc(name)}</a>`).join('')}`;}
const headerBeforeCollections = storeHeader;
storeHeader=()=>headerBeforeCollections().replace(/<nav class="store-nav">[\s\S]*?<\/nav>/,'<nav class="store-nav">'+storeCollectionLinks()+'</nav>');

// Bulk product drafts are isolated until the reviewed transaction is saved.
let bulkEditor=null;
const bulkProductCount=count=>count+' produto'+(count===1?'':'s');
const bulkFieldLabels={name:'Nome',price:'Preço de venda',promoPrice:'Preço promocional',cost:'Custo',stock:'Estoque',min:'Estoque mínimo',active:'Status',categories:'Coleções',variations:'Variações'};
function bulkComparable(product){
  const numeric=key=>product[key]===''?'':Number(product[key]??0);
  return {name:String(product.name||'').trim(),price:numeric('price'),promoPrice:product.promoPrice===''||product.promoPrice==null?null:Number(product.promoPrice),cost:numeric('cost'),stock:numeric('stock'),min:numeric('min'),active:product.active===true,categories:productCollections(product),variations:productVariations(product)};
}
function bulkEditorChanges(){
  if(!bulkEditor)return [];
  return bulkEditor.drafts.flatMap(product=>{
    const before=bulkComparable(bulkEditor.originals.find(p=>p.id===product.id)),after=bulkComparable(product);
    const fields=Object.keys(bulkFieldLabels).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
    return fields.length?[{id:product.id,name:product.name,before,after,fields}]:[];
  });
}
function openBulkEditor(tab='data'){
  if(!canManage()||catalogWriteBusy)return;
  const ids=[...catalogSelection],products=ids.map(id=>db.products.find(p=>p.id===id));
  if(!ids.length)return toast('Selecione pelo menos um produto.');
  if(products.some(p=>!p))return toast('A seleção mudou. Atualize a lista de produtos.');
  bulkEditor={originals:structuredClone(products),drafts:structuredClone(products),tab:['data','collections','variations'].includes(tab)?tab:'data',busy:false,discard:false,attributeAdditions:[],catalogBaseline:JSON.stringify(db.attributeCatalog??null)};
  renderBulkEditor();
}
function bulkSetField(id,key,value){
  if(!canManage()||!bulkEditor||bulkEditor.busy||!['name','price','promoPrice','cost','stock','min','active'].includes(key))return;
  const product=bulkEditor.drafts.find(p=>p.id===id);if(!product)return;
  product[key]=key==='active'?value==='true':value;
  const count=document.querySelector('#bulk-change-count');if(count)count.textContent=bulkProductCount(bulkEditorChanges().length)+' com alterações';
  const review=document.querySelector('#bulk-review-button');if(review)review.disabled=!bulkEditorChanges().length;
}
function bulkValidateChanges(){
  const changes=bulkEditorChanges();if(!changes.length)throw Error('Nenhuma alteração para salvar.');
  for(const change of changes){
    const p=change.after,label=String(p.name||change.id).slice(0,80);
    if(!p.name||p.name.length>250)throw Error(label+': informe um nome de até 250 caracteres.');
    if(!Number.isFinite(p.price)||p.price<=0||p.price>999999999.99||p.price==='')throw Error(label+': confira o preço de venda.');
    if(p.promoPrice!==null&&(!Number.isFinite(p.promoPrice)||p.promoPrice<=0||p.promoPrice>=p.price))throw Error(label+': a promoção deve ser maior que zero e menor que o preço de venda.');
    if(['price','promoPrice','cost'].some(key=>p[key]!==null&&Number.isFinite(p[key])&&Math.abs(p[key]*100-Math.round(p[key]*100))>.000001))throw Error(label+': use no máximo duas casas decimais nos valores.');
    if(p.cost===''||!Number.isFinite(p.cost)||p.cost<0)throw Error(label+': confira o custo.');
    if(!Number.isInteger(p.stock)||!Number.isInteger(p.min)||p.stock<0||p.min<0||p.stock>2147483647||p.min>2147483647)throw Error(label+': use quantidades inteiras e não negativas.');
    if(p.stock<reserved(change.id))throw Error(label+': o estoque não pode ser menor que as '+reserved(change.id)+' unidades reservadas.');
    if(p.categories.some(name=>!db.collections.includes(name)))throw Error(label+': uma coleção foi removida. Reabra o editor.');
    validateBulkVariations(p.variations,label);
    const source=bulkEditor.drafts.find(item=>item.id===change.id);
    if(p.active&&!productImages(source).length)throw Error(label+': adicione uma foto antes de ativar o produto.');
  }
  return changes;
}
function validateBulkVariations(variations,label='Produto'){
  if(variations.length>5)throw Error(label+': cada produto aceita no máximo cinco atributos.');
  const keys=new Set();
  for(const option of variations){
    const name=String(option.name||'').trim(),key=attributeKey(name);
    if(!name||name.length>40||keys.has(key)||!Array.isArray(option.values)||!option.values.length||option.values.length>30||option.values.some(v=>typeof v!=='string'||!v.trim()||v.length>80)||new Set(option.values.map(attributeKey)).size!==option.values.length)throw Error(label+': confira os atributos e suas opções.');
    keys.add(key);
  }
}
function bulkSwitchTab(tab){
  if(!canManage()||!bulkEditor||bulkEditor.busy||!['data','collections','variations','review'].includes(tab))return;
  try{if(tab==='review')bulkValidateChanges();bulkEditor.tab=tab;bulkEditor.discard=false;renderBulkEditor();}catch(error){toast(error.message)}
}
function bulkCurrentProducts(kind){
  return `<div class="bulk-current-list">${bulkEditor.drafts.map(p=>`<article><div class="bulk-product-identity"><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt=""><div><strong>${esc(p.name)}</strong><small>${esc(p.sku)}</small></div></div>${kind==='collections'?`<div class="collection-tags">${productCollections(p).map(name=>`<span>${esc(name)}</span>`).join('')||'<small>Sem coleção</small>'}</div>`:`<div class="bulk-variation-summary">${productVariations(p).map(option=>`<p><strong>${esc(option.name)}</strong> ${option.values.map(esc).join(' · ')}</p>`).join('')||'<small>Sem variações</small>'}</div>`}</article>`).join('')}</div>`;
}
function bulkDataTable(){
  const number=(p,key,min,step)=>`<input type="number" aria-label="${esc(bulkFieldLabels[key])} de ${esc(p.name)}" value="${esc(p[key]??'')}" min="${min}" step="${step}" oninput="bulkSetField(${p.id},'${key}',this.value)">`;
  return `<p class="bulk-section-help">Edite cada célula. As fotos, descrições e códigos dos produtos serão mantidos.</p><div class="bulk-table-scroll" tabindex="0" aria-label="Tabela de edição dos produtos. Role para ver todas as colunas."><table class="bulk-edit-table"><thead><tr><th>Produto</th><th>Preço de venda</th><th>Preço promocional</th><th>Custo</th><th>Estoque</th><th>Mínimo</th><th>Status</th></tr></thead><tbody>${bulkEditor.drafts.map(p=>`<tr><td><div class="bulk-product-identity"><img src="${esc(p.image||'assets/product-placeholder.svg')}" alt=""><div><input aria-label="Nome de ${esc(p.sku)}" value="${esc(p.name)}" maxlength="250" oninput="bulkSetField(${p.id},'name',this.value)"><small>${esc(p.sku)}</small></div></div></td><td>${number(p,'price',.01,.01)}</td><td>${number(p,'promoPrice',.01,.01)}</td><td>${number(p,'cost',0,.01)}</td><td>${number(p,'stock',0,1)}</td><td>${number(p,'min',0,1)}</td><td><select aria-label="Status de ${esc(p.name)}" onchange="bulkSetField(${p.id},'active',this.value)"><option value="true" ${p.active?'selected':''}>Ativo</option><option value="false" ${!p.active?'selected':''}>Rascunho</option></select></td></tr>`).join('')}</tbody></table></div>`;
}
function bulkCollectionPanel(){
  return `<div class="bulk-config-layout"><form class="bulk-config-card" onsubmit="event.preventDefault();bulkApplyCollections(this)"><h3>Organizar coleções</h3><p>Aplique aos ${bulkEditor.drafts.length} produtos selecionados.</p><label class="field">Ação<select name="mode"><option value="add">Adicionar às coleções marcadas</option><option value="remove">Remover das coleções marcadas</option><option value="replace">Substituir todas pelas marcadas</option></select></label>${collectionCheckboxes([],'collections')}<button class="btn" type="submit">Aplicar ao rascunho</button><small>Substituir remove as associações anteriores. Você verá o resultado ao lado e na revisão.</small></form><section class="bulk-current"><h3>Coleções após as alterações</h3>${bulkCurrentProducts('collections')}</section></div>`;
}
function bulkApplyCollections(form){
  if(!canManage()||!bulkEditor||bulkEditor.busy)return;
  try{
    const data=new FormData(form),mode=data.get('mode'),names=[...new Set(data.getAll('collections'))];
    if(!['add','remove','replace'].includes(mode)||!names.length||names.some(name=>!db.collections.includes(name)))throw Error('Selecione pelo menos uma coleção válida.');
    for(const product of bulkEditor.drafts){const current=productCollections(product);assignProductCollections(product,mode==='add'?[...current,...names]:mode==='remove'?current.filter(name=>!names.includes(name)):names.slice());}
    renderBulkEditor();toast('Coleções aplicadas ao rascunho. Revise antes de salvar.');
  }catch(error){toast(error.message)}
}
function bulkVariationChoices(form){
  const name=form.elements.namedItem('attribute').value,option=attributeCatalog().find(item=>attributeKey(item.name)===attributeKey(name));
  const target=form.querySelector('.bulk-attribute-options');
  target.innerHTML=option?option.values.map(value=>`<label class="attribute-choice"><input class="attribute-choice-input" type="checkbox" name="values" value="${esc(value)}"><span>${colorDot(option.name,value)}${esc(value)}</span></label>`).join(''):'<small>Informe o nome e as opções do novo atributo abaixo.</small>';
  const custom=form.elements.namedItem('customName');custom.disabled=Boolean(option);custom.required=!option;custom.value='';custom.closest('.field').hidden=Boolean(option);
}
function bulkVariationPanel(){
  const catalog=attributeCatalog();
  return `<div class="bulk-config-layout"><form class="bulk-config-card" onsubmit="event.preventDefault();bulkApplyVariations(this)"><h3>Editar variações</h3><p>Aplique aos ${bulkEditor.drafts.length} produtos selecionados. Os demais atributos serão mantidos.</p><label class="field">Ação<select name="mode"><option value="add">Adicionar opções ao atributo</option><option value="remove">Remover opções do atributo</option><option value="replace">Substituir opções deste atributo</option><option value="removeAttribute">Remover este atributo dos produtos</option></select></label><label class="field">Atributo<select name="attribute" onchange="bulkVariationChoices(this.form)"><option value="">Novo atributo</option>${catalog.map(option=>`<option value="${esc(option.name)}">${esc(option.name)}</option>`).join('')}</select></label><div class="bulk-attribute-options attribute-choices"><small>Informe o nome e as opções do novo atributo abaixo.</small></div><label class="field">Nome do novo atributo<input name="customName" maxlength="40" placeholder="Ex.: Cor, Tamanho, Tecido" required></label><label class="field">Opções adicionais<textarea name="customValues" maxlength="2500" placeholder="Uma opção por linha. Ex.:\nBege\nCinza"></textarea><small>Use uma linha por opção. Medidas como 1,80 m são preservadas.</small></label><button class="btn" type="submit">Aplicar ao rascunho</button><small>Ao remover todas as opções, o atributo deixa de aparecer nesses produtos. O catálogo geral de atributos é mantido.</small></form><section class="bulk-current"><h3>Variações após as alterações</h3>${bulkCurrentProducts('variations')}</section></div>`;
}
function bulkApplyVariations(form){
  if(!canManage()||!bulkEditor||bulkEditor.busy)return;
  try{
    const data=new FormData(form),mode=data.get('mode'),catalog=attributeCatalog(),rawName=String(data.get('attribute')||data.get('customName')||'').trim();
    const option=catalog.find(item=>attributeKey(item.name)===attributeKey(rawName)),name=option?.name||rawName;
    let values=[...data.getAll('values'),...String(data.get('customValues')||'').split(/\r?\n/)].map(v=>String(v).trim()).filter(Boolean);
    values=[...new Map(values.map(v=>[attributeKey(v),option?.values.find(known=>attributeKey(known)===attributeKey(v))||v])).values()];
    if(!['add','remove','replace','removeAttribute'].includes(mode)||!name||name.length>40||mode!=='removeAttribute'&&!values.length||values.length>30||values.some(v=>v.length>80))throw Error('Confira o nome do atributo e selecione ou escreva até 30 opções.');
    const drafts=structuredClone(bulkEditor.drafts);
    for(const product of drafts){
      const variations=structuredClone(productVariations(product)),index=variations.findIndex(item=>attributeKey(item.name)===attributeKey(name)),previous=variations[index];
      if(mode==='removeAttribute'){if(index>=0)variations.splice(index,1);}
      else {
        const choices=mode==='add'?[...new Map([...(previous?.values||[]),...values].map(v=>[attributeKey(v),v])).values()]:mode==='remove'?(previous?.values||[]).filter(v=>!values.some(value=>attributeKey(value)===attributeKey(v))):values;
        if(index>=0){if(choices.length)variations[index]={name:previous.name,values:choices};else variations.splice(index,1);}
        else if(mode!=='remove')variations.push({name,values:choices});
      }
      validateBulkVariations(variations,product.name);product.variations=variations;
    }
    bulkEditor.drafts=drafts;
    if(['add','replace'].includes(mode))bulkEditor.attributeAdditions.push({name,values});
    renderBulkEditor();toast('Variações aplicadas ao rascunho. Revise antes de salvar.');
  }catch(error){toast(error.message)}
}
function bulkDisplayValue(key,value){
  if(['price','cost','promoPrice'].includes(key))return value===null?'Sem promoção':money(value);
  if(key==='active')return value?'Ativo':'Rascunho';
  if(key==='categories')return value.join(' · ')||'Sem coleção';
  if(key==='variations')return value.map(option=>option.name+': '+option.values.join(', ')).join(' · ')||'Sem variações';
  return String(value);
}
function bulkReviewPanel(){
  const changes=bulkEditorChanges();
  return `<div class="bulk-review-intro">${icon('check')}<div><h3>Você confirma estas alterações?</h3><p>${changes.length} de ${bulkEditor.drafts.length} produtos serão atualizados. Campos sem alteração serão preservados.</p></div></div><div class="bulk-review-list">${changes.map(change=>`<article><h3>${esc(change.name)}</h3>${change.fields.map(key=>`<div class="bulk-review-change"><strong>${bulkFieldLabels[key]}</strong><div><small>Atual</small><span>${esc(bulkDisplayValue(key,change.before[key]))}</span></div><div><small>Após salvar</small><span>${esc(bulkDisplayValue(key,change.after[key]))}</span></div></div>`).join('')}</article>`).join('')}</div>`;
}
function renderBulkEditor(){
  if(!bulkEditor)return;
  const count=bulkEditorChanges().length,tab=bulkEditor.tab;
  const content=bulkEditor.discard?`<div class="bulk-discard"><h3>Descartar as alterações deste rascunho?</h3><p>Os produtos publicados serão mantidos como estão.</p><div class="actions"><button class="btn" onclick="bulkEditor.discard=false;renderBulkEditor()">Continuar editando</button><button class="btn danger" onclick="discardBulkEditor()">Descartar rascunho</button></div></div>`:tab==='data'?bulkDataTable():tab==='collections'?bulkCollectionPanel():tab==='variations'?bulkVariationPanel():bulkReviewPanel();
  modal('Editar produtos em massa',`<div class="bulk-editor"><div class="bulk-editor-intro"><span>${bulkEditor.drafts.length} produtos selecionados</span><strong id="bulk-change-count" role="status">${bulkProductCount(count)} com alterações</strong></div><nav class="bulk-editor-tabs" aria-label="Etapas da edição em massa">${[['data','Dados dos produtos'],['collections','Coleções'],['variations','Variações'],['review','Revisão']].map(([key,label])=>`<button class="${tab===key?'active':''}" ${bulkEditor.busy?'disabled':''} aria-current="${tab===key?'step':'false'}" onclick="bulkSwitchTab('${key}')">${label}</button>`).join('')}</nav><div class="bulk-editor-notice" hidden role="status"></div><div class="bulk-editor-content">${content}</div><div class="bulk-editor-footer"><span>Alterações publicadas somente após salvar.</span><div class="actions"><button class="btn" ${bulkEditor.busy?'disabled':''} onclick="requestBulkClose()">Cancelar</button>${tab==='review'&&!bulkEditor.discard?`<button class="btn primary" ${bulkEditor.busy||!count?'disabled':''} onclick="saveBulkEditor()">${bulkEditor.busy?'Salvando…':'Salvar '+count+' produto'+(count===1?'':'s')}</button>`:`<button id="bulk-review-button" class="btn primary" ${bulkEditor.busy||!count||bulkEditor.discard?'disabled':''} onclick="bulkSwitchTab('review')">Revisar alterações</button>`}</div></div></div>`);
  const dialog=document.querySelector('#modal');dialog.classList.add('catalog-bulk-dialog');dialog.querySelector('.close').disabled=bulkEditor.busy;
  dialog.querySelector('.modal-body').scrollTop=0;
}
function requestBulkClose(){
  if(!bulkEditor||bulkEditor.busy)return;
  if(bulkEditorChanges().length){bulkEditor.discard=true;renderBulkEditor();}else discardBulkEditor();
}
function discardBulkEditor(){if(bulkEditor?.busy)return;bulkEditor=null;closeModalBeforeBulk();}
const closeModalBeforeBulk=closeModal;
closeModal=()=>bulkEditor&&document.querySelector('#modal')?.classList.contains('catalog-bulk-dialog')?requestBulkClose():closeModalBeforeBulk();
const toastBeforeBulkEditor=toast;
toast=message=>{const notice=bulkEditor&&document.querySelector('.bulk-editor-notice');if(notice){notice.hidden=false;notice.textContent=message;return;}return toastBeforeBulkEditor(message);};
document.addEventListener('cancel',event=>{if(event.target.id==='modal'&&bulkEditor){event.preventDefault();requestBulkClose()}},true);
window.addEventListener('beforeunload',event=>{if(bulkEditorChanges().length){event.preventDefault();event.returnValue=''}});
async function saveBulkEditor(){
  if(!canManage()||!bulkEditor||bulkEditor.busy||bulkEditor.tab!=='review'||bulkEditor.discard)return;
  const editor=bulkEditor;
  try{
    const changes=bulkValidateChanges();editor.busy=true;renderBulkEditor();
    await commitCatalogChanges(next=>{
      for(const original of editor.originals){const live=next.products.find(p=>p.id===original.id);if(!live||JSON.stringify(live)!==JSON.stringify(original))throw Error('O produto “'+original.name+'” mudou em outra sessão. Cancele o rascunho e reabra o editor para revisar a versão atual.');}
      for(const change of changes){const product=next.products.find(p=>p.id===change.id);for(const key of change.fields)if(key==='categories')assignProductCollections(product,change.after.categories);else product[key]=structuredClone(change.after[key]);}
      const additions=editor.attributeAdditions.map(option=>({...option,values:option.values.filter(value=>changes.some(change=>change.fields.includes('variations')&&change.after.variations.some(v=>attributeKey(v.name)===attributeKey(option.name)&&v.values.some(item=>attributeKey(item)===attributeKey(value)))))})).filter(option=>option.values.length);
      if(additions.length){
        if(JSON.stringify(next.attributeCatalog??null)!==editor.catalogBaseline)throw Error('O catálogo de atributos mudou. Cancele o rascunho e reabra o editor.');
        const catalog=structuredClone(attributeCatalog());
        for(const option of additions){let entry=catalog.find(item=>attributeKey(item.name)===attributeKey(option.name));if(!entry){entry={name:option.name,values:[]};catalog.push(entry)}for(const value of option.values)if(!entry.values.some(item=>attributeKey(item)===attributeKey(value)))entry.values.push(value);}
        if(catalog.length>30||catalog.some(option=>option.values.length>30))throw Error('O catálogo aceita até 30 atributos e 30 opções por atributo.');
        next.attributeCatalog=catalog;
      }
    });
    bulkEditor=null;catalogSelection.clear();closeModalBeforeBulk();render();toast(bulkProductCount(changes.length)+(changes.length===1?' atualizado.':' atualizados.'));
  }catch(error){editor.busy=false;renderBulkEditor();toast(catalogSaveError(error));}
}
