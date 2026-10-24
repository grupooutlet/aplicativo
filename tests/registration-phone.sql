-- Auth inserts and generated profiles below are always rolled back.
begin;
do $test$
declare value text; test_id uuid; normalized text;
begin
 foreach value in array array['21961234567','(21) 96123-4567','+55 (21) 96123-4567','5521961234567','2132345678','(55) 3234-5678'] loop
  normalized:=private.normalize_registration_phone(value);
  if normalized is null then raise exception 'Telefone válido rejeitado: %',value;end if;
 end loop;
 foreach value in array array['','00000000000','99999999999','23961234567','+121961234567','2196123456','2161234567','219612345678','abc21961234567','+55+21961234567','021961234567'] loop
  if private.normalize_registration_phone(value) is not null then raise exception 'Telefone inválido aceito: %',value;end if;
 end loop;
 foreach value in array array['','23961234567','2196123456','abc21961234567'] loop
  test_id:=gen_random_uuid();
  begin
   insert into auth.users(id,email,raw_user_meta_data) values(test_id,'phone-test-'||test_id||'@example.invalid',jsonb_build_object('name','Teste temporário','phone',value));
   raise exception 'Cadastro sem telefone válido foi criado';
  exception when sqlstate '22023' then null;end;
  if exists(select 1 from auth.users where id=test_id) or exists(select 1 from public.profiles where user_id=test_id) then raise exception 'Cadastro inválido persistiu';end if;
 end loop;
 test_id:=gen_random_uuid();
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(test_id,'phone-test-'||test_id||'@example.invalid','{"name":"Teste temporário"}');
  raise exception 'Cadastro sem campo de telefone foi criado';
 exception when sqlstate '22023' then null;end;
 test_id:=gen_random_uuid();
 insert into auth.users(id,email,raw_user_meta_data) values(test_id,'phone-test-'||test_id||'@example.invalid','{"name":"Teste temporário","phone":"(21) 96123-4567","role":"master"}');
 if not exists(select 1 from public.profiles where user_id=test_id and phone='+5521961234567' and role='customer') then raise exception 'Telefone não normalizado ou cargo indevido';end if;
 if has_table_privilege('anon','public.profiles','select') then raise exception 'Telefone dos clientes exposto publicamente';end if;
 begin
  update public.profiles set phone='123' where user_id=test_id;
  raise exception 'Telefone inválido aceito no perfil';
 exception when check_violation then null;end;
end;
$test$;
rollback;
