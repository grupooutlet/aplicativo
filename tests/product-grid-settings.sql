-- Verify existing publishing supports card settings without changing the live home.
begin;
do $test$
declare actor uuid; st public.app_state%rowtype; candidate jsonb; section_index integer;
begin
 select user_id into actor from public.profiles where role='admin' and position='Vendedor' limit 1;
 if actor is null then raise exception 'Vendedor de teste ausente';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select * into st from public.app_state where id=1;
 select ordinality-1 into section_index from jsonb_array_elements(st.data->'storefront'->'sections') with ordinality where value->>'type'='collection' limit 1;
 candidate:=jsonb_set(st.data->'storefront',array['sections',section_index::text],
   (st.data->'storefront'->'sections'->section_index)||jsonb_build_object('contentAlign','center','productButtonLabel','Conhecer produto','productButtonColor','#1c2228'));
 candidate:=candidate||jsonb_build_object('pageSettings',jsonb_build_object('collection',jsonb_build_object('contentAlign','center','productButtonLabel','Ver detalhes','productButtonColor','#f3c30b')));
 perform public.save_storefront(candidate,st.data->'storefront');
 if (select data->'storefront' from public.shop_public where id=1) is distinct from candidate then raise exception 'Aparência dos cartões não publicada';end if;
end;
$test$;
rollback;
