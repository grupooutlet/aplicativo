// Menus have their own draft and are published explicitly, independently of store design.
const menuLocations=[['header','Cabeçalho'],['footerAbout','Rodapé · primeira coluna'],['footerHelp','Rodapé · segunda coluna']];
const menuLinkTypes=[['group','Grupo de coleções'],['home','Página inicial'],['catalog','Todos os produtos'],['collection','Coleção'],['product','Produto'],['page','Página da loja'],['account','Minha conta / Meus pedidos'],['cart','Carrinho'],['checkout','Checkout'],['admin','Painel da loja'],['external','Link externo']];
let menusDraft=null,menusBaseline=null,menusSaving=false;
function fallbackStoreMenus(){
 const link=(id,label,type,target='')=>({id,label,type,target:String(target),children:[],newTab:false});
 return {locations:{header:'main-menu',footerAbout:'footer-about',footerHelp:'footer-help'},menus:[
  {id:'main-menu',name:'Menu principal',active:true,items:[link('all-products','Todos os móveis','catalog'),...db.collections.map((name,i)=>link('collection-'+(i+1),name,'collection',name))]},
  {id:'footer-about',name:'Sobre a loja',active:true,items:db.pages.filter(p=>p.active).map(p=>link('page-'+p.id,p.title,'page',p.id))},
  {id:'footer-help',name:'Conte com a gente',active:true,items:[link('my-orders','Acompanhar meus pedidos','account'),link('admin-panel','Acessar o sistema da loja','admin')]}
 ]};
}
function publishedMenus(){return Array.isArray(db.navigation?.menus)?db.navigation:fallbackStoreMenus();}
function menusDirty(){return Boolean(menusDraft&&JSON.stringify(menusDraft)!==JSON.stringify(menusBaseline));}
function editableMenus(){const published=publishedMenus();if(!menusDraft||(!menusDirty()&&JSON.stringify(menusBaseline)!==JSON.stringify(published))){menusBaseline=structuredClone(published);menusDraft=structuredClone(published);}return menusDraft;}
function remapMenuCollection(items,previous,name){for(const item of items||[]){if(item.type==='collection'&&item.target===previous){item.target=name;if(item.label===previous)item.label=name;}remapMenuCollection(item.children,previous,name);}}
function menuItemLocation(items,id,parent=null){for(let index=0;index<items.length;index++){const item=items[index];if(item.id===id)return {item,index,list:items,parent};const found=menuItemLocation(item.children||[],id,item);if(found)return found;}return null;}
function menuItemDepth(items,id,depth=1){for(const item of items){if(item.id===id)return depth;const found=menuItemDepth(item.children||[],id,depth+1);if(found)return found;}return 0;}
function menuTreeHeight(item){return 1+Math.max(0,...(item.children||[]).map(menuTreeHeight));}
function menuTarget(item){
 const routes={home:'/loja',catalog:'/loja/catalogo?colecao=Todos',account:'/loja/conta',cart:'/loja/carrinho',checkout:'/loja/checkout',admin:'/app'};
 if(routes[item.type])return {href:routes[item.type]};
 if(item.type==='collection')return visibleCollections().includes(item.target)?{href:'/loja/catalogo',collection:item.target}:null;
 if(item.type==='product')return db.products.some(p=>String(p.id)===String(item.target)&&p.active)?{href:'/loja/produto/'+Number(item.target)}:null;
 if(item.type==='page')return db.pages.some(p=>String(p.id)===String(item.target)&&p.active)?{href:'/loja/pagina/'+Number(item.target)}:null;
 if(item.type==='external'){try{const url=new URL(item.target);if(url.protocol==='https:'&&!/\s/.test(item.target))return {href:url.href};}catch{} }
 return null;
}
function menuLinkMarkup(item,extraClass=''){
 const target=menuTarget(item);if(!target)return '';
 const collection=target.collection&&!item.newTab?` onclick="catalogCategory=decodeURIComponent('${encodeURIComponent(target.collection).replace(/'/g,'%27')}');catalogQuery=''"`:'';
 // A query parameter carries collection selection into a separate tab.
 const href=target.collection?'/loja/catalogo?colecao='+encodeURIComponent(target.collection):target.href;
 return `<a class="${extraClass}" href="${esc(href)}"${collection}${item.newTab?' target="_blank" rel="noopener noreferrer"':''}>${esc(item.label)}</a>`;
}
function menuTreeMarkup(items,depth=1){return items.map(item=>{
 if(item.type!=='group'&&!menuTarget(item))return '';
 const children=depth<3?menuTreeMarkup(item.children||[],depth+1):'';
 if(item.type==='group'&&!children)return '';
 return children?`<details class="store-menu-branch"><summary>${esc(item.label)}${icon('down')}</summary><div class="store-submenu">${menuLinkMarkup(item,'store-menu-overview')}${children}</div></details>`:menuLinkMarkup(item);
}).join('');}
function placedMenu(location){const document=publishedMenus();return document.menus.find(menu=>menu.id===document.locations?.[location]&&menu.active);}
storeCollectionLinks=()=>{const menu=placedMenu('header');return menu?menuTreeMarkup(menu.items):'';};
storeFooter=()=>{
 const column=location=>{const menu=placedMenu(location);return menu?`<nav class="store-footer-menu" aria-label="${esc(menu.name)}"><strong>${esc(menu.name)}</strong>${menuTreeMarkup(menu.items)}</nav>`:'';};
 return `<footer class="store-footer"><div><img src="assets/logo.webp" alt="Grupo Outlet"><small>Sua casa merece esse cuidado.<br>${esc(db.settings.address)}</small></div>${column('footerAbout')}${column('footerHelp')}</footer>`;
};
function menusSaveBar(){return `<span class="subtle" role="status">${menusSaving?'Salvando menus…':menusDirty()?'Você tem mudanças não salvas.':'Todas as mudanças estão salvas.'}</span><div class="actions"><button class="btn" onclick="cancelMenusChanges()" ${!menusDirty()||menusSaving?'disabled':''}>Cancelar mudanças</button><button class="btn primary" onclick="saveMenus(this)" ${!menusDirty()||menusSaving?'disabled':''}>Salvar mudanças</button></div>`;}
function refreshMenusSaveBar(){const bar=$('#menus-save-bar');if(bar)bar.innerHTML=menusSaveBar();}
function lockMenuFields(locked){for(const field of document.querySelectorAll('.menu-editor-layout input,.menu-editor-layout button,.menu-placement-grid select'))field.disabled=locked;}
function menusPage(){
 const document=editableMenus(),id=decodeURIComponent(routePath().split('/')[3]||''),menu=document.menus.find(m=>m.id===id);
 const save=`<div class="menus-save-bar" id="menus-save-bar">${menusSaveBar()}</div>`;
 if(id&&!menu)return heading('Menu não encontrado','Selecione um menu da loja.',`<a class="btn" href="/app/menus">Voltar para menus</a>`);
 if(menu)return `<a class="back-link" href="/app/menus">${icon('back')}Menus</a>`+heading('Editar menu','Crie grupos, como Sala de estar, e adicione as coleções dentro deles.')+save+
  `<div class="menu-editor-layout"><section class="card menu-items-card"><div class="card-header"><div><h2>Itens do menu</h2><p>Arraste ou use as setas. Os botões de recuo criam até três níveis.</p></div><div class="menu-create-actions">${button('Criar grupo',`onclick="menuItemModal('${menu.id}','','group')"`,'','layers')}${button('Adicionar item',`onclick="menuItemModal('${menu.id}')"`,'primary','plus')}</div></div><div class="menu-items-tree">${menuEditorRows(menu.items,menu.id)||'<div class="empty">Adicione o primeiro link deste menu.</div>'}</div></section><aside class="stack"><section class="card pad"><h2>Informações do menu</h2><label class="field">Nome do menu<input value="${esc(menu.name)}" maxlength="80" required oninput="changeMenuName('${menu.id}',this.value)"></label><label class="check-row"><input type="checkbox" ${menu.active?'checked':''} onchange="changeMenuActive('${menu.id}',this.checked)">Menu ativo</label><p class="subtle">No rodapé, o nome também será o título da coluna.</p></section><section class="card pad menu-positions"><h2>Onde exibir</h2>${menuLocations.map(([slot,label])=>`<label class="check-row"><input type="checkbox" ${document.locations[slot]===menu.id?'checked':''} onchange="placeEditedMenu('${menu.id}','${slot}',this.checked)">${label}</label>`).join('')}<p class="subtle">Cada posição exibe um menu. A troca será publicada ao salvar.</p></section><section class="card pad"><button class="btn danger" onclick="deleteMenuModal('${menu.id}')">${icon('trash')}Excluir menu</button></section></aside></div>`;
 return heading('Menus','Organize a navegação do cabeçalho e do rodapé.',button('Criar menu','onclick="newMenuModal()"','primary','plus'))+save+
  `<section class="card menu-placements"><div class="card-header"><div><h2>Menus na loja</h2><p>Escolha qual menu aparece em cada posição.</p></div></div><div class="menu-placement-grid">${menuLocations.map(([slot,label])=>`<label class="field">${label}<select onchange="setMenuPlacement('${slot}',this.value)"><option value="">Não exibir menu</option>${document.menus.map(m=>`<option value="${m.id}" ${document.locations[slot]===m.id?'selected':''}>${esc(m.name)}${m.active?'':' · Desativado'}</option>`).join('')}</select></label>`).join('')}</div></section>
  <section class="card"><div class="tablewrap"><table class="menus-table"><thead><tr><th>Menu</th><th>Itens</th><th>Exibição</th><th>Status</th><th></th></tr></thead><tbody>${document.menus.map(menu=>`<tr><td><a class="text-link" href="/app/menus/${menu.id}">${esc(menu.name)}</a></td><td>${flattenMenuItems(menu.items).length} links</td><td><div class="collection-tags">${menuLocations.filter(([slot])=>document.locations[slot]===menu.id).map(([,label])=>`<span>${label}</span>`).join('')||'<small>Sem posição definida</small>'}</div></td><td><span class="badge ${menu.active?'green':'gray'}">${menu.active?'Ativo':'Desativado'}</span></td><td><a class="btn small" href="/app/menus/${menu.id}">${icon('edit')}Editar</a></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Crie um menu para organizar os links da loja.</td></tr>'}</tbody></table></div></section>`;
}
function flattenMenuItems(items){return items.flatMap(item=>[item,...flattenMenuItems(item.children||[])]);}
function menuDestinationDescription(item){const type=menuLinkTypes.find(([value])=>value===item.type)?.[1]||'Link';return type+(item.target?' · '+(item.type==='product'?db.products.find(p=>String(p.id)===item.target)?.name||'Produto indisponível':item.type==='page'?db.pages.find(p=>String(p.id)===item.target)?.title||'Página indisponível':item.target):'');}
function menuEditorRows(items,menuId,depth=1){return items.map((item,index)=>`<div class="menu-tree-node"><div class="menu-item-row" draggable="true" ondragstart="dragMenuItem('${item.id}',event)" ondragover="event.preventDefault()" ondrop="dropMenuItem('${menuId}','${item.id}',event)"><span class="drag-handle" aria-hidden="true">⠿</span><div class="menu-item-copy"><strong>${esc(item.label)}</strong><small>${esc(menuDestinationDescription(item))}${item.newTab?' · Nova aba':''}</small></div><div class="menu-item-actions"><button class="btn small icon-button" aria-label="Subir ${esc(item.label)}" onclick="moveMenuItem('${menuId}','${item.id}',-1)" ${index===0?'disabled':''}>↑</button><button class="btn small icon-button" aria-label="Descer ${esc(item.label)}" onclick="moveMenuItem('${menuId}','${item.id}',1)" ${index===items.length-1?'disabled':''}>↓</button><button class="btn small icon-button" aria-label="Diminuir recuo de ${esc(item.label)}" onclick="outdentMenuItem('${menuId}','${item.id}')" ${depth===1?'disabled':''}>←</button><button class="btn small icon-button" aria-label="Criar submenu com ${esc(item.label)}" onclick="indentMenuItem('${menuId}','${item.id}')" ${index===0||depth+menuTreeHeight(item)>3?'disabled':''}>→</button><button class="btn small icon-button" aria-label="Editar ${esc(item.label)}" onclick="menuItemModal('${menuId}','${item.id}')">${icon('edit')}</button><button class="btn small danger icon-button" aria-label="Remover ${esc(item.label)}" onclick="removeMenuItem('${menuId}','${item.id}')">${icon('trash')}</button></div></div>${depth<3&&['group','collection'].includes(item.type)?`<button class="menu-add-collections" onclick="menuSubcollectionsModal('${menuId}','${item.id}')">${icon('plus')}Adicionar subcoleções</button>`:''}${item.children?.length?`<div class="menu-children">${menuEditorRows(item.children,menuId,depth+1)}</div>`:''}</div>`).join('');}
function newMenuModal(){if(!canConfigureSite()||menusSaving)return;modal('Criar menu',`<form onsubmit="event.preventDefault();createMenuDraft(this)">${field('Nome do menu','name','','text','required maxlength="80" placeholder="Ex.: Menu principal"')}<div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button type="submit" class="btn primary">Criar menu</button></div></form>`);}
function createMenuDraft(form){if(!canConfigureSite()||menusSaving)return;const name=form.elements.namedItem('name').value.trim();if(!name)return toast('Informe o nome do menu.');const model=editableMenus();if(model.menus.length>=40)return toast('O limite é de 40 menus.');const id=crypto.randomUUID();model.menus.push({id,name,active:true,items:[]});closeModal();go('/app/menus/'+id);}
function changeMenuName(id,name){if(!canConfigureSite()||menusSaving)return;editableMenus().menus.find(m=>m.id===id).name=name;refreshMenusSaveBar();}
function changeMenuActive(id,active){if(!canConfigureSite()||menusSaving)return;editableMenus().menus.find(m=>m.id===id).active=active;refreshMenusSaveBar();}
function setMenuPlacement(slot,id){if(!canConfigureSite()||!menuLocations.some(([name])=>name===slot))return;editableMenus().locations[slot]=id;refreshMenusSaveBar();}
function placeEditedMenu(id,slot,checked){setMenuPlacement(slot,checked?id:'');}
function menuItemModal(menuId,itemId='',initialType='collection'){
 if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),item=menuItemLocation(menu.items,itemId)?.item||{label:'',type:initialType,target:'',newTab:false};
 modal(itemId?'Editar item do menu':'Adicionar item ao menu',`<form onsubmit="event.preventDefault();saveMenuItemDraft(this,'${menuId}','${itemId}')">${field('Título no menu','label',item.label,'text','required maxlength="100" placeholder="Ex.: Sofás"')}<label class="field">Tipo de item<select name="type" onchange="changeMenuItemType(this.form)">${menuLinkTypes.map(([value,label])=>`<option value="${value}" ${item.type===value?'selected':''}>${label}</option>`).join('')}</select></label><div id="menu-link-destination">${menuDestinationField(item.type,item.target)}</div><label class="check-row" id="menu-new-tab" ${item.type==='group'?'hidden':''}><input name="newTab" type="checkbox" ${item.newTab?'checked':''}>Abrir em uma nova aba</label><div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button type="submit" class="btn primary">Confirmar item</button></div></form>`);
}
function menuDestinationField(type,target=''){
 if(type==='group')return '<p class="subtle menu-link-hint">Crie um grupo como Sala de estar. Depois, use Adicionar subcoleções para escolher as coleções que ficam dentro dele.</p>';
 if(type==='external')return field('Endereço do link','target',target,'url','required maxlength="2048" placeholder="https://"');
 const options=type==='collection'?db.collections.map(c=>[c,c+(collectionConfig(c).active===false?' · Desativada':'')]):type==='product'?db.products.map(p=>[String(p.id),p.name+(p.active?'':' · Rascunho')]):type==='page'?db.pages.map(p=>[String(p.id),p.title+(p.active?'':' · Desativada')]):null;
 if(!options)return '<p class="subtle menu-link-hint">O link abrirá a página escolhida da loja.</p>';
 return `<label class="field">${type==='collection'?'Coleção':type==='product'?'Produto':'Página'}<select name="target" required><option value="">Selecione um destino</option>${options.map(([id,label])=>`<option value="${esc(id)}" ${id===String(target)?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
}
function changeMenuItemType(form){const type=form.elements.namedItem('type').value;$('#menu-link-destination').innerHTML=menuDestinationField(type);$('#menu-new-tab').hidden=type==='group';}
function saveMenuItemDraft(form,menuId,itemId){
 if(!canConfigureSite()||menusSaving)return;const fields=Object.fromEntries(new FormData(form)),label=String(fields.label||'').trim(),type=fields.type,target=String(fields.target||'').trim();
 if(!label||label.length>100)return toast('Informe um título de até 100 caracteres.');
 if(type==='external'){try{if(new URL(target).protocol!=='https:'||/\s/.test(target))throw Error();}catch{return toast('Use um endereço completo começando por https://.');}}
 if(['collection','product','page'].includes(type)&&!target)return toast('Selecione o destino do link.');
 const menu=editableMenus().menus.find(m=>m.id===menuId),existing=menuItemLocation(menu.items,itemId)?.item;
 if(!menuLinkTypes.some(([value])=>value===type))return;
 const values={label,type,target:type==='group'?'':target,newTab:type!=='group'&&form.elements.namedItem('newTab').checked};
 if(existing)Object.assign(existing,values);else{if(flattenMenuItems(editableMenus().menus.flatMap(m=>m.items)).length>=500)return toast('O limite é de 500 links.');menu.items.push({id:crypto.randomUUID(),...values,children:[]});}
 closeModal();render();
}
function menuSubcollectionsModal(menuId,parentId){
 if(!canConfigureSite()||menusSaving)return;
 const menu=editableMenus().menus.find(m=>m.id===menuId),parent=menu&&menuItemLocation(menu.items,parentId)?.item;
 if(!parent||menuItemDepth(menu.items,parentId)>=3)return;
 const linked=new Set(parent.children.filter(item=>item.type==='collection').map(item=>item.target));
 modal('Adicionar subcoleções',`<form onsubmit="event.preventDefault();addMenuSubcollections(this,'${menuId}','${parentId}')"><p class="subtle">Selecione as coleções que deseja colocar em <strong>${esc(parent.label)}</strong>.</p><div class="menu-collection-picker">${db.collections.map(name=>`<label class="check-row"><input type="checkbox" name="collections" value="${esc(name)}" ${linked.has(name)?'checked disabled':''}><span>${esc(name)}${linked.has(name)?'<small>Já adicionada</small>':collectionConfig(name).active===false?'<small>Desativada na loja</small>':''}</span></label>`).join('')||'<p class="empty">Cadastre uma coleção para adicioná-la ao menu.</p>'}</div><div class="form-actions">${button('Cancelar','type="button" onclick="closeModal()"')}<button class="btn primary" type="submit">Adicionar selecionadas</button></div></form>`);
}
function addMenuSubcollections(form,menuId,parentId){
 if(!canConfigureSite()||menusSaving)return;
 const model=editableMenus(),menu=model.menus.find(m=>m.id===menuId),parent=menu&&menuItemLocation(menu.items,parentId)?.item;
 if(!parent||menuItemDepth(menu.items,parentId)>=3)return;
 const linked=new Set(parent.children.filter(item=>item.type==='collection').map(item=>item.target));
 const names=[...new Set(new FormData(form).getAll('collections'))].filter(name=>db.collections.includes(name)&&!linked.has(name));
 if(!names.length)return toast('Selecione uma nova coleção.');
 if(flattenMenuItems(model.menus.flatMap(m=>m.items)).length+names.length>500)return toast('O limite é de 500 links.');
 parent.children.push(...names.map(name=>({id:crypto.randomUUID(),label:name,type:'collection',target:name,children:[],newTab:false})));
 closeModal();render();toast('Subcoleções adicionadas ao rascunho. Salve para publicar.');
}
function moveMenuItem(menuId,id,delta){if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),where=menuItemLocation(menu.items,id);if(!where)return;const to=where.index+delta;if(to<0||to>=where.list.length)return;where.list.splice(where.index,1);where.list.splice(to,0,where.item);render();}
function indentMenuItem(menuId,id){if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),where=menuItemLocation(menu.items,id);if(!where||where.index===0||menuItemDepth(menu.items,id)+menuTreeHeight(where.item)>3)return;const parent=where.list[where.index-1];where.list.splice(where.index,1);parent.children.push(where.item);render();}
function outdentMenuItem(menuId,id){if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),where=menuItemLocation(menu.items,id);if(!where?.parent)return;const parent=menuItemLocation(menu.items,where.parent.id);where.list.splice(where.index,1);parent.list.splice(parent.index+1,0,where.item);render();}
function dragMenuItem(id,event){event.dataTransfer.setData('text/plain',id);event.dataTransfer.effectAllowed='move';event.stopPropagation();}
function dropMenuItem(menuId,target,event){event.preventDefault();event.stopPropagation();if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),id=event.dataTransfer.getData('text/plain'),source=menuItemLocation(menu.items,id),destination=menuItemLocation(menu.items,target);if(!source||!destination||id===target)return;if(flattenMenuItems(source.item.children).some(item=>item.id===target))return;if(menuItemDepth(menu.items,target)+menuTreeHeight(source.item)-1>3)return toast('Use no máximo três níveis de menu.');source.list.splice(source.index,1);const to=destination.list.findIndex(item=>item.id===target);destination.list.splice(to,0,source.item);render();}
function removeMenuItem(menuId,id){if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===menuId),where=menuItemLocation(menu.items,id);if(!where)return;if(where.item.children.length){modal('Remover item e submenus',`<p>Remover <strong>${esc(where.item.label)}</strong> e seus submenus deste rascunho?</p><div class="form-actions">${button('Cancelar','onclick="closeModal()"')}<button class="btn danger" onclick="confirmRemoveMenuItem('${menuId}','${id}')">Remover do menu</button></div>`);}else{where.list.splice(where.index,1);render();}}
function confirmRemoveMenuItem(menuId,id){if(!canConfigureSite()||menusSaving)return;const where=menuItemLocation(editableMenus().menus.find(m=>m.id===menuId).items,id);if(where)where.list.splice(where.index,1);closeModal();render();}
function deleteMenuModal(id){if(!canConfigureSite()||menusSaving)return;const menu=editableMenus().menus.find(m=>m.id===id);modal('Excluir menu',`<p>Remover <strong>${esc(menu.name)}</strong> e seus links? As posições que usam este menu ficarão sem ele após salvar. Os produtos, coleções e páginas serão mantidos.</p><div class="form-actions">${button('Cancelar','onclick="closeModal()"')}<button class="btn danger" onclick="deleteMenuDraft('${id}')">Excluir do rascunho</button></div>`);}
function deleteMenuDraft(id){if(!canConfigureSite()||menusSaving)return;const model=editableMenus();model.menus=model.menus.filter(m=>m.id!==id);for(const [slot] of menuLocations)if(model.locations[slot]===id)model.locations[slot]='';closeModal();go('/app/menus');}
async function saveMenus(){
 if(!canConfigureSite()||menusSaving||!menusDirty())return;
 if(menusDraft.menus.some(m=>!m.name.trim()||m.name.trim().length>80))return toast('Informe um nome de até 80 caracteres para cada menu.');
 menusSaving=true;refreshMenusSaveBar();lockMenuFields(true);let committed=false;
 try{
  await settleAdminWrites();const next=structuredClone(menusDraft);for(const menu of next.menus)menu.name=menu.name.trim();
  await backendRequest('/rest/v1/rpc/save_navigation',{method:'POST',body:JSON.stringify({p_navigation:next,p_expected:db.navigation?menusBaseline:null})},true);
  committed=true;db.navigation=next;menusBaseline=structuredClone(next);menusDraft=structuredClone(next);
  await loadAdminState();toast('Menus salvos. A navegação da loja foi atualizada.');
 }catch(error){toast(committed?'Menus salvos. Não foi possível atualizar os outros dados do painel; atualize a página antes de continuar.':catalogSaveError(error));}
 finally{menusSaving=false;render();}
}
async function cancelMenusChanges(){if(menusSaving||!canConfigureSite())return;try{await settleAdminWrites();await loadAdminState();menusBaseline=null;menusDraft=null;render();toast('Mudanças nos menus descartadas.');}catch(error){toast(catalogSaveError(error));}}
const adminPageBeforeMenus=adminPage;
adminPage=page=>page==='menus'?menusPage():adminPageBeforeMenus(page);
navigation.splice(navigation.findIndex(item=>item[0]==='store-editor')+1,0,['menus','Menus','menu']);
// Collection links remain shareable and also work in separate tabs.
const routePathBeforeMenuQueries=routePath;
routePath=()=>routePathBeforeMenuQueries().split('?')[0];
let menuLastRoute='';
const renderBeforeMenuQueries=render;
render=()=>{const current=location.hash;if(current!==menuLastRoute){menuLastRoute=current;if(routePath()==='/loja/catalogo'){const query=new URLSearchParams(current.split('?')[1]||'');if(query.has('colecao')){catalogCategory=query.get('colecao');catalogQuery=query.get('q')||'';}}}return renderBeforeMenuQueries();};
