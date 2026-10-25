-- Exercise the real publishing and collection-rename paths without retaining changes.
begin;
do $test$
declare actor uuid; customer_actor uuid; st public.app_state%rowtype; original jsonb; candidate jsonb;
 list jsonb; names text[]; renamed text; invalid jsonb; section_index integer;
begin
 select user_id into actor from public.profiles where role='admin' and position='Vendedor' limit 1;
 select user_id into customer_actor from public.profiles where role='customer' limit 1;
 if actor is null or customer_actor is null then raise exception 'Fixtures ausentes';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select * into st from public.app_state where id=1;original:=st.data;
 select array_agg(value order by ord) into names from (select value,ord from jsonb_array_elements_text(st.data->'collections') with ordinality c(value,ord) limit 2) c;
 if coalesce(array_length(names,1),0)<2 then raise exception 'Duas coleções são necessárias';end if;
 list:=jsonb_build_object('id','qa-list-'||gen_random_uuid(),'type','collection-list','enabled',true,'title','O que você procura?',
   'shape','round','columns',6,'mobileColumns',2,'mobileCarousel',true,'background','#1c2228','textColor','#ffffff','cardBackground','#f5f5f3','cardTextColor','#1c2228',
   'showHeading',true,'showTitles',true,'showArrows',true,'showCounts',false,'imageFit','cover','titleAlign','left','headingSize','medium','padding',40,
   'items',jsonb_build_array(jsonb_build_object('id','qa-item-1','category',names[1],'title','Nome personalizado','image','https://example.invalid/collection.webp','imageAlt','Coleção de teste'),
     jsonb_build_object('id','qa-item-2','category',names[2],'title','','image','','imageAlt','')));
 section_index:=jsonb_array_length(st.data->'storefront'->'sections');
 candidate:=jsonb_set(st.data->'storefront','{sections}',(st.data->'storefront'->'sections')||jsonb_build_array(list));
 perform public.save_storefront(candidate,st.data->'storefront');
 if (select data->'storefront'->'sections'->section_index from public.shop_public where id=1) is distinct from list then raise exception 'Lista não publicada na projeção pública';end if;
 begin perform public.save_storefront(candidate,st.data->'storefront');raise exception 'Concorrência ignorada';exception when others then if sqlerrm not like 'A loja foi alterada%' then raise;end if;end;
 select * into st from public.app_state where id=1;
 foreach invalid in array array[
  jsonb_set(list,'{background}','"red;position:fixed"'),
  jsonb_set(list,'{shape}','"invalid-shape"'),
  jsonb_set(list,'{columns}','99'),
  jsonb_set(list,'{items,1,category}',to_jsonb(names[1])),
  jsonb_set(list,'{items,0,image}','"javascript:alert(1)"'),
  jsonb_set(list,'{items,0,category}','"Coleção que não existe QA"')
 ] loop
  begin
   perform public.save_storefront(jsonb_set(candidate,array['sections',section_index::text],invalid),st.data->'storefront');
   raise exception 'Configuração inválida aceita';
  exception when others then if sqlerrm='Configuração inválida aceita' then raise;end if;end;
 end loop;
 renamed:='QA Coleção '||gen_random_uuid();
 perform public.save_collection(names[1],renamed,true,'manual',null,st.version);
 select * into st from public.app_state where id=1;
 if st.data->'storefront'->'sections'->section_index->'items'->0->>'category'<>renamed then raise exception 'Coleção renomeada perdeu vínculo';end if;
 if st.data->'storefront'->'sections'->section_index->'items'->0->>'title'<>'Nome personalizado' then raise exception 'Nome personalizado perdido';end if;
 if jsonb_array_length(private.remap_collection_list_sections(st.data->'storefront'->'sections',renamed,null)->section_index->'items')<>1 then raise exception 'Remoção da coleção deixou cartão inválido';end if;
 perform set_config('request.jwt.claim.sub',customer_actor::text,true);
 begin perform public.save_storefront(st.data->'storefront',st.data->'storefront');raise exception 'Cliente publicou a loja';exception when others then if sqlerrm not like 'Somente a equipe autorizada%' then raise;end if;end;
end;
$test$;
rollback;
