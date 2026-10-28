const storefront=(()=>{
  const labels={banner:'Banner',collection:'Coleção de produtos',recommendations:'Você também pode gostar','collection-list':'Lista de coleções',image:'Imagem com texto',video:'Vídeo',text:'Texto',benefits:'Diferenciais da loja'};
  const defaultBenefits=[
    {icon:'truck',title:'Entrega com cuidado',body:'Consulte sua região'},
    {icon:'wallet',title:'Compra do seu jeito',body:'Combine o pagamento com a loja'},
    {icon:'shield',title:'Atendimento de verdade',body:'Nossa equipe cuida de você'},
    {icon:'store',title:'Sua loja de confiança',body:'Visite nossa loja física'}
  ];
  let selected='home-hero',previewSize=window.innerWidth<=650?'mobile':'desktop',draft=null,baseline=null,saving=false,uploading=false,draftScope='';
  let previewRoute='/loja',previewCategory='Todos',previewView='home',previewIdentity='current';
  let openedCollectionItem='';
  const channel=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
  const editing=()=>routePath().startsWith('/app/store-editor');
  function ensureDraft(){
    const source=typeof themeEditorModel==='function'?themeEditorModel():db.storefront;
    const scope=typeof currentEditingThemeId==='function'?currentEditingThemeId()||'published':'published';
    if(!draft || draftScope!==scope || (!dirty() && JSON.stringify(baseline)!==JSON.stringify(source))){draftScope=scope;baseline=structuredClone(source);draft=structuredClone(source)}
    return draft;
  }
  const home=()=>editing()?ensureDraft():db.storefront;
  const dirty=()=>Boolean(draft&&JSON.stringify(draft)!==JSON.stringify(baseline));
  const scope=()=>pageKey(previewRoute,previewCategory,previewView);
  const pageLabel=page=>typeof displayPageTitle==='function'?displayPageTitle(page):page.title;
  function sections(create=false){const model=home();if(scope()==='home')return model.sections;const cfg=model.pageSettings?.[scope()];if(!create)return cfg?.sections||[];model.pageSettings||={};model.pageSettings[scope()]||={};return model.pageSettings[scope()].sections||=[];}
  const section=()=>sections().find(s=>s.id===selected);
  const photo=(value)=>{const url=String(value||'').trim();return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url)||/^https?:\/\//i.test(url)?url:''};
  const imageAttrs=(url,role='card')=>typeof mediaImageAttributes==='function'?mediaImageAttributes(url,role):`src="${esc(url)}" loading="lazy" decoding="async"`;
  const shopLink=(value)=>{const url=String(value||'').trim();return /^\/loja(?:\/|$)/.test(url)||/^https:\/\//i.test(url)?url:'/loja/catalogo'};
  const cta=(s,preview)=>!s.buttonLabel?'':preview?`<span class="btn dark">${esc(s.buttonLabel)}</span>`:`<a class="btn dark" href="${esc(shopLink(s.buttonLink))}" ${/^https:\/\//i.test(s.buttonLink||'')?'target="_blank" rel="noopener"':''}>${esc(s.buttonLabel)}</a>`;
  const newId=()=>`sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
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
  function sectionProducts(s,path=routePath()){
    const limit=Math.max(1,Math.min(24,Number(s.limit)||8));
    if(s.type!=='recommendations')return collectionProducts(s.category||'Todos',true).slice(0,limit);
    const productId=Number(path.split('/')[3]),isProduct=path.startsWith('/loja/produto/');
    const excluded=new Set([...(db.cart||[]).map(line=>Number(line.id)),...(isProduct?[productId]:[])]);
    const references=db.products.filter(p=>excluded.has(Number(p.id)));
    const categories=new Set(references.flatMap(p=>productCollections(p)));
    if(!references.length&&typeof catalogCategory==='string'&&catalogCategory!=='Todos')categories.add(catalogCategory);
    const sales=collectionSales();
    return db.products.filter(p=>p.active&&!excluded.has(Number(p.id))&&productCollections(p).some(name=>visibleCollections().includes(name))).map(p=>{
      const shared=productCollections(p).filter(name=>categories.has(name)).length;
      const similar=references.reduce((best,ref)=>Math.max(best,1-Math.min(1,Math.abs(salePrice(p)-salePrice(ref))/Math.max(1,salePrice(ref)))),0);
      return {p,score:shared*10+similar};
    }).sort((a,b)=>b.score-a.score||(Number(sales[b.p.id])||0)-(Number(sales[a.p.id])||0)||Number(a.p.id)-Number(b.p.id)).slice(0,limit).map(row=>row.p);
  }
  function renderSection(s,preview=false,path=routePath()){
    const html=sectionContent(s,preview,path);if(!html||s.type==='collection-list')return html;
    const bg=listColor(s.background,'#ffffff'),text=listColor(s.textColor,'#1c2228'),icons=listColor(s.iconColor,text);
    return `<div class="store-theme-block ${s.background||s.textColor||s.iconColor?'has-block-colors':''} ${s.type==='banner'?'is-banner-block':''}" style="--block-bg:${bg};--block-text:${text};--block-icon:${icons}">${html}</div>`;
  }
  function sectionContent(s,preview=false,path=routePath()){
    if(!s.enabled)return '';
    if(s.type==='collection-list')return renderCollectionList(s);
    if(s.type==='banner'){
      const image=photo(s.image),showText=s.showText===true;
      if(!image&&!showText)return '';
      return `<section class="store-hero storefront-banner ${s.align==='right'?'align-right':''} ${image?'':'banner-without-image'}">${image?`<img class="hero-image" ${imageAttrs(image,'banner')} alt="${esc(s.imageAlt||s.title||'Banner da loja')}">`:''}${showText?`<div class="hero-content">${s.eyebrow?`<span class="eyebrow">${esc(s.eyebrow)}</span>`:''}${s.title?`<h1>${esc(s.title)}</h1>`:''}${s.subtitle?`<p>${esc(s.subtitle)}</p>`:''}${cta(s,preview)}</div>`:''}</section>`;
    }
    if(s.type==='benefits')return `<div class="store-benefits">${(s.items||[]).map(item=>`<div class="benefit">${icon(item.icon||'check')}<div><strong>${esc(item.title||'')}</strong><small>${esc(item.body||'')}</small></div></div>`).join('')}</div>`;
    if(s.type==='collection'||s.type==='recommendations'){
      const viewAll=productCardAppearance({productButtonColor:s.viewAllColor||'#1c2228'});
      const category=s.category||'Todos',products=sectionProducts(s,path);if(s.type==='recommendations'&&!products.length)return '';
      return `<section class="storefront-collection content-align-${s.contentAlign==='center'?'center':'left'}"><div class="catalog-head"><div>${s.eyebrow?`<span class="eyebrow">${esc(s.eyebrow)}</span>`:''}<h2>${esc(s.title||(s.type==='recommendations'?'Você também pode gostar':category))}</h2></div></div><div class="catalog">${products.map(p=>shopProduct(p,s)).join('')}</div>${products.length?'':`<p class="subtle">Nenhum produto ativo nesta coleção.</p>`}${s.showViewAll===false?'':`<div class="collection-footer footer-align-${['left','right'].includes(s.viewAllAlign)?s.viewAllAlign:'center'}"><a class="btn collection-view-all" style="${viewAll.style}" href="/loja/catalogo?colecao=${encodeURIComponent(category)}">Ver todos</a></div>`}</section>`;
    }
    if(s.type==='image')return `<section class="storefront-image ${s.layout==='image-right'?'image-right':''}"><div class="storefront-image-photo">${photo(s.image)?`<img ${imageAttrs(photo(s.image),'banner')} alt="${esc(s.imageAlt||s.title||'Imagem da loja')}">`:'<span>Imagem ainda não adicionada</span>'}</div><div class="storefront-image-copy"><span class="eyebrow">${esc(s.eyebrow||'FORTE OUTLET')}</span><h2>${esc(s.title||'Sua casa merece esse cuidado.')}</h2><p>${esc(s.body||'')}</p>${cta(s,preview)}</div></section>`;
    if(s.type==='video')return `<section class="storefront-video"><div class="catalog-head"><div><span class="eyebrow">${esc(s.eyebrow||'INSPIRE-SE')}</span><h2>${esc(s.title||'Veja de perto')}</h2>${s.body?`<p>${esc(s.body)}</p>`:''}</div></div><div class="storefront-video-frame">${videoEmbed(s.url)||'<span>Adicione o link do vídeo para exibi-lo aqui.</span>'}</div></section>`;
    if(s.type==='text')return `<section class="storefront-text"><span class="eyebrow">${esc(s.eyebrow||'')}</span><h2>${esc(s.title||'Uma mensagem da loja')}</h2><p>${esc(s.body||'')}</p>${cta(s,preview)}</section>`;
    return '';
  }
  const listColor=(value,fallback)=>/^#[a-f0-9]{6}$/i.test(String(value||''))?value:fallback;
  function collectionListImage(item){return photo(item.image)||photo(collectionProducts(item.category,true).flatMap(productImages).find(value=>photo(value)))||'assets/product-placeholder.svg'}
  function renderCollectionList(s){
    const items=(Array.isArray(s.items)?s.items:[]).filter(item=>visibleCollections().includes(item.category));
    if(!items.length)return editing()?'<div class="empty">Adicione uma coleção ativa a esta lista para visualizá-la.</div>':'';
    const shape=['round','square','landscape','portrait'].includes(s.shape)?s.shape:'square';
    const columns=Math.max(2,Math.min(6,Number(s.columns)||6)),mobileColumns=Number(s.mobileColumns)===1?1:2;
    const style=`--list-bg:${listColor(s.background,'#ffffff')};--list-color:${listColor(s.textColor,'#1c2228')};--tile-bg:${listColor(s.cardBackground,'#f5f5f3')};--tile-color:${listColor(s.cardTextColor,'#1c2228')};--list-columns:${columns};--list-mobile-columns:${mobileColumns};--list-padding:${Math.max(0,Math.min(96,Number(s.padding)||40))}px`;
    return `<section class="storefront-collection-list ${s.mobileCarousel?'has-mobile-carousel':''} list-align-${s.titleAlign==='center'?'center':'left'}" style="${style}">${s.showHeading!==false?`<h2 class="collection-list-heading heading-${['small','large'].includes(s.headingSize)?s.headingSize:'medium'}">${esc(s.title||'Explore as coleções')}</h2>`:''}<ul class="collection-list-grid ${s.mobileCarousel?'is-mobile-carousel':''}">${items.map(item=>{
      const title=item.title||item.category,count=s.showCounts?collectionProducts(item.category,true).length:0;
      return `<li><a class="collection-tile shape-${shape} ${s.showTitles===false?'without-title':''}" href="/loja/catalogo?colecao=${encodeURIComponent(item.category)}" aria-label="Ver coleção ${esc(title)}"><div class="collection-tile-media"><img ${imageAttrs(collectionListImage(item),'card')} alt="${esc(item.imageAlt||title)}" style="object-fit:${s.imageFit==='contain'?'contain':'cover'}"></div>${s.showTitles!==false||s.showCounts?`<div class="collection-tile-caption">${s.showTitles!==false?`<h3>${esc(title)}</h3>`:''}${s.showCounts?`<small>${count} ${count===1?'produto':'produtos'}</small>`:''}</div>`:''}</a></li>`;
    }).join('')}</ul></section>`;
  }
  function storeHome(preview=false){const visible=home().sections.map(s=>{const html=renderSection(s,preview);return html?`<div class="home-section ${s.type==='collection-list'&&s.mobileCarousel?'collection-carousel-section':''}">${html}</div>`:''}).filter(Boolean);return `<div class="store-content storefront-home">${visible.join('')||'<div class="empty">A página inicial não tem seções visíveis.</div>'}</div>`}
  function sectionRow(s,i){return `<div class="builder-section-row ${selected===s.id?'active':''} ${s.enabled?'':'is-hidden'}"><button class="builder-section-select" onclick="storefront.select('${s.id}')"><span class="builder-section-icon">${icon(({banner:'image',image:'image',video:'eye',collection:'layers',recommendations:'layers','collection-list':'layers',text:'page',benefits:'shield'})[s.type])}</span><span><strong>${esc(s.title||labels[s.type])}</strong><small>${labels[s.type]}${s.enabled?'':' · Oculta'}</small></span></button><div class="builder-section-actions"><button title="Subir" aria-label="Subir ${esc(labels[s.type])}" onclick="storefront.move('${s.id}',-1)" ${i===0?'disabled':''}>↑</button><button title="Descer" aria-label="Descer ${esc(labels[s.type])}" onclick="storefront.move('${s.id}',1)" ${i===sections().length-1?'disabled':''}>↓</button></div></div>`}
  const input=(label,key,value,type='text',extra='')=>type==='color'?colorControl(label,key,value):`<label class="field">${label}<input name="${key}" type="${type}" value="${esc(value||'')}" ${extra} oninput="storefront.change('${key}',this.value)"></label>`;
  const textarea=(label,key,value)=>`<label class="field">${label}<textarea name="${key}" oninput="storefront.change('${key}',this.value)">${esc(value||'')}</textarea></label>`;
  const choose=(label,key,value,options)=>`<label class="field">${label}<select name="${key}" onchange="storefront.change('${key}',this.value)">${options.map(([v,text])=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  const imageControls=(s,key='image')=>`${input('URL da imagem',key,String(s[key]||'').startsWith('data:image/')?'':s[key],'url','placeholder="https://..."')}<label class="field">Ou envie uma imagem<input type="file" accept="image/png,image/jpeg,image/webp" onchange="storefront.uploadImage(this,'${key}')"><small>JPG, PNG ou WebP · até 2 MB</small></label>${s[key]?`<div class="builder-image-preview"><img ${imageAttrs(photo(s[key]),'card')} alt="Prévia da imagem"><button class="btn small" onclick="storefront.change('${key}','');storefront.render()">Remover imagem</button></div>`:''}`;
  function colorControl(label,key,value,page=false){
    const color=/^#[a-f0-9]{6}$/i.test(value||'')?value:'#1c2228';
    return `<div class="field builder-color-field"><span>${label}</span><div class="builder-color-control"><input type="color" aria-label="${label} · seletor de cor" value="${esc(color)}" oninput="storefront.changeColor(this,'${key}',${JSON.stringify(page).replaceAll('\"','&quot;')})"><input class="builder-color-hex" name="${key}" type="text" aria-label="${label} · código hexadecimal" value="${esc(color.toUpperCase())}" maxlength="7" spellcheck="false" autocapitalize="characters" placeholder="#1C2228" oninput="storefront.changeColor(this,'${key}',${JSON.stringify(page).replaceAll('\"','&quot;')})" onchange="storefront.changeColor(this,'${key}',${JSON.stringify(page).replaceAll('\"','&quot;')},true)"></div></div>`;
  }
  function changeColor(input,key,page=false,complete=false){
    let value=String(input.value||'').trim();if(!value.startsWith('#'))value='#'+value;
    if(complete&&/^#[a-f0-9]{3}$/i.test(value))value='#'+value.slice(1).split('').map(c=>c+c).join('');
    const valid=/^#[a-f0-9]{6}$/i.test(value);
    input.setCustomValidity(valid?'':'Informe uma cor hexadecimal, como #1C2228.');input.setAttribute('aria-invalid',String(!valid));
    if(!valid)return;
    value=value.toLowerCase();
    const control=input.closest('.builder-color-control'),hex=control.querySelector('.builder-color-hex'),picker=control.querySelector('[type="color"]');
    picker.value=value;if(input!==hex||complete)hex.value=value.toUpperCase();hex.setCustomValidity('');hex.setAttribute('aria-invalid','false');
    if(page==='global')changeGlobal(key,value);else if(page)changePage(key,value);else change(key,value);
  }
  function productGridControls(cfg,page=false){
    const action=page?'storefront.changePage':'storefront.change',appearance=productCardAppearance(cfg);
    return `<div class="builder-list-divider"><h3>Grade de produtos</h3></div><label class="field">Alinhamento das informações<select name="contentAlign" onchange="${action}('contentAlign',this.value)"><option value="left" ${appearance.align==='left'?'selected':''}>À esquerda</option><option value="center" ${appearance.align==='center'?'selected':''}>Centralizado</option></select></label><label class="field">Texto do botão dos produtos<input name="productButtonLabel" maxlength="60" value="${esc(appearance.label)}" oninput="${action}('productButtonLabel',this.value)"></label>${colorControl('Cor do botão dos produtos','productButtonColor',cfg.productButtonColor||'#f3c30b',page)}<p class="builder-hint">Todos os botões abrem a página do produto. A cor do texto se adapta ao fundo do botão.</p>${page?'':`<label class="builder-switch"><input type="checkbox" ${cfg.showViewAll!==false?'checked':''} onchange="storefront.change('showViewAll',this.checked)"><span>Mostrar botão Ver todos</span></label><div class="builder-list-divider"><h3>Botão “Ver todos”</h3></div>${choose('Alinhamento do botão','viewAllAlign',cfg.viewAllAlign||'center',[['left','À esquerda'],['center','Centralizado'],['right','À direita']])}${colorControl('Cor do botão Ver todos','viewAllColor',cfg.viewAllColor||'#1c2228')}`}`;
  }
  function collectionListControls(s){
    const check=(label,key,defaultValue=true)=>`<label class="builder-switch"><input type="checkbox" ${(s[key]??defaultValue)?'checked':''} onchange="storefront.change('${key}',this.checked)"><span>${label}</span></label>`;
    return `${input('Título da seção','title',s.title,'text','maxlength="200"')}${check('Mostrar título da seção','showHeading')}${choose('Tamanho do título','headingSize',s.headingSize||'medium',[['small','Pequeno'],['medium','Médio'],['large','Grande']])}${choose('Alinhamento dos títulos','titleAlign',s.titleAlign||'left',[['left','À esquerda'],['center','Centralizado']])}<div class="builder-list-divider"><h3>Apresentação</h3></div>${choose('Formato das imagens','shape',s.shape||'square',[['square','Quadradas'],['round','Redondas'],['landscape','Retangulares · horizontal'],['portrait','Retangulares · vertical']])}${choose('Enquadramento das imagens','imageFit',s.imageFit||'cover',[['cover','Preencher e recortar'],['contain','Mostrar a imagem inteira']])}${check('Mostrar nomes das coleções','showTitles')}${check('Mostrar quantidade de produtos','showCounts',false)}<div class="builder-list-columns">${choose('Colunas no computador','columns',String(s.columns||6),[2,3,4,5,6].map(n=>[String(n),String(n)]))}${s.mobileCarousel?'':choose('Colunas no celular','mobileColumns',String(s.mobileColumns||2),[['1','1'],['2','2']])}</div>${check('Carrossel no celular','mobileCarousel',false)}${s.mobileCarousel?'<p class="builder-hint">No celular, os cartões ficam compactos e mostram parte da próxima coleção. Deslize para ver as demais opções.</p>':''}${choose('Espaçamento vertical','padding',String(s.padding??40),[['24','Compacto'],['40','Confortável'],['64','Amplo']])}<div class="builder-list-divider"><h3>Cores</h3></div><div class="builder-list-colors">${input('Fundo da seção','background',s.background||'#ffffff','color')}${input('Texto da seção','textColor',s.textColor||'#1c2228','color')}${input(s.shape==='round'?'Fundo das imagens':'Fundo dos cartões','cardBackground',s.cardBackground||'#f5f5f3','color')}${s.shape==='round'?'':input('Cor dos nomes','cardTextColor',s.cardTextColor||'#1c2228','color')}</div><div class="builder-list-divider"><h3>Coleções da lista <span>${(s.items||[]).length}/40</span></h3><p>Use as setas para mudar a ordem. Abra uma coleção para trocar a imagem ou o nome exibido.</p></div><div class="builder-list-items">${(s.items||[]).map((item,i)=>`<details class="builder-list-item" ${openedCollectionItem===item.id?'open':''} ontoggle="storefront.setCollectionItemOpen('${item.id}',this.open)"><summary><img ${imageAttrs(collectionListImage(item),'card')} alt=""><span><strong>${esc(item.title||item.category||'Selecione a coleção')}</strong><small>${esc(item.category)}${collectionConfig(item.category).active===false?' · Desativada na loja':''}</small></span>${icon('down')}</summary><div class="builder-list-item-fields"><div class="builder-list-item-actions"><button class="btn small" aria-label="Subir coleção ${i+1}" onclick="storefront.moveCollectionItem(${i},-1)" ${i===0?'disabled':''}>↑</button><button class="btn small" aria-label="Descer coleção ${i+1}" onclick="storefront.moveCollectionItem(${i},1)" ${i===(s.items||[]).length-1?'disabled':''}>↓</button><button class="btn small danger" onclick="storefront.removeCollectionItem(${i})">${icon('trash')}Remover da lista</button></div>${choose('Coleção',`items.${i}.category`,item.category,db.collections.map(name=>[name,name]))}${input('Nome na lista (opcional)',`items.${i}.title`,item.title,'text',`maxlength="120" placeholder="${esc(item.category)}"`)}<label class="field">Imagem desta coleção<input type="file" accept="image/png,image/jpeg,image/webp" onchange="storefront.uploadImage(this,'items.${i}.image')"><small>JPG, PNG ou WebP · até 2 MB. Sem imagem própria, usamos uma foto de produto desta coleção.</small></label>${item.image?`<div class="builder-image-preview"><img ${imageAttrs(photo(item.image),'card')} alt="Prévia da imagem"><button class="btn small" onclick="storefront.change('items.${i}.image','');storefront.render()">Usar foto automática</button></div>`:''}${input('Descrição da imagem (opcional)',`items.${i}.imageAlt`,item.imageAlt,'text','maxlength="200"')}</div></details>`).join('')||'<p class="builder-hint">Nenhuma coleção adicionada. Escolha as coleções que deseja apresentar.</p>'}</div><button class="btn builder-list-add" onclick="storefront.addCollectionItem()" ${(s.items||[]).length>=40?'disabled':''}>${icon('plus')}Adicionar coleção</button><p class="builder-hint">Coleções desativadas ficam ocultas na loja. Estas escolhas afetam apenas esta seção.</p>`;
  }
  function controls(s){
    if(s.type==='collection-list')return collectionListControls(s);
    if(s.type==='banner')return `${imageControls(s)}${input('Descrição da imagem','imageAlt',s.imageAlt)}<p class="builder-hint">A imagem mantém sua proporção original, sem corte ou altura fixa.</p><label class="builder-switch"><input type="checkbox" ${s.showText===true?'checked':''} onchange="storefront.change('showText',this.checked);storefront.render()"><span>Mostrar textos e botão sobre a imagem</span></label>${s.showText===true?`${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${textarea('Descrição','subtitle',s.subtitle)}${choose('Alinhamento do texto','align',s.align,[['left','À esquerda'],['right','À direita']])}${input('Texto do botão','buttonLabel',s.buttonLabel)}${input('Link do botão','buttonLink',s.buttonLink,'text','placeholder="/loja/catalogo"')}`:''}`;
    if(s.type==='recommendations')return `${input('Título','title',s.title)}${input('Número de produtos','limit',s.limit,'number','min=\"1\" max=\"24\"')}<p class=\"builder-hint\">Usamos as coleções e a faixa de preço dos produtos visualizados ou do carrinho. O produto atual e os itens do carrinho não se repetem. Somente produtos ativos são exibidos.</p>${productGridControls(s)}`;
    if(s.type==='collection')return `${input('Texto pequeno acima do título','eyebrow',s.eyebrow)}${input('Título','title',s.title)}${choose('Coleção','category',s.category,[['Todos','Todos os produtos'],...db.collections.map(c=>[c,c])])}${input('Número de produtos','limit',s.limit,'number','min="1" max="24"')}${productGridControls(s)}`;
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
    if(key.startsWith('info:')){const page=db.pages.find(p=>p.id===Number(key.slice(5)));return page?pageLabel(page):'Página institucional';}
    if(key==='product')return 'Página de vendas';
    if(key==='collection')return 'Coleção';
    return ({home:'Página inicial',catalog:'Catálogo',cart:'Carrinho',checkout:'Checkout',account:'Meus pedidos',order:'Pedido',login:'Login',signup:'Cadastro'})[key]||'Página da loja';
  }
  function globalControls(){
    const cfg=home().pageSettings?.global||{};
    const colors=(name,prefix,bg,fg)=>`<details class="builder-global-group"><summary>${name}${icon('down')}</summary><div class="builder-fields">${colorControl('Fundo · '+name,prefix+'Background',cfg[prefix+'Background']||bg,'global')}${colorControl('Texto · '+name,prefix+'Text',cfg[prefix+'Text']||fg,'global')}${colorControl('Ícones · '+name,prefix+'Icon',cfg[prefix+'Icon']||fg,'global')}<button class="btn small" onclick="storefront.changeGlobal('${prefix}Reset',true)">Restaurar cores originais</button></div></details>`;
    return `<section class="builder-card builder-global-card"><div class="builder-card-head"><div><span class="eyebrow">EM TODA A LOJA</span><h2>Cabeçalho, rodapé e atendimento</h2></div></div><div class="builder-global-groups">${colors('Cabeçalho','header','#ffffff','#1c2228')}${colors('Rodapé','footer','#1c2228','#d6dde1')}<details class="builder-global-group"><summary>WhatsApp flutuante${icon('down')}</summary><div class="builder-fields"><label class="builder-switch"><input type="checkbox" ${cfg.whatsappEnabled!==false?'checked':''} onchange="storefront.changeGlobal('whatsappEnabled',this.checked)"><span>Mostrar botão de WhatsApp</span></label><label class="builder-switch"><input type="checkbox" ${cfg.whatsappMessages!==false?'checked':''} onchange="storefront.changeGlobal('whatsappMessages',this.checked)"><span>Mostrar sugestões de conversa</span></label><label class="field">Intervalo entre mensagens<select onchange="storefront.changeGlobal('whatsappInterval',Number(this.value))">${[[60,'1 minuto'],[90,'1 minuto e meio'],[180,'3 minutos']].map(([v,t])=>`<option value="${v}" ${Number(cfg.whatsappInterval||90)===v?'selected':''}>${t}</option>`).join('')}</select></label><p class="builder-hint">O botão usa o WhatsApp de Configurações → Dados da loja. As frases aparecem por alguns segundos e podem ser fechadas. Nenhuma mensagem é enviada automaticamente. O botão fica oculto no checkout.</p></div></details><details class="builder-global-group"><summary>Barra de avisos${icon('down')}</summary>${announcementControls()}</details></div></section>`;
  }
  function blockColorControls(s){return `<div class="builder-list-divider"><h3>Cores da seção</h3></div>${colorControl('Fundo da seção','background',s.background||'#ffffff')}${colorControl('Texto da seção','textColor',s.textColor||'#1c2228')}${colorControl('Ícones da seção','iconColor',s.iconColor||s.textColor||'#1c2228')}<p class="builder-hint">Use o seletor ou digite o código hexadecimal. As cores dos botões são configuradas separadamente.</p>`;}
  function changeGlobal(key,value){
    if(!canConfigureSite()||saving)return;const keys=['headerBackground','headerText','headerIcon','footerBackground','footerText','footerIcon','whatsappEnabled','whatsappMessages','whatsappInterval'];
    if(!keys.includes(key)&&!['headerReset','footerReset'].includes(key))return;
    const model=home();model.pageSettings||={};model.pageSettings.global||={};const cfg=model.pageSettings.global;
    if(key.endsWith('Reset')){const prefix=key.replace('Reset','');for(const suffix of ['Background','Text','Icon'])delete cfg[prefix+suffix];render();return;}
    if(key==='whatsappInterval'&&![60,90,180].includes(Number(value)))return;
    cfg[key]=value;refresh();
  }
  function renderPageSections(path,position='after',view=''){
    const key=pageKey(path,typeof catalogCategory==='string'?catalogCategory:'Todos',view),list=home().pageSettings?.[key]?.sections;
    return (Array.isArray(list)?list:[]).filter(s=>(s.position==='before'?'before':'after')===position).map(s=>{const html=renderSection(s,false,path);return html?`<div class="page-theme-section ${s.type==='collection-list'&&s.mobileCarousel?'collection-carousel-section':''}">${html}</div>`:''}).join('');
  }
  function pageControls(){
    const key=pageKey(previewRoute,previewCategory,previewView),cfg=home().pageSettings?.[key]||{};
    const text=(label,name)=>`<label class="field">${label}<input maxlength="200" value="${esc(cfg[name]||'')}" placeholder="Usar o texto atual da loja" oninput="storefront.changePage('${name}',this.value)"></label>`;
    const check=(label,name)=>`<label class="builder-switch"><input type="checkbox" ${cfg[name]!==false?'checked':''} onchange="storefront.changePage('${name}',this.checked)"><span>${label}</span></label>`;
    let fields=key==='product'?`${check('Exibir descrição do produto','showDescription')}${text('Mensagem abaixo do preço','note')}<label class="field">Fotos do produto<select onchange="storefront.changePage('galleryFit',this.value)"><option value="contain" ${cfg.galleryFit!=='cover'?'selected':''}>Mostrar a foto inteira</option><option value="cover" ${cfg.galleryFit==='cover'?'selected':''}>Preencher o espaço da foto</option></select></label>`:`${text('Título da página','title')}${text('Texto de apresentação','intro')}`;
    if(key==='collection')fields+=`${productGridControls(cfg,true)}${check('Exibir filtros de produtos','showFilters')}<label class="field">Produtos por linha no computador<select onchange="storefront.changePage('columns',Number(this.value))">${[2,3,4].map(n=>`<option value="${n}" ${Number(cfg.columns||3)===n?'selected':''}>${n} produtos</option>`).join('')}</select></label>`;
    return `<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">EDITAR PÁGINA</span><h2>${esc(pageTitle())}</h2></div></div><div class="builder-fields">${fields}<p class="builder-hint">${key==='product'?'Este modelo é aplicado a todos os produtos. Cada produto mantém seu título, suas fotos e sua descrição.':key==='collection'?'Este modelo é aplicado a todas as coleções e ao catálogo. Os produtos de cada coleção são mantidos.':'Estas opções personalizam esta página. Navegue na prévia para editar outras partes da loja.'} A loja publicada só muda ao salvar.</p></div></section>`;
  }
  function editorControlsContent(){
    const list=sections(),s=selected==='@page'?null:section()||list[0];selected=s?.id||'@page';
    return globalControls()+`<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">${esc(pageTitle())}</span><h2>Seções da página</h2></div><span class="builder-count">${list.length}</span></div><button class="builder-page-settings" onclick="storefront.selectPage()">${icon('settings')}Configurações da página</button><div class="builder-section-list">${list.map(sectionRow).join('')||'<p class="builder-hint">O conteúdo principal desta página é mantido. Adicione coleções e outros blocos antes ou depois dele.</p>'}</div><button class="builder-add" onclick="storefront.addModal()">${icon('plus')} Adicionar seção</button><p class="builder-hint">Use as setas para organizar as seções. As mudanças só aparecem na loja após salvar.</p></section>`+(s?`<section class="builder-card"><div class="builder-card-head"><div><span class="eyebrow">EDITAR SEÇÃO</span><h2>${esc(labels[s.type])}</h2></div><label class="builder-switch"><input type="checkbox" ${s.enabled?'checked':''} onchange="storefront.toggle('${s.id}',this.checked)"><span>${s.enabled?'Visível':'Oculta'}</span></label></div><div class="builder-fields">${scope()==='home'?'':choose('Posição na página','position',s.position||'after',[['before','Antes do conteúdo principal'],['after','Depois do conteúdo principal']])}${controls(s)}${s.type==='collection-list'?'':blockColorControls(s)}</div><div class="builder-card-foot"><button class="btn small" onclick="storefront.duplicate('${s.id}')">${icon('plus')} Duplicar</button><button class="btn small danger" onclick="storefront.removeModal('${s.id}')">${icon('trash')} Excluir</button></div></section>`:pageControls());
  }
  function selectPage(){selected='@page';render();}

  function editorControls(){const html=editorControlsContent();return typeof layoutThemeEditorControls==='function'?layoutThemeEditorControls(html):html;}
  function saveBar(){return `<div class="builder-save-status" role="status">${uploading?'Enviando imagem…':saving?'Salvando mudanças…':dirty()?'Você tem mudanças não salvas.':'Todas as mudanças estão salvas.'}</div><div class="actions"><button class="btn" aria-label="Cancelar mudanças" onclick="storefront.cancelChanges()" ${!dirty()||saving||uploading?'disabled':''}>${window.innerWidth<=650?'Cancelar':'Cancelar mudanças'}</button><button class="btn primary" aria-label="Salvar mudanças" onclick="storefront.publish()" ${!dirty()||saving||uploading?'disabled':''}>${window.innerWidth<=650?'Salvar':'Salvar mudanças'}</button></div>`}
  function previewOptionValue(){const key=pageKey(previewRoute,previewCategory,previewView);return key==='product'?'template:product':key==='collection'?'template:collection':previewRoute;}
  function pageOptions(){return [['/loja','Página inicial'],['template:product','Página de vendas'],['template:collection','Coleção'],['/loja/carrinho','Carrinho'],['/loja/checkout','Checkout'],['/loja/conta','Meus pedidos'],['/loja/login','Login'],['/loja/cadastro','Cadastro'],...db.pages.filter(p=>p.active).map(p=>['/loja/pagina/'+p.id,pageLabel(p)])].map(([value,label])=>`<option value="${value}" ${previewOptionValue()===value?'selected':''}>${label}</option>`).join('')}
  function editorPage(){
    ensureDraft();
    const params=new URLSearchParams(location.search);params.set('storePreview','1');params.set('channel',channel);
    return (typeof themeEditorHeader==='function'?themeEditorHeader():heading('Loja online','Edite, navegue na prévia e publique quando estiver pronto.',`<a class="btn" href="/loja" target="_blank" rel="noopener noreferrer">${icon('external')}Abrir loja</a>`))+
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
  function select(id){if(!sections().some(s=>s.id===id))return;selected=id;render()}
  function change(key,value){
    if(!canConfigureSite()||saving)return;
    const s=section();if(!s)return;
    if(key.startsWith('items.')){const [,index,field]=key.split('.');if(!s.items?.[Number(index)]||!(s.type==='collection-list'?['category','title','image','imageAlt']:['title','body','icon']).includes(field))return;if(s.type==='collection-list'&&field==='category'&&(!db.collections.includes(value)||s.items.some((item,i)=>i!==Number(index)&&item.category===value))){toast('Escolha uma coleção que ainda não está nesta lista.');render();return}s.items[Number(index)][field]=value}
    else if(s.type==='collection-list'&&['shape','imageFit','columns','mobileColumns','showHeading','showTitles','showArrows','showCounts','background','textColor','cardBackground','cardTextColor','titleAlign','headingSize','mobileCarousel','padding'].includes(key)){s[key]=['columns','mobileColumns','padding'].includes(key)?Number(value):value;}
    else if(['collection','recommendations'].includes(s.type)&&['contentAlign','productButtonLabel','productButtonColor','viewAllColor','viewAllAlign','showViewAll'].includes(key)){s[key]=key==='productButtonLabel'?String(value).slice(0,60):value;}
    else if(['background','textColor','iconColor','position'].includes(key)){if(key==='position'&&!['before','after'].includes(value))return;s[key]=value;}
    else if(['eyebrow','title','subtitle','body','image','imageAlt','url','align','layout','buttonLabel','buttonLink','category','limit','showText'].includes(key))s[key]=key==='limit'?Math.max(1,Math.min(24,Number(value)||1)):key==='showText'?Boolean(value):value;
    else return;
    if(s.type==='collection-list'&&['shape','mobileCarousel'].includes(key))render();else refresh();
  }
  function changePage(key,value){
    if(!canConfigureSite()||saving||!['title','intro','note','showDescription','galleryFit','columns','showFilters','contentAlign','productButtonLabel','productButtonColor'].includes(key))return;
    const scope=pageKey(previewRoute,previewCategory,previewView),model=home();model.pageSettings||={};
    // Shared templates replace legacy per-item overrides in the draft only.
    if(['product','collection'].includes(scope))for(const name of Object.keys(model.pageSettings)){if(name.startsWith(scope+':')||(scope==='collection'&&name==='catalog'))delete model.pageSettings[name];}
    model.pageSettings[scope]||={};model.pageSettings[scope][key]=value;refresh();
  }
  function setCollectionItemOpen(id,open){if(open)openedCollectionItem=id;else if(openedCollectionItem===id)openedCollectionItem='';}
  function addCollectionItem(){
    if(!canConfigureSite()||saving||uploading)return;const s=section();if(s?.type!=='collection-list')return;s.items||=[];
    if(s.items.length>=40)return toast('O limite é de 40 coleções por lista.');
    const category=[...visibleCollections(),...db.collections].find(name=>!s.items.some(item=>item.category===name));
    if(!category)return toast('Todas as coleções já estão na lista. Crie outra em Coleções para adicioná-la.');
    const item={id:newId(),category,title:'',image:'',imageAlt:''};s.items.push(item);openedCollectionItem=item.id;render();
  }
  function moveCollectionItem(index,step){if(!canConfigureSite()||saving||uploading)return;const items=section()?.type==='collection-list'?section().items:[],next=index+step;if(!Number.isInteger(index)||!items?.[index]||next<0||next>=items.length)return;[items[index],items[next]]=[items[next],items[index]];render();}
  function removeCollectionItem(index){if(!canConfigureSite()||saving||uploading)return;const s=section();if(s?.type!=='collection-list'||!Number.isInteger(index)||!s.items?.[index])return;s.items.splice(index,1);render();}
  function changeAnnouncement(key,value){if(!canConfigureSite()||saving||!['enabled','text','highlight'].includes(key))return;home().announcement[key]=value;if(key==='enabled')render();else refresh()}
  function toggle(id,enabled){if(!canConfigureSite()||saving)return;const s=sections().find(s=>s.id===id);if(!s)return;s.enabled=enabled;render()}
  function move(id,step){if(!canConfigureSite()||saving)return;const list=sections(),i=list.findIndex(s=>s.id===id),j=i+step;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];render()}
  function addModal(){modal('Adicionar seção',`<p>Escolha o conteúdo para ${esc(pageTitle().toLowerCase())}. A nova seção começa oculta.</p><div class="builder-add-grid">${Object.entries(labels).map(([type,label])=>`<button onclick="storefront.add('${type}')">${icon(({banner:'image',image:'image',video:'eye',collection:'layers',recommendations:'layers','collection-list':'layers',text:'page',benefits:'shield'})[type])}<strong>${label}</strong></button>`).join('')}</div>`)}
  function add(type){
    if(!canConfigureSite()||saving||!labels[type])return;
    if(sections().length>=(scope()==='home'?80:20))return toast('O limite de seções desta página foi atingido.');
    const base={id:newId(),type,enabled:false,...(scope()==='home'?{}:{position:'after'})};
    const presets={recommendations:{title:'Você também pode gostar',limit:4,showViewAll:false},banner:{showText:false,eyebrow:'',title:'',subtitle:'',image:'',imageAlt:'',buttonLabel:'',buttonLink:'/loja/catalogo',align:'left'},collection:{eyebrow:'EXPLORE A LOJA',title:'Nossa seleção',category:'Todos',limit:4},image:{eyebrow:'FORTE OUTLET',title:'Sua casa merece esse cuidado.',body:'',image:'',imageAlt:'',layout:'image-left',buttonLabel:'',buttonLink:'/loja/catalogo'},video:{eyebrow:'INSPIRE-SE',title:'Veja de perto',body:'',url:''},text:{eyebrow:'NOSSA HISTÓRIA',title:'Sua casa merece o melhor.',body:'',buttonLabel:'',buttonLink:'/loja/catalogo'},benefits:{items:structuredClone(defaultBenefits)}};
    presets['collection-list']={title:'O que você procura?',showHeading:true,headingSize:'medium',titleAlign:'left',shape:'square',imageFit:'cover',columns:6,mobileColumns:2,mobileCarousel:false,padding:40,showTitles:true,showArrows:false,showCounts:false,background:'#ffffff',textColor:'#1c2228',cardBackground:'#f5f5f3',cardTextColor:'#1c2228',items:visibleCollections().slice(0,6).map(category=>({id:newId(),category,title:'',image:'',imageAlt:''}))};
    Object.assign(base,presets[type]);sections(true).push(base);selected=base.id;closeModal();render();toast('Seção adicionada ao rascunho.');return base.id;
  }
  function duplicate(id){if(!canConfigureSite()||saving)return;const list=sections(),i=list.findIndex(s=>s.id===id);if(i<0||list.length>=(scope()==='home'?80:20))return;const copy=structuredClone(list[i]);copy.id=newId();if(copy.type==='collection-list')copy.items=copy.items.map(item=>({...item,id:newId()}));copy.enabled=false;list.splice(i+1,0,copy);selected=copy.id;render()}
  function removeModal(id){const s=sections().find(s=>s.id===id);if(!s)return;modal('Excluir seção',`<p>Remover <strong>${esc(s.title||labels[s.type])}</strong> do rascunho?</p><div class="form-actions"><button class="btn" onclick="closeModal()">Manter seção</button><button class="btn danger" onclick="storefront.remove('${id}')">Remover do rascunho</button></div>`)}
  function remove(id){if(!canConfigureSite()||saving)return;const list=sections(),i=list.findIndex(s=>s.id===id);if(i<0)return;if(scope()==='home'&&list.length===1)return toast('Oculte a última seção ou adicione outra antes de excluir.');list.splice(i,1);selected=list[Math.min(i,list.length-1)]?.id||'';closeModal();render()}
  async function uploadImage(input,key){
    const s=section(),file=input.files?.[0];if(!canConfigureSite()||saving||uploading||!s||!file)return;
    const match=/^items\.(\d+)\.image$/.exec(key);const target=match&&s.type==='collection-list'?s.items?.[Number(match[1])]:key==='image'?s:null;if(!target)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)return toast('Envie JPG, PNG ou WebP de até 2 MB.');
    uploading=true;input.disabled=true;refresh();
    try{target.image=await uploadProductPhoto(file,'storefront');toast('Imagem adicionada ao rascunho. Salve as mudanças para publicá-la.')}catch(error){toast(error.message)}finally{uploading=false;input.disabled=false;render()}
  }
  function setPreview(size){previewSize=size==='mobile'?'mobile':'desktop';document.querySelectorAll('[data-device]').forEach(b=>b.classList.toggle('active',b.dataset.device===previewSize));sizeFrame()}
  function sizeFrame(){
    const stage=document.querySelector('#builder-frame-stage'),frame=document.querySelector('#store-preview-frame');if(!stage||!frame)return;
    const width=previewSize==='mobile'?390:1280,parent=stage.parentElement,style=typeof getComputedStyle==='function'?getComputedStyle(parent):null;
    const inset=style?(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0):0,scale=Math.min(1,Math.max(1,parent.clientWidth-inset)/width);
    frame.style.width=width+'px';frame.style.height='900px';frame.style.transform=`scale(${scale})`;stage.style.width=width*scale+'px';stage.style.height=900*scale+'px';
  }
  function previewModel(){
    return {productSales:collectionSales(),products:db.products.filter(p=>p.active).map(p=>{const item=structuredClone(p);delete item.cost;item.stock=available(p.id);return item}),collections:db.collections,collectionSettings:db.collectionSettings||{},navigation:db.navigation,orderBumps:(db.orderBumps||[]).filter(b=>b.active).map(({cost,...b})=>b),pages:db.pages,settings:{...db.settings,goal:undefined},storefront:structuredClone(ensureDraft()),orders:authSession?db.orders.filter(o=>o.user_id===authSession.user.id).map(o=>{const item=structuredClone(o);delete item.receipt;delete item.guest_token;delete item.guestToken;item.items=item.items.map(({cost,...line})=>line);return item}):[]};
  }
  function sendPreview(route=false){
    const frame=document.querySelector('#store-preview-frame');if(!frame||!editing())return;
    frame.contentWindow?.postMessage({type:'storefront:model',channel,model:previewModel(),identity:previewIdentity==='current'&&authSession?{id:authSession.user.id,email:currentEmail(),name:currentProfile?.name||''}:null,...(route?{route:previewRoute,category:previewCategory}: {})},location.origin);
  }
  function navigate(value){
    if(value==='template:product'){const product=db.products.find(p=>p.active);if(!product)return toast('Ative um produto para visualizar a página de vendas.');value='/loja/produto/'+product.id;}
    if(value==='template:collection'){const category=visibleCollections()[0]||'Todos';value=category==='Todos'?'/loja/catalogo':'collection:'+encodeURIComponent(category);}
    selected='@page';
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
    const invalid=document.querySelector('.builder-color-hex[aria-invalid="true"]');if(invalid){invalid.focus();invalid.reportValidity();return;}
    saving=true;refresh();
    try{
      await settleAdminWrites();
      if(typeof saveThemeEditor==='function'&&currentEditingThemeId())await saveThemeEditor(draft,baseline);
      else await backendRequest('/rest/v1/rpc/save_storefront',{method:'POST',body:JSON.stringify({p_storefront:draft,p_expected:baseline})},true);
      await loadAdminState();const source=typeof themeEditorModel==='function'?themeEditorModel():db.storefront;baseline=structuredClone(source);draft=structuredClone(source);toast(typeof themeEditorIsDraft==='function'&&themeEditorIsDraft()?'Rascunho salvo. A loja publicada foi preservada.':'Mudanças salvas. A loja publicada foi atualizada.');
    }catch(error){toast('Não foi possível publicar: '+error.message)}
    finally{saving=false;render()}
  }
  async function cancelChanges(){
    if(saving||uploading)return;
    try{await settleAdminWrites();await loadAdminState()}catch(error){toast('Não foi possível atualizar a loja: '+error.message)}
    const source=typeof themeEditorModel==='function'?themeEditorModel():db.storefront;baseline=structuredClone(source);draft=structuredClone(source);render();toast('Alterações não salvas descartadas.');sendPreview();
  }
  window.addEventListener('message',event=>{
    const frame=document.querySelector('#store-preview-frame');
    if(!editing()||!frame||event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.channel!==channel)return;
    if(event.data.type==='storefront:ready')sendPreview(true);
    if(event.data.type==='storefront:route'){
      if(!/^\/loja(?:\/|$)/.test(event.data.route||''))return;
      const previousScope=pageKey(previewRoute,previewCategory,previewView);
      if(previousScope!==pageKey(event.data.route,event.data.category,event.data.view))selected='@page';
      previewRoute=event.data.route;previewCategory=event.data.category||'Todos';previewView=event.data.view||'';
      const node=document.querySelector('#builder-controls');if(node&&previousScope!==pageKey(previewRoute,previewCategory,previewView))node.innerHTML=editorControls();
      const title=document.querySelector('#builder-preview-title');if(title)title.textContent='Prévia · '+pageTitle();
      const select=document.querySelector('[aria-label="Página da prévia"]');if(select)select.value=previewOptionValue();
    }
  });
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue=''}});
  function resetDraft(){draft=null;baseline=null;draftScope='';}
  return {init,selectPage,changeGlobal,renderPageSections,sectionProducts,announcement,storeHome,editorPage,change,changePage,changeColor,changeAnnouncement,toggle,move,addModal,add,duplicate,removeModal,remove,select,uploadImage,setPreview,render,mountPreview,navigate,setIdentity,publish,cancelChanges,dirty,pageKey,setCollectionItemOpen,addCollectionItem,moveCollectionItem,removeCollectionItem,resetDraft};
})();
