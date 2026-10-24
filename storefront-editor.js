const storefront=(()=>{
  const labels={banner:'Banner',collection:'Coleção de produtos',image:'Imagem com texto',video:'Vídeo',text:'Texto',benefits:'Diferenciais da loja'};
  const defaultBenefits=[
    {icon:'truck',title:'Entrega com cuidado',body:'Consulte sua região'},
    {icon:'wallet',title:'Compra do seu jeito',body:'Combine o pagamento com a loja'},
    {icon:'shield',title:'Atendimento de verdade',body:'Nossa equipe cuida de você'},
    {icon:'store',title:'Sua loja de confiança',body:'Visite nossa loja física'}
  ];
  let selected='home-hero',previewSize='desktop',draft=null,baseline=null,saving=false,uploading=false;
  let previewRoute='/loja',previewCategory='Todos',previewView='home',previewIdentity='current';
  const channel=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
  const editing=()=>routePath().startsWith('/app/store-editor');
  function ensureDraft(){
    if(!draft || (!dirty() && JSON.stringify(baseline)!==JSON.stringify(db.storefront))){baseline=structuredClone(db.storefront);draft=structuredClone(db.storefront)}
    return draft;
  }
  const home=()=>editing()?ensureDraft():db.storefront;
  const dirty=()=>Boolean(draft&&JSON.stringify(draft)!==JSON.stringify(baseline));
  const section=()=>home().sections.find(s=>s.id===selected);
  const photo=(value)=>{const url=String(value||'').trim();return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url)||/^https?:\/\//i.test(url)?url:''};
  const shopLink=(value)=>{const url=String(value||'').trim();return /^\/loja(?:\/|$)/.test(url)||/^https:\/\//i.test(url)?url:'/loja/catalogo'};
  const cta=(s,preview)=>!s.buttonLabel?'':preview?`<span class="btn dark">${esc(s.buttonLabel)}</span>`:`<a class="btn dark" href="${esc(shopLink(s.buttonLink))}" ${/^https:\/\//i.test(s.buttonLink||'')?'target="_blank" rel="noopener"':''}>${esc(s.buttonLabel)}</a>`;
  const newId=()=>`sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
  function init(model){
    if(model.storefront?.sections?.length)return false;
    model.storefront={announcement:{enabled:true,text:'Uma casa cheia de possibilidades.',highlight:'Preços de outlet, todos os dias.'},sections:[
      {id:'home-hero',type:'banner',enabled:true,showText:false,eyebrow:`Bem-vindo à ${model.settings.name}`,title:model.settings.hero,subtitle:model.settings.subtitle,image:seedProducts[0].image,imageAlt:'Sofá em uma sala de estar',buttonLabel:'Encontrar meu próximo móvel',buttonLink:'/loja/catalogo',align:'left'},
      {id:'home-benefits',type:'benefits',enabled:true,items:structuredClone(defaultBenefits)},
      {id:'home-products',type:'collection',enabled:true,eyebrow:'Escolhas para sua casa',title:'Seu novo favorito está aqui.',category:'Todos',limit:8}
    ]};
    return true;
  }
  function announcement(){const a=home().announcement;return a.enabled?`<div class="store-promo">${esc(a.text)} ${a.highlight?`<b>${esc(a.highlight)}</b>`:''}</div>`:''}
  function announcementControls(){const a=home().announcement;return `<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">CABEÇALHO</span><h2>Faixa de aviso</h2></div><label class="builder-switch"><input type="checkbox" ${a.enabled?'checked':''} onchange="storefront.changeAnnouncement('enabled',this.checked)"><span>${a.enabled?'Visível':'Oculta'}</span></label></div><div class="builder-fields"><label class="field">Mensagem<input maxlength="110" value="${esc(a.text)}" oninput="storefront.changeAnnouncement('text',this.value)"></label><label class="field">Trecho em destaque<input maxlength="90" value="${esc(a.highlight)}" oninput="storefront.changeAnnouncement('highlight',this.value)"></label></div></section>`}
  function videoEmbed(raw){
    let url;try{url=new URL(String(raw||'').trim())}catch{return ''}
    if(!['https:','http:'].includes(url.protocol))return '';
    const host=url.hostname.toLowerCase().replace(/^www\./,'');let id='';
    if(host==='youtube.com'||host==='m.youtube.com'||host==='youtube-nocookie.com')id=url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1]||'';
    if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];
    if(/^[\w-]{11}$/.test(id))return `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Vídeo da loja" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    if(host==='vimeo.com'||host==='player.vimeo.com'){const videoId=url.pathname.match(/(?:video\/)?(\d+)/)?.[1];if(videoId)return `<iframe src="https://player.vimeo.com/video/${videoId}" title="Vídeo da loja" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`}
    if(/\.mp4(?:$|\?)/i.test(url.href))return `<video controls playsinline preload="metadata" src="${esc(url.href)}"></video>`;
    return '';
  }
  function renderSection(s,preview=false){
    if(!s.enabled)return '';
    if(s.type==='banner'){
      const image=photo(s.image),showText=s.showText===true;
      if(!image&&!showText)return '';
      return `<section class="store-hero storefront-banner ${s.align==='right'?'align-right':''} ${image?'':'banner-without-image'}">${image?`<img class="hero-image" src="${esc(image)}" alt="${esc(s.imageAlt||s.title||'Banner da loja')}" loading="lazy">`:''}${showText?`<div class="hero-content">${s.eyebrow?`<span class="eyebrow">${esc(s.eyebrow)}</span>`:''}${s.title?`<h1>${esc(s.title)}</h1>`:''}${s.subtitle?`<p>${esc(s.subtitle)}</p>`:''}${cta(s,preview)}</div>`:''}</section>`;
    }
    if(s.type==='benefits')return `<div class="store-benefits">${(s.items||[]).map(item=>`<div class="benefit">${icon(item.icon||'check')}<div><strong>${esc(item.title||'')}</strong><small>${esc(item.body||'')}</small></div></div>`).join('')}</div>`;
    if(s.type==='collection'){const category=s.category||'Todos';const products=collectionProducts(category,true).slice(0,Math.max(1,Math.min(24,Number(s.limit)||8)));return `<section class="storefront-collection"><div class="catalog-head"><div>${s.eyebrow?`<span class="eyebrow">${esc(s.eyebrow)}</span>`:''}<h2>${esc(s.title||category)}</h2></div>${preview?'<span class="text-link">Ver todos</span>':`<a class="text-link" href="/loja/catalogo" onclick="catalogCategory=decodeURIComponent('${encodeURIComponent(category).replace(/'/g,'%27')}')">Ver todos</a>`}</div><div class="catalog">${products.map(p=>preview?`<article class="shop-product"><div class="product-photo"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div><h3>${esc(p.name)}</h3>${priceMarkup(p)}</article>`:shopProduct(p)).join('')}</div>${products.length?'':`<p class="subtle">Nenhum produto ativo nesta coleção.</p>`}</section>`}
    if(s.type==='image')return `<section class="storefront-image ${s.layout==='image-right'?'image-right':''}"><div class="storefront-image-photo">${photo(s.image)?`<img src="${esc(photo(s.image))}" alt="${esc(s.imageAlt||s.title||'Imagem da loja')}" loading="lazy">`:'<span>Imagem ainda não adicionada</span>'}</div><div class="storefront-image-copy"><span class="eyebrow">${esc(s.eyebrow||'FORTE OUTLET')}</span><h2>${esc(s.title||'Sua casa merece esse cuidado.')}</h2><p>${esc(s.body||'')}</p>${cta(s,preview)}</div></section>`;
    if(s.type==='video')return `<section class="storefront-video"><div class="catalog-head"><div><span class="eyebrow">${esc(s.eyebrow||'INSPIRE-SE')}</span><h2>${esc(s.title||'Veja de perto')}</h2>${s.body?`<p>${esc(s.body)}</p>`:''}</div></div><div class="storefront-video-frame">${videoEmbed(s.url)||'<span>Adicione o link do vídeo para exibi-lo aqui.</span>'}</div></section>`;
    if(s.type==='text')return `<section class="storefront-text"><span class="eyebrow">${esc(s.eyebrow||'')}</span><h2>${esc(s.title||'Uma mensagem da loja')}</h2><p>${esc(s.body||'')}</p>${cta(s,preview)}</section>`;
    return '';
  }
  function storeHome(preview=false){const visible=home().sections.map(s=>renderSection(s,preview)).filter(Boolean);return `<div class="store-content storefront-home">${visible.map(html=>`<div class="home-section">${html}</div>`).join('')||'<div class="empty">A página inicial não tem seções visíveis.</div>'}</div>`}
  function sectionRow(s,i){return `<div class="builder-section-row ${selected===s.id?'active':''} ${s.enabled?'':'is-hidden'}"><button class="builder-section-select" onclick="storefront.select('${s.id}')"><span class="builder-section-icon">${icon(({banner:'image',image:'image',video:'eye',collection:'layers',text:'page',benefits:'shield'})[s.type])}</span><span><strong>${esc(s.title||labels[s.type])}</strong><small>${labels[s.type]}${s.enabled?'':' · Oculta'}</small></span></button><div class="builder-section-actions"><button title="Subir" aria-label="Subir ${esc(labels[s.type])}" onclick="storefront.move('${s.id}',-1)" ${i===0?'disabled':''}>↑</button><button title="Descer" aria-label="Descer ${esc(labels[s.type])}" onclick="storefront.move('${s.id}',1)" ${i===home().sections.length-1?'disabled':''}>↓</button></div></div>`}
  const input=(label,key,value,type='text',extra='')=>`<label class="field">${label}<input name="${key}" type="${type}" value="${esc(value||'')}" ${extra} oninput="storefront.change('${key}',this.value)"></label>`;
  const textarea=(label,key,value)=>`<label class="field">${label}<textarea name="${key}" oninput="storefront.change('${key}',this.value)">${esc(value||'')}</textarea></label>`;
  const choose=(label,key,value,options)=>`<label class="field">${label}<select name="${key}" onchange="storefront.change('${key}',this.value)">${options.map(([v,text])=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  const imageControls=(s,key='image')=>`${input('URL da imagem',key,String(s[key]||'').startsWith('data:image/')?'':s[key],'url','placeholder="https://..."')}<label class="field">Ou envie uma imagem<input type="file" accept="image/png,image/jpeg,image/webp" onchange="storefront.uploadImage(this,'${key}')"><small>JPG, PNG ou WebP · até 2 MB</small></label>${s[key]?`<div class="builder-image-preview"><img src="${esc(photo(s[key]))}" alt="Prévia da imagem"><button class="btn small" onclick="storefront.change('${key}','');storefront.render()">Remover imagem</button></div>`:''}`;
  function controls(s){
    if(s.type==='banner')return `${imageControls(s)}${input('Descrição da imagem','imageAlt',s.imageAlt)}<p class="builder-hint">A imagem mantém sua proporção original, sem corte ou altura fixa.</p><label class="builder-switch"><input type="checkbox" ${s.showText===true?'checked':''} onchange="storefront.change('showText',this.checked);storefront.render()"><span>Mostrar textos e botão sobre a imagem</span></label>${s.showText===true?`${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${textarea('Descrição','subtitle',s.subtitle)}${choose('Alinhamento do texto','align',s.align,[['left','À esquerda'],['right','À direita']])}${input('Texto do botão','buttonLabel',s.buttonLabel)}${input('Link do botão','buttonLink',s.buttonLink,'text','placeholder="/loja/catalogo"')}`:''}`;
    if(s.type==='collection')return `${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${choose('Coleção','category',s.category,[['Todos','Todos os produtos'],...db.collections.map(c=>[c,c])])}${input('Número de produtos','limit',s.limit,'number','min="1" max="24"')}`;
    if(s.type==='image')return `${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${textarea('Texto','body',s.body)}${imageControls(s)}${input('Descrição da imagem','imageAlt',s.imageAlt)}${choose('Posição da imagem','layout',s.layout,[['image-left','À esquerda'],['image-right','À direita']])}${input('Texto do botão','buttonLabel',s.buttonLabel)}${input('Link do botão','buttonLink',s.buttonLink,'text','placeholder="/loja/catalogo"')}`;
    if(s.type==='video')return `${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${textarea('Texto','body',s.body)}${input('Link do vídeo','url',s.url,'url','placeholder="YouTube, Vimeo ou .mp4"')}<p class="builder-hint">Cole um link público do YouTube, Vimeo ou de um arquivo MP4. O vídeo não reproduz sozinho.</p>`;
    if(s.type==='text')return `${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${textarea('Texto','body',s.body)}${input('Texto do botão','buttonLabel',s.buttonLabel)}${input('Link do botão','buttonLink',s.buttonLink)}`;
    if(s.type==='benefits')return (s.items||[]).map((item,i)=>`<div class="builder-benefit-fields"><h3>Diferencial ${i+1}</h3>${input('Título',`items.${i}.title`,item.title)}${input('Texto',`items.${i}.body`,item.body)}${choose('Ícone',`items.${i}.icon`,item.icon,[['truck','Entrega'],['wallet','Pagamento'],['shield','Confiança'],['store','Loja'],['check','Confirmação']])}</div>`).join('');
    return '';
  }
  function pageKey(path,category='Todos',view=''){
    if(view==='login'||view==='signup')return view;
    const parts=path.split('/'),page=parts[2];
    if(page==='produto')return 'product';
    if(page==='catalogo')return 'collection';
    return ({carrinho:'cart',checkout:'checkout',conta:'account',pedido:'order',pagina:'info:'+Number(parts[3]),login:'login',cadastro:'signup'})[page]||'home';
  }
  function pageTitle(){
    const key=pageKey(previewRoute,previewCategory,previewView);
    if(key==='product')return 'Página de vendas';
    if(key==='collection')return 'Coleção';
    return ({home:'Página inicial',catalog:'Catálogo',cart:'Carrinho',checkout:'Checkout',account:'Meus pedidos',order:'Pedido',login:'Login',signup:'Cadastro'})[key]||'Página da loja';
  }
  function pageControls(){
    const key=pageKey(previewRoute,previewCategory,previewView),cfg=home().pageSettings?.[key]||{};
    const text=(label,name)=>`<label class="field">${label}<input maxlength="200" value="${esc(cfg[name]||'')}" placeholder="Usar o texto atual da loja" oninput="storefront.changePage('${name}',this.value)"></label>`;
    const check=(label,name)=>`<label class="builder-switch"><input type="checkbox" ${cfg[name]!==false?'checked':''} onchange="storefront.changePage('${name}',this.checked)"><span>${label}</span></label>`;
    let fields=key==='product'?`${check('Exibir descrição do produto','showDescription')}${text('Mensagem abaixo do preço','note')}<label class="field">Fotos do produto<select onchange="storefront.changePage('galleryFit',this.value)"><option value="contain" ${cfg.galleryFit!=='cover'?'selected':''}>Mostrar a foto inteira</option><option value="cover" ${cfg.galleryFit==='cover'?'selected':''}>Preencher o espaço da foto</option></select></label>`:`${text('Título da página','title')}${text('Texto de apresentação','intro')}`;
    if(key==='collection')fields+=`${check('Exibir busca e filtro de coleção','showFilters')}<label class="field">Produtos por linha no computador<select onchange="storefront.changePage('columns',Number(this.value))">${[2,3,4].map(n=>`<option value="${n}" ${Number(cfg.columns||3)===n?'selected':''}>${n} produtos</option>`).join('')}</select></label>`;
    return `<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">EDITAR PÁGINA</span><h2>${esc(pageTitle())}</h2></div></div><div class="builder-fields">${fields}<p class="builder-hint">${key==='product'?'Este modelo é aplicado a todos os produtos. Cada produto mantém seu título, suas fotos e sua descrição.':key==='collection'?'Este modelo é aplicado a todas as coleções e ao catálogo. Os produtos de cada coleção são mantidos.':'Estas opções personalizam esta página. Navegue na prévia para editar outras partes da loja.'} A loja publicada só muda ao salvar.</p></div></section>`;
  }
  function editorControls(){
    if(pageKey(previewRoute,previewCategory,previewView)!=='home')return announcementControls()+pageControls();
    const s=section()||home().sections[0];selected=s.id;
    return announcementControls()+`<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">PÁGINA INICIAL</span><h2>Seções da home</h2></div><span class="builder-count">${home().sections.length}</span></div><div class="builder-section-list">${home().sections.map(sectionRow).join('')}</div><button class="builder-add" onclick="storefront.addModal()">${icon('plus')} Adicionar seção</button><p class="builder-hint">Use as setas para mudar a ordem. Seções ocultas não aparecem na loja.</p></section><section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">EDITAR SEÇÃO</span><h2>${esc(labels[s.type])}</h2></div><label class="builder-switch"><input type="checkbox" ${s.enabled?'checked':''} onchange="storefront.toggle('${s.id}',this.checked)"><span>${s.enabled?'Visível':'Oculta'}</span></label></div><div class="builder-fields">${controls(s)}</div><div class="builder-card-foot"><button class="btn small" onclick="storefront.duplicate('${s.id}')">${icon('plus')} Duplicar</button><button class="btn small danger" onclick="storefront.removeModal('${s.id}')">${icon('trash')} Excluir</button></div></section>`;
  }
  function saveBar(){return `<div class="builder-save-status" role="status">${uploading?'Enviando imagem…':saving?'Salvando mudanças…':dirty()?'Você tem mudanças não publicadas.':'Todas as mudanças estão salvas.'}</div><div class="actions"><button class="btn" onclick="storefront.cancelChanges()" ${!dirty()||saving||uploading?'disabled':''}>Cancelar mudanças</button><button class="btn primary" onclick="storefront.publish()" ${!dirty()||saving||uploading?'disabled':''}>Salvar mudanças</button></div>`}
  function previewOptionValue(){const key=pageKey(previewRoute,previewCategory,previewView);return key==='product'?'template:product':key==='collection'?'template:collection':previewRoute;}
  function pageOptions(){return [['/loja','Página inicial'],['template:product','Página de vendas'],['template:collection','Coleção'],['/loja/carrinho','Carrinho'],['/loja/checkout','Checkout'],['/loja/conta','Meus pedidos'],['/loja/login','Login'],['/loja/cadastro','Cadastro']].map(([value,label])=>`<option value="${value}" ${previewOptionValue()===value?'selected':''}>${label}</option>`).join('')}
  function editorPage(){
    ensureDraft();
    const params=new URLSearchParams(location.search);params.set('storePreview','1');params.set('channel',channel);
    return heading('Loja online','Edite, navegue na prévia e publique quando estiver pronto.',`<a class="btn" href="/loja" target="_blank" rel="noopener noreferrer">${icon('external')}Abrir loja</a>`)+
      `<div id="builder-save-bar" class="builder-save-bar">${saveBar()}</div><div class="storefront-builder"><div id="builder-controls" class="builder-column">${editorControls()}</div><section class="builder-preview-panel"><div class="builder-preview-head"><div><strong id="builder-preview-title">Prévia · ${esc(pageTitle())}</strong><small>Pedidos e cadastros da prévia são simulados.</small></div><div class="builder-view-switch"><button data-device="desktop" class="${previewSize==='desktop'?'active':''}" onclick="storefront.setPreview('desktop')">Desktop</button><button data-device="mobile" class="${previewSize==='mobile'?'active':''}" onclick="storefront.setPreview('mobile')">Celular</button></div></div><div class="builder-preview-toolbar"><button class="btn small" onclick="storefront.navigate('/loja')" aria-label="Página inicial na prévia">${icon('home')}</button><select aria-label="Página da prévia" onchange="storefront.navigate(this.value)">${pageOptions()}</select><select aria-label="Conta na prévia" onchange="storefront.setIdentity(this.value)"><option value="current" ${previewIdentity==='current'?'selected':''}>Conta atual</option><option value="guest" ${previewIdentity==='guest'?'selected':''}>Sem login</option></select></div><div id="editor-preview"><div id="builder-frame-stage"><iframe id="store-preview-frame" title="Prévia funcional da loja" sandbox="allow-scripts allow-same-origin allow-forms" src="${esc(basePath+'index.html?'+params.toString()+'#'+previewRoute)}"></iframe></div></div></section></div>`;
  }
  function render(){
    if(!editing())return;
    const node=document.querySelector('#builder-controls');if(!node)return window.render();
    node.innerHTML=editorControls();refresh();
  }
  function refresh(){
    const bar=document.querySelector('#builder-save-bar');if(bar)bar.innerHTML=saveBar();
    const title=document.querySelector('#builder-preview-title');if(title)title.textContent='Prévia · '+pageTitle();
    const row=document.querySelector('.builder-section-row.active strong');if(row&&section())row.textContent=section().title||labels[section().type];
    sendPreview();
  }
  function select(id){if(!home().sections.some(s=>s.id===id))return;selected=id;render()}
  function change(key,value){
    if(!canConfigureSite()||saving)return;
    const s=section();if(!s)return;
    if(key.startsWith('items.')){const [,index,field]=key.split('.');if(!s.items?.[Number(index)]||!['title','body','icon'].includes(field))return;s.items[Number(index)][field]=value}
    else if(['eyebrow','title','subtitle','body','image','imageAlt','url','align','layout','buttonLabel','buttonLink','category','limit','showText'].includes(key))s[key]=key==='limit'?Math.max(1,Math.min(24,Number(value)||1)):key==='showText'?Boolean(value):value;
    else return;
    refresh();
  }
  function changePage(key,value){
    if(!canConfigureSite()||saving||!['title','intro','note','showDescription','galleryFit','columns','showFilters'].includes(key))return;
    const scope=pageKey(previewRoute,previewCategory,previewView),model=home();model.pageSettings||={};
    // Shared templates replace legacy per-item overrides in the draft only.
    if(['product','collection'].includes(scope))for(const name of Object.keys(model.pageSettings)){if(name.startsWith(scope+':')||(scope==='collection'&&name==='catalog'))delete model.pageSettings[name];}
    model.pageSettings[scope]||={};model.pageSettings[scope][key]=value;refresh();
  }
  function changeAnnouncement(key,value){if(!canConfigureSite()||saving||!['enabled','text','highlight'].includes(key))return;home().announcement[key]=value;if(key==='enabled')render();else refresh()}
  function toggle(id,enabled){if(!canConfigureSite()||saving)return;const s=home().sections.find(s=>s.id===id);if(!s)return;s.enabled=enabled;render()}
  function move(id,step){if(!canConfigureSite()||saving)return;const list=home().sections,i=list.findIndex(s=>s.id===id),j=i+step;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];render()}
  function addModal(){modal('Adicionar seção',`<p>Escolha o conteúdo para a página inicial. A nova seção começa oculta.</p><div class="builder-add-grid">${Object.entries(labels).map(([type,label])=>`<button onclick="storefront.add('${type}')">${icon(({banner:'image',image:'image',video:'eye',collection:'layers',text:'page',benefits:'shield'})[type])}<strong>${label}</strong></button>`).join('')}</div>`)}
  function add(type){
    if(!canConfigureSite()||saving||!labels[type])return;
    if(home().sections.length>=80)return toast('O limite é de 80 seções.');
    const base={id:newId(),type,enabled:false};
    const presets={banner:{showText:false,eyebrow:'',title:'',subtitle:'',image:'',imageAlt:'',buttonLabel:'',buttonLink:'/loja/catalogo',align:'left'},collection:{eyebrow:'EXPLORE A LOJA',title:'Nossa seleção',category:'Todos',limit:4},image:{eyebrow:'FORTE OUTLET',title:'Sua casa merece esse cuidado.',body:'',image:'',imageAlt:'',layout:'image-left',buttonLabel:'',buttonLink:'/loja/catalogo'},video:{eyebrow:'INSPIRE-SE',title:'Veja de perto',body:'',url:''},text:{eyebrow:'NOSSA HISTÓRIA',title:'Sua casa merece o melhor.',body:'',buttonLabel:'',buttonLink:'/loja/catalogo'},benefits:{items:structuredClone(defaultBenefits)}};
    Object.assign(base,presets[type]);home().sections.push(base);selected=base.id;closeModal();render();toast('Seção adicionada ao rascunho.');
  }
  function duplicate(id){if(!canConfigureSite()||saving)return;const list=home().sections,i=list.findIndex(s=>s.id===id);if(i<0||list.length>=80)return;const copy=structuredClone(list[i]);copy.id=newId();copy.enabled=false;list.splice(i+1,0,copy);selected=copy.id;render()}
  function removeModal(id){const s=home().sections.find(s=>s.id===id);if(!s)return;modal('Excluir seção',`<p>Remover <strong>${esc(s.title||labels[s.type])}</strong> do rascunho?</p><div class="form-actions"><button class="btn" onclick="closeModal()">Manter seção</button><button class="btn danger" onclick="storefront.remove('${id}')">Remover do rascunho</button></div>`)}
  function remove(id){if(!canConfigureSite()||saving)return;const list=home().sections,i=list.findIndex(s=>s.id===id);if(i<0)return;if(list.length===1)return toast('Oculte a última seção ou adicione outra antes de excluir.');list.splice(i,1);selected=list[Math.min(i,list.length-1)]?.id||'';closeModal();render()}
  async function uploadImage(input,key){
    const s=section(),file=input.files?.[0];if(!canConfigureSite()||saving||uploading||!s||!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)return toast('Envie JPG, PNG ou WebP de até 2 MB.');
    uploading=true;input.disabled=true;refresh();
    try{s[key]=await uploadProductPhoto(file,'storefront');toast('Imagem adicionada ao rascunho. Salve as mudanças para publicá-la.')}catch(error){toast(error.message)}finally{uploading=false;input.disabled=false;render()}
  }
  function setPreview(size){previewSize=size==='mobile'?'mobile':'desktop';document.querySelectorAll('[data-device]').forEach(b=>b.classList.toggle('active',b.dataset.device===previewSize));sizeFrame()}
  function sizeFrame(){
    const stage=document.querySelector('#builder-frame-stage'),frame=document.querySelector('#store-preview-frame');if(!stage||!frame)return;
    const width=previewSize==='mobile'?390:1280,scale=Math.min(1,stage.parentElement.clientWidth/width);
    frame.style.width=width+'px';frame.style.height='900px';frame.style.transform=`scale(${scale})`;stage.style.width=width*scale+'px';stage.style.height=900*scale+'px';
  }
  function previewModel(){
    return {products:db.products.filter(p=>p.active).map(p=>{const item=structuredClone(p);delete item.cost;item.stock=available(p.id);return item}),collections:db.collections,collectionSettings:db.collectionSettings||{},navigation:db.navigation,orderBumps:(db.orderBumps||[]).filter(b=>b.active).map(({cost,...b})=>b),pages:db.pages,settings:{...db.settings,goal:undefined},storefront:structuredClone(ensureDraft()),orders:authSession?db.orders.filter(o=>o.user_id===authSession.user.id).map(o=>{const item=structuredClone(o);delete item.receipt;delete item.guest_token;delete item.guestToken;item.items=item.items.map(({cost,...line})=>line);return item}):[]};
  }
  function sendPreview(route=false){
    const frame=document.querySelector('#store-preview-frame');if(!frame||!editing())return;
    frame.contentWindow?.postMessage({type:'storefront:model',channel,model:previewModel(),identity:previewIdentity==='current'&&authSession?{id:authSession.user.id,email:currentEmail(),name:currentProfile?.name||''}:null,...(route?{route:previewRoute,category:previewCategory}: {})},location.origin);
  }
  function navigate(value){
    if(value==='template:product'){const product=db.products.find(p=>p.active);if(!product)return toast('Ative um produto para visualizar a página de vendas.');value='/loja/produto/'+product.id;}
    if(value==='template:collection'){const category=visibleCollections()[0]||'Todos';value=category==='Todos'?'/loja/catalogo':'collection:'+encodeURIComponent(category);}
    if(value.startsWith('collection:')){previewCategory=decodeURIComponent(value.slice(11));previewRoute='/loja/catalogo'}else{previewRoute=value;previewCategory='Todos'}
    previewView=value==='/loja/login'?'login':value==='/loja/cadastro'?'signup':'';
    if(!/^\/loja(?:\/|$)/.test(previewRoute))return;
    render();sendPreview(true);
  }
  function setIdentity(value){previewIdentity=value==='guest'?'guest':'current';sendPreview()}
  let observer;
  function mountPreview(){if(!editing())return;const stage=document.querySelector('#editor-preview');if(!stage)return;observer?.disconnect();observer=new ResizeObserver(sizeFrame);observer.observe(stage);sizeFrame()}
  async function publish(){
    if(!canConfigureSite()||saving||uploading||!dirty())return;
    saving=true;refresh();
    try{
      await settleAdminWrites();
      await backendRequest('/rest/v1/rpc/save_storefront',{method:'POST',body:JSON.stringify({p_storefront:draft,p_expected:baseline})},true);
      await loadAdminState();baseline=structuredClone(db.storefront);draft=structuredClone(db.storefront);toast('Mudanças salvas. A loja publicada foi atualizada.');
    }catch(error){toast('Não foi possível publicar: '+error.message)}
    finally{saving=false;render()}
  }
  async function cancelChanges(){
    if(saving||uploading)return;
    try{await settleAdminWrites();await loadAdminState()}catch(error){toast('Não foi possível atualizar a loja: '+error.message)}
    baseline=structuredClone(db.storefront);draft=structuredClone(db.storefront);render();toast('Rascunho descartado.');sendPreview();
  }
  window.addEventListener('message',event=>{
    const frame=document.querySelector('#store-preview-frame');
    if(!editing()||!frame||event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.channel!==channel)return;
    if(event.data.type==='storefront:ready')sendPreview(true);
    if(event.data.type==='storefront:route'){
      if(!/^\/loja(?:\/|$)/.test(event.data.route||''))return;
      const previousScope=pageKey(previewRoute,previewCategory,previewView);
      previewRoute=event.data.route;previewCategory=event.data.category||'Todos';previewView=event.data.view||'';
      const node=document.querySelector('#builder-controls');if(node&&previousScope!==pageKey(previewRoute,previewCategory,previewView))node.innerHTML=editorControls();
      const title=document.querySelector('#builder-preview-title');if(title)title.textContent='Prévia · '+pageTitle();
      const select=document.querySelector('[aria-label="Página da prévia"]');if(select)select.value=previewOptionValue();
    }
  });
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue=''}});
  return {init,announcement,storeHome,editorPage,change,changePage,changeAnnouncement,toggle,move,addModal,add,duplicate,removeModal,remove,select,uploadImage,setPreview,render,mountPreview,navigate,setIdentity,publish,cancelChanges,dirty,pageKey};
})();
