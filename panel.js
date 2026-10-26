// Administrative chrome is scoped to the panel; store and print styles remain independent.
Object.assign(paths,{collapse:'M4 3h16v18H4V3Zm4 0v18m7-13-3 4 3 4',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',palette:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a2 2 0 0 0 2-2 9 9 0 0 0-9-9ZM7 10h.01M9 6h.01M14 6h.01M17 10h.01',pin:'M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',refresh:'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2'});
let panelMenuFocus=null,panelUnreadOnly=false,panelWorkspaceCleanup=()=>{},panelOpenGroup=null,panelGroupRoute='';
paths.more='M4 12h.01M12 12h.01M20 12h.01';
const panelSectionGroups=[
 {id:'dashboard',name:'Início',icon:'home'},
 {id:'orders',name:'Pedidos',icon:'bag',children:[['deliveries','Entregas','truck']]},
 {id:'payments',name:'Pagamentos',icon:'wallet'},
 {id:'products',name:'Produtos',icon:'box',children:[['collections','Coleções','layers'],['inventory','Estoque','store'],['order-bumps','Order Bumps','plus']]},
 {id:'customers',name:'Clientes',icon:'users'},
 {id:'reports',name:'Análises',icon:'chart',children:[['reports','Relatórios','chart'],['live-view','Live View','globe']]},
 {label:'Canais de venda',children:[['themes','Loja virtual','store'],['menus','Menus','menu'],['pages','Páginas','page']]},
 {label:'Organização',children:[['team','Equipe e permissões','users'],['change-history','Histórico de alterações','clock']]}
];
function panelRouteFor(id){return '/app/'+(id==='dashboard'?'':id);}
function panelArea(page){return ['store-editor','theme-preview'].includes(page)?'themes':page;}
function panelGroupFor(page){const area=panelArea(page);return panelSectionGroups.find(group=>group.id&&group.children&&(group.id===area||group.children.some(([id])=>id===area)))?.id||null;}
function syncPanelGroup(page,force=false){const area=panelArea(page);if(force||panelGroupRoute!==area){panelGroupRoute=area;panelOpenGroup=panelGroupFor(area);}}
function panelCount(count,extra=''){return count?'<span class="count panel-nav-count '+extra+'" aria-label="'+count+' pedido'+(count===1?'':'s')+' com pagamento pendente">'+(count>99?'99+':count)+'</span>':'';}
function panelNavLink(id,name,glyph,page,sub=false){
 if(!allowed(id))return '';const active=panelArea(page)===id,count=id==='orders'?visibleOrders().filter(order=>order.status!=='cancelled'&&!order.paid).length:0;
 return '<a class="navitem '+(sub?'panel-nav-child ':'')+(active?'active':'')+'" href="'+panelRouteFor(id)+'" title="'+esc(name)+'"'+(active?' aria-current="page"':'')+'>'+icon(glyph)+'<span class="panel-nav-text">'+esc(name)+'</span>'+panelCount(count)+'</a>';
}
function panelNav(page){
 syncPanelGroup(page);
 return panelSectionGroups.map(group=>{
  if(group.label){const rows=group.children.map(([id,name,glyph])=>panelNavLink(id,name,glyph,page)).join('');return rows?'<div class="navlabel">'+esc(group.label)+'</div>'+rows:'';}
  const children=(group.children||[]).filter(([id])=>allowed(id)),hasParent=allowed(group.id);if(!hasParent&&!children.length)return '';
  if(!hasParent)return children.map(([id,name,glyph])=>panelNavLink(id,name,glyph,page)).join('');
  const open=panelOpenGroup===group.id;
  return '<div class="panel-nav-group"><div class="panel-nav-parent">'+(hasParent?panelNavLink(group.id,group.name,group.icon,page):'')+(children.length?'<button class="panel-nav-expand" title="'+(open?'Recolher':'Expandir')+' '+esc(group.name)+'" aria-label="'+(open?'Recolher':'Expandir')+' '+esc(group.name)+'" aria-expanded="'+open+'" onclick="togglePanelGroup(\''+group.id+'\')">'+icon('down')+'</button>':'')+'</div>'+(children.length&&open?'<div class="panel-nav-children">'+children.map(([id,name,glyph])=>panelNavLink(id,name,glyph,page,true)).join('')+'</div>':'')+'</div>';
 }).join('');
}
function togglePanelGroup(id){panelOpenGroup=panelOpenGroup===id?null:id;const nav=document.querySelector('.sidebar>nav'),page=routePath().split('/')[2]||'dashboard';if(nav){nav.innerHTML=panelNav(page);normalizeLinks();nav.querySelector('[onclick="togglePanelGroup(\''+id+'\')"]')?.focus();}}
function togglePanelSidebar(button){
 const aside=document.querySelector('.sidebar');if(!aside||window.innerWidth>900)return;
 const opening=!aside.classList.contains('open'),frame=document.querySelector('.shell');aside.inert=!opening;aside.classList.toggle('open',opening);if(frame)frame.inert=opening;document.body.classList.toggle('panel-menu-open',opening);button?.setAttribute('aria-expanded',String(opening));if(opening){panelMenuFocus=button;aside.querySelector('a')?.focus();}else panelMenuFocus?.focus();
}
function closePanelSidebar(){if(window.innerWidth>900)return;const aside=document.querySelector('.sidebar'),frame=document.querySelector('.shell');aside?.classList.remove('open');if(aside)aside.inert=true;if(frame)frame.inert=false;document.body.classList.remove('panel-menu-open');document.querySelector('[aria-controls="panel-navigation"]')?.setAttribute('aria-expanded','false');panelMenuFocus?.focus();}
function panelPosition(){return currentProfile?.role==='master'?(masterPreviewPosition==='Principal'?'Principal':'Prévia: '+masterPreviewPosition):currentProfile?.position||role;}
function panelMobileItems(){return [['dashboard','Início','home'],['orders','Pedidos','bag'],allowed('products')?['products','Produtos','box']:['inventory','Estoque','store'],['deliveries','Entregas','truck']].filter(([id])=>allowed(id));}
function panelMobileNavigation(page){
 const items=panelMobileItems(),area=panelArea(page),current=area==='dashboard'?'dashboard':items.some(([id])=>id===area)?area:panelGroupFor(area)==='products'&&items.some(([id])=>id==='products')?'products':null;
 return '<nav class="panel-mobile-dock" aria-label="Navegação rápida">'+items.map(([id,label,glyph])=>'<a class="panel-dock-item '+(current===id?'active':'')+'" href="'+panelRouteFor(id)+'"'+(current===id?' aria-current="page"':'')+'><span class="panel-dock-icon">'+icon(glyph)+(id==='orders'?panelCount(visibleOrders().filter(order=>order.status!=='cancelled'&&!order.paid).length,'panel-dock-count'):'')+'</span><span>'+label+'</span></a>').join('')+'<button class="panel-dock-item '+(!current?'active':'')+'" aria-label="Mais opções" aria-controls="panel-navigation" aria-expanded="false" onclick="togglePanelSidebar(this)"><span class="panel-dock-icon">'+icon('more')+'</span><span>Mais</span></button></nav>';
}
function panelAlertReadSet(){return new Set(safeJson(localStore.getItem('forte-panel-alerts-'+(currentProfile?.user_id||'current')),[]));}
function panelAlerts(){
 const orders=isDeliveryDriverView()?deliveryOrders():visibleOrders(),alerts=[];
 for(const order of orders.filter(order=>order.status!=='cancelled'&&order.status!=='delivered')){
  if(!order.paid)alerts.push({id:'pay-'+order.id,area:'Pagamento',icon:'wallet',title:'Pagamento pendente · #'+order.id,body:money(orderTotal(order))+' a receber. Confira a condição registrada no pedido.',route:'/app/'+(isDeliveryDriverView()?'deliveries/order/':'orders/')+order.id,time:order.createdAt||order.date});
  if(!order.deliveryDate)alerts.push({id:'schedule-'+order.id,area:'Entrega',icon:'calendar',title:'Agendamento pendente · #'+order.id,body:'Defina uma data para organizar a entrega ou retirada.',route:'/app/'+(isDeliveryDriverView()?'deliveries/order/':'orders/')+order.id,time:order.createdAt||order.date});
 }
 if(allowed('inventory'))for(const product of db.products.filter(product=>product.active&&available(product.id)<=Number(product.min||0)).slice(0,12))alerts.push({id:'stock-'+product.id+'-'+available(product.id),area:'Estoque',icon:'box',title:available(product.id)===0?'Produto esgotado':'Estoque baixo',body:product.name+' · '+available(product.id)+' unidade(s) disponível(is).',route:'/app/inventory',time:''});
 return alerts.slice(0,30);
}
function panelAlertsMarkup(){
 const read=panelAlertReadSet(),alerts=panelAlerts().filter(alert=>!panelUnreadOnly||!read.has(alert.id));
 return '<div class="panel-alert-toolbar"><button class="btn small" onclick="toggleUnreadPanelAlerts()">'+(panelUnreadOnly?'Mostrar todos':'Só não lidos')+'</button><button class="text-link" onclick="markAllPanelAlertsRead()">'+icon('check')+'Marcar como lidos</button></div><div class="panel-alert-list">'+(alerts.length?alerts.map(alert=>'<button class="panel-alert-item '+(read.has(alert.id)?'read':'unread')+'" onclick="openPanelAlert(\''+alert.id+'\')"><span class="panel-alert-dot"></span><div><small>'+esc(alert.area)+(alert.time?' · '+esc(orderCreatedParts({createdAt:alert.time,date:String(alert.time).slice(0,10)}).date):'')+'</small><strong>'+icon(alert.icon)+esc(alert.title)+'</strong><p>'+esc(alert.body)+'</p></div></button>').join(''):'<div class="empty">'+icon('check')+'<h3>Tudo em dia por aqui</h3><p>Nenhuma pendência neste filtro.</p></div>')+'</div>';
}
function openPanelAlerts(){modal('Alertas',panelAlertsMarkup());document.querySelector('#modal')?.classList.add('panel-alert-dialog');}
function refreshPanelAlerts(){const body=document.querySelector('.panel-alert-dialog .modal-body');if(body)body.innerHTML=panelAlertsMarkup();}
function toggleUnreadPanelAlerts(){panelUnreadOnly=!panelUnreadOnly;refreshPanelAlerts();}
function markAllPanelAlertsRead(){const read=panelAlertReadSet();panelAlerts().forEach(alert=>read.add(alert.id));localStore.setItem('forte-panel-alerts-'+(currentProfile?.user_id||'current'),JSON.stringify([...read].slice(-200)));refreshPanelAlerts();document.querySelectorAll('.panel-alert-counter').forEach(counter=>counter.remove());}
function openPanelAlert(id){const alert=panelAlerts().find(alert=>alert.id===id);if(!alert)return;const read=panelAlertReadSet();read.add(id);localStore.setItem('forte-panel-alerts-'+(currentProfile?.user_id||'current'),JSON.stringify([...read].slice(-200)));closeModal();go(alert.route);}
const modalBeforePanel=modal;
modal=(...args)=>{document.querySelector('#modal')?.classList.remove('panel-alert-dialog');return modalBeforePanel(...args);};
shell=(page,content)=>{
 const name=currentProfile?.name||'Grupo Outlet',position=panelPosition(),unread=panelAlerts().filter(alert=>!panelAlertReadSet().has(alert.id)).length;
 const driverRefresh=isDeliveryDriverView()?'<button class="navitem" aria-label="Atualizar entregas" onclick="'+(currentProfile?.role==='driver'?'refreshDriverDeliveries()':'render()')+'">'+icon('refresh')+'<span>Atualizar entregas</span></button>':'';
 return `<aside class="sidebar" id="panel-navigation" aria-label="Menu do painel">
  <div class="panel-brand-row"><a class="wordmark official-brand" href="/app" aria-label="Grupo Outlet · início do painel"><img src="assets/logo.webp" alt="Grupo Outlet" width="767" height="272"></a><button class="sidebar-close" onclick="closePanelSidebar()" aria-label="Fechar menu">×</button></div>
  <nav aria-label="Navegação principal">${panelNav(page)}</nav>
  <div class="sidebar-bottom">${driverRefresh}${panelNavLink('settings','Configurações','settings',page)}
   <a class="navitem panel-open-store" href="/loja" target="_blank" rel="noopener noreferrer" title="Ver minha loja">${icon('external')}<span class="panel-nav-text">Ver minha loja</span></a>
   <div class="panel-account-row"><button class="panel-store-account" onclick="roleModal()" aria-label="Conta e visualizações" title="${esc(name)}"><span class="avatar">${esc(initials(name))}</span><span class="panel-nav-text"><strong>${esc(name)}</strong><small>${esc(position)}</small></span>${icon('down')}</button><button class="panel-notifications" aria-label="Abrir alertas" onclick="openPanelAlerts()">${icon('bell')}${unread?'<span class="panel-alert-counter">'+(unread>99?'99+':unread)+'</span>':''}</button></div>
  </div></aside><div class="sidebar-backdrop" onclick="closePanelSidebar()"></div>
  <div class="shell"><header class="panel-mobile-header"><a class="panel-mobile-brand" href="/app" aria-label="Grupo Outlet · início do painel"><img src="assets/logo.webp" alt="Grupo Outlet" width="767" height="272"></a><div class="panel-mobile-actions"><button class="panel-notifications" aria-label="Abrir alertas" onclick="openPanelAlerts()">${icon('bell')}${unread?'<span class="panel-alert-counter">'+(unread>99?'99+':unread)+'</span>':''}</button><button class="panel-mobile-profile" aria-label="Conta e visualizações" title="${esc(name)} · ${esc(position)}" onclick="roleModal()"><span>${esc(initials(name))}</span></button></div></header><div class="panel-scroll" id="panel-workspace" data-route="${esc(routePath())}" role="region" aria-label="Conteúdo do painel" tabindex="0"><main class="main">${content}<footer class="footer"><span>© 2026 Forte Outlet · Feito por Magemind.</span><span>Dados sincronizados com a loja</span></footer></main></div><div class="panel-scroll-fade" aria-hidden="true"></div>${panelMobileNavigation(page)}</div>`;
};
function updatePanelScrollFade(scroll,shell){shell.classList.toggle('panel-has-more',scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop>2);}
function mountPanelWorkspace(){
 const scroll=document.querySelector('#panel-workspace'),frame=document.querySelector('.shell');if(!scroll||!frame||document.body?.classList.contains('panel-editor'))return;
 const update=()=>updatePanelScrollFade(scroll,frame);update();scroll.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(update):null;observer?.observe(scroll);const main=scroll.querySelector('.main');if(main)observer?.observe(main);
 panelWorkspaceCleanup=()=>{observer?.disconnect();scroll.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
}
const goBeforePanelWorkspace=go;
go=path=>{if(path.startsWith('/app'))syncPanelGroup(path.split('/')[2]||'dashboard',true);const result=goBeforePanelWorkspace(path);if(path.startsWith('/app'))document.querySelector('#panel-workspace')?.scrollTo?.(0,0);return result;};
const panelRenderBefore=render;
render=()=>{
 const previous=document.querySelector('#panel-workspace'),previousRoute=previous?.dataset.route,previousTop=previous?.scrollTop||0;
 panelWorkspaceCleanup();panelWorkspaceCleanup=()=>{};
 const active=routePath().startsWith('/app')&&booted&&authSession&&['master','admin','driver'].includes(currentProfile?.role);
 document.body?.classList.toggle('admin-panel',Boolean(active));document.body?.classList.remove('panel-collapsed');document.body?.classList.toggle('panel-editor',Boolean(active&&routePath().startsWith('/app/store-editor')));
 document.body?.classList.remove('panel-menu-open');const result=panelRenderBefore();
 if(active&&routePath().startsWith('/app/store-editor')&&document.body?.dataset)document.body.dataset.themeEditorPane=typeof themeEditorPane==='string'?themeEditorPane:'preview';
 if(active){const aside=document.querySelector('.sidebar');if(aside)aside.inert=window.innerWidth<=900&&!aside.classList.contains('open');}
 if(active){const h=document.querySelector('.main>.heading h1');if(h&&!h.querySelector('.icon')){const page=panelArea(routePath().split('/')[2]||'dashboard'),glyph=navigation.find(row=>row[0]===page)?.[2]||'home';h.insertAdjacentHTML('afterbegin',icon(glyph));}}
 if(active){const scroll=document.querySelector('#panel-workspace');if(scroll&&previousRoute===routePath())scroll.scrollTop=previousTop;mountPanelWorkspace();}
 return result;
};
window.addEventListener('resize',()=>{const aside=document.querySelector('.sidebar');if(!aside)return;if(window.innerWidth>900){aside.classList.remove('open');document.body.classList.remove('panel-menu-open');document.querySelector('[aria-controls="panel-navigation"]')?.setAttribute('aria-expanded','false');const frame=document.querySelector('.shell');if(frame)frame.inert=false;}aside.inert=window.innerWidth<=900&&!aside.classList.contains('open');});
document.addEventListener('keydown',event=>{if(window.innerWidth>900)return;const aside=document.querySelector('.sidebar.open');if(!aside)return;if(event.key==='Escape'){event.preventDefault();closePanelSidebar();}if(event.key==='Tab'){const nodes=[...aside.querySelectorAll('a,button')].filter(node=>!node.disabled&&node.getClientRects().length);if(!nodes.length)return;if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}});
