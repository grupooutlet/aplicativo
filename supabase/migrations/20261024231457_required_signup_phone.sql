-- Validate contact information without changing email/password authentication.
create function private.normalize_registration_phone(p_phone text)
returns text language plpgsql immutable strict
set search_path = pg_catalog as $$
declare input text:=trim(p_phone); digits text; subscriber text;
begin
 if length(input)>40 or input !~ '^\+?[0-9[:space:]().-]+$'
   or (left(input,1)='+' and left(input,3)<>'+55') then return null; end if;
 digits:=regexp_replace(input,'[^0-9]','','g');
 if length(digits) in (12,13) and left(digits,2)='55' then digits:=substr(digits,3);end if;
 if length(digits) not in (10,11) or digits ~ '^([0-9])\1+$'
   or not (left(digits,2)=any(string_to_array('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99',' '))) then return null;end if;
 subscriber:=substr(digits,3);
 if subscriber !~ '^[2-5][0-9]{7}$' and subscriber !~ '^9[0-9]{8}$' then return null; end if;
 return '+55'||digits;
end;
$$;
revoke all on function private.normalize_registration_phone(text) from public,anon,authenticated;

-- Nullable only for accounts that predate this requirement. No phone is invented.
alter table public.profiles add column phone text;
alter table public.profiles add constraint profiles_phone_valid check (
 phone is null or (private.normalize_registration_phone(phone) is not null
   and phone=private.normalize_registration_phone(phone))
);

create or replace function private.create_profile()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare normalized text;
begin
 normalized:=private.normalize_registration_phone(new.raw_user_meta_data->>'phone');
 if normalized is null then
  raise exception using errcode='22023',message='Informe um telefone brasileiro com DDD válido para criar a conta.';
 end if;
 insert into public.profiles(user_id,email,name,phone,role)
 values (new.id,lower(new.email),left(trim(coalesce(new.raw_user_meta_data->>'name','')),120),normalized,'customer')
 on conflict(user_id) do nothing;
 return new;
end;
$$;
revoke all on function private.create_profile() from public,anon,authenticated;
