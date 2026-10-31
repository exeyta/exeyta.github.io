-- ============================================================
-- Huwy Wallet — серверная часть (Supabase Postgres)
-- Выполнить ОДИН РАЗ в Supabase Dashboard → SQL Editor.
-- Пароль админа сюда НЕ пишем! Он задаётся отдельной командой
-- из README (и никогда не коммитится в git).
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- таблицы ----------
create table if not exists public.huwy_settings(
  id int primary key,
  admin_hash text not null default '',
  rate numeric not null default 10,
  start_bonus numeric not null default 100
);
insert into public.huwy_settings(id) values(1) on conflict (id) do nothing;

create table if not exists public.huwy_profiles(
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text unique not null,
  email text not null,
  address text unique not null,
  balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.huwy_tx(
  id bigint generated always as identity primary key,
  user_id uuid not null references public.huwy_profiles(user_id) on delete cascade,
  kind text not null,
  amt numeric not null,
  note text not null default '',
  t timestamptz not null default now()
);

create table if not exists public.huwy_admin_attempts(
  id bigint generated always as identity primary key,
  t timestamptz not null default now(),
  ok boolean not null
);

-- ---------- генератор адреса ----------
create or replace function public.huwy_gen_address()
returns text language plpgsql as $$
declare a text;
begin
  loop
    a := 'HUWY-' || upper(substr(md5(random()::text),1,4))
        || '-' || upper(substr(md5(random()::text),1,4))
        || '-' || upper(substr(md5(random()::text),1,8));
    exit when not exists (select 1 from public.huwy_profiles where address = a);
  end loop;
  return a;
end $$;

-- ---------- автосоздание кошелька при регистрации ----------
create or replace function public.huwy_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare s_bonus numeric; v_login text;
begin
  select start_bonus into s_bonus from huwy_settings where id = 1;
  v_login := coalesce(nullif(new.raw_user_meta_data->>'login',''), 'user' || substr(new.id::text,1,8));
  insert into huwy_profiles(user_id, login, email, address, balance)
  values (new.id, v_login, new.email, huwy_gen_address(), s_bonus);
  insert into huwy_tx(user_id, kind, amt, note)
  values (new.id, 'bonus', s_bonus, 'Стартовый бонус');
  return new;
exception when unique_violation then
  raise exception 'login_taken';
end $$;

drop trigger if exists huwy_signup on auth.users;
create trigger huwy_signup after insert on auth.users
for each row execute function public.huwy_on_signup();

-- ---------- публичный конфиг (курс) ----------
create or replace function public.huwy_public_config()
returns json language sql security definer set search_path = public as $$
  select json_build_object('rate', rate, 'start_bonus', start_bonus)
  from huwy_settings where id = 1;
$$;

-- ---------- перевод (атомарный, всё проверяет сервер) ----------
create or replace function public.huwy_transfer(p_to text, p_amt numeric, p_memo text default '')
returns text language plpgsql security definer set search_path = public as $$
declare me public.huwy_profiles; rc public.huwy_profiles; v_amt numeric; v_note text;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  v_amt := round(p_amt, 2);
  if v_amt is null or v_amt <= 0 or v_amt > 100000000 then raise exception 'bad_amount'; end if;
  if (select count(*) from huwy_tx where user_id = auth.uid() and kind = 'out'
      and t > now() - interval '1 hour') >= 30 then raise exception 'rate'; end if;
  select * into me from huwy_profiles where user_id = auth.uid();
  if me.balance < v_amt then raise exception 'funds'; end if;
  select * into rc from huwy_profiles where address = upper(nullif(trim(p_to), ''));
  if rc.user_id is null then raise exception 'no_rcpt'; end if;
  if rc.user_id = me.user_id then raise exception 'self'; end if;
  update huwy_profiles set balance = round(balance - v_amt, 2) where user_id = me.user_id;
  update huwy_profiles set balance = round(balance + v_amt, 2) where user_id = rc.user_id;
  v_note := case when trim(coalesce(p_memo,'')) <> ''
            then left(trim(p_memo),120) || ' · ' || rc.address else rc.address end;
  insert into huwy_tx(user_id, kind, amt, note) values (me.user_id, 'out', -v_amt, v_note);
  insert into huwy_tx(user_id, kind, amt, note)
  values (rc.user_id, 'in', v_amt, me.login || case when trim(coalesce(p_memo,'')) <> ''
    then ' · ' || left(trim(p_memo),120) else '' end);
  return rc.login;
end $$;

-- ---------- пополнение (демо; сумму проверяет сервер) ----------
create or replace function public.huwy_deposit(p_rub numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_rub numeric; v_amt numeric; v_rate numeric;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select rate into v_rate from huwy_settings where id = 1;
  v_rub := least(15000, greatest(10, round(coalesce(p_rub,0))));
  if v_rub < 10 then raise exception 'bad_amount'; end if;
  v_amt := round(v_rub * v_rate, 2);
  update huwy_profiles set balance = round(balance + v_amt, 2) where user_id = auth.uid();
  insert into huwy_tx(user_id, kind, amt, note)
  values (auth.uid(), 'deposit', v_amt, 'СБП ' || v_rub::text || ' ₽ (демо)');
  return v_amt;
end $$;

-- ---------- трейдинг (исход решает СЕРВЕР, а не браузер) ----------
create or replace function public.huwy_trade(p_amt numeric)
returns json language plpgsql security definer set search_path = public as $$
declare v_amt numeric; v_win boolean; v_pay numeric;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  v_amt := floor(coalesce(p_amt,0));
  if v_amt < 1 or v_amt > 1000000 then raise exception 'bad_amount'; end if;
  if (select count(*) from huwy_tx where user_id = auth.uid() and kind = 'trade'
      and t > now() - interval '1 hour') >= 20 then raise exception 'rate'; end if;
  if (select balance from huwy_profiles where user_id = auth.uid()) < v_amt
    then raise exception 'funds'; end if;
  update huwy_profiles set balance = round(balance - v_amt, 2) where user_id = auth.uid();
  v_win := random() < 0.48;
  if v_win then
    v_pay := round(v_amt * 1.8, 2);
    update huwy_profiles set balance = round(balance + v_pay, 2) where user_id = auth.uid();
    insert into huwy_tx(user_id, kind, amt, note)
    values (auth.uid(), 'trade', round(v_pay - v_amt,2), 'WIN x1.8');
  else
    v_pay := 0;
    insert into huwy_tx(user_id, kind, amt, note)
    values (auth.uid(), 'trade', -v_amt, 'LOSS');
  end if;
  return json_build_object('win', v_win, 'payout', v_pay);
end $$;

-- ---------- админ-выдача (пароль знает только сервер) ----------
create or replace function public.huwy_admin_issue(p_address text, p_amt numeric, p_pass text)
returns text language plpgsql security definer set search_path = public as $$
declare h text; rc public.huwy_profiles; v_amt numeric;
begin
  if (select count(*) from huwy_admin_attempts where ok = false
      and t > now() - interval '15 minutes') >= 5 then raise exception 'locked'; end if;
  select admin_hash into h from huwy_settings where id = 1;
  if h is null or h = '' or crypt(p_pass, h) <> h then
    insert into huwy_admin_attempts(ok) values (false);
    raise exception 'denied';
  end if;
  insert into huwy_admin_attempts(ok) values (true);
  v_amt := round(p_amt, 2);
  if v_amt is null or v_amt <= 0 or v_amt > 100000000 then raise exception 'bad_amount'; end if;
  select * into rc from huwy_profiles where address = upper(nullif(trim(p_address),''));
  if rc.user_id is null then raise exception 'no_rcpt'; end if;
  update huwy_profiles set balance = round(balance + v_amt, 2) where user_id = rc.user_id;
  insert into huwy_tx(user_id, kind, amt, note)
  values (rc.user_id, 'admin', v_amt, 'Выдача админом');
  return rc.login;
end $$;

-- ---------- Row Level Security: напрямую менять чужое нельзя ----------
alter table public.huwy_profiles enable row level security;
alter table public.huwy_tx enable row level security;
alter table public.huwy_admin_attempts enable row level security;
alter table public.huwy_settings enable row level security;

drop policy if exists huwy_profiles_self on public.huwy_profiles;
create policy huwy_profiles_self on public.huwy_profiles
  for select using (auth.uid() = user_id);

drop policy if exists huwy_tx_self on public.huwy_tx;
create policy huwy_tx_self on public.huwy_tx
  for select using (auth.uid() = user_id);

-- функции SECURITY DEFINER работают от имени владельца и RLS их не касается
