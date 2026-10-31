-- ============================================================
-- Huwy Wallet — приём оплаты через ЮMoney (НЕ ЮKassa)
-- Выполнить в Supabase SQL Editor ПОСЛЕ supabase/schema.sql
-- Номер кошелька и секрет сюда НЕ пишем — они живут в настройках
-- кошелька ЮMoney и в secrets Edge-функции, в git не попадают.
-- ============================================================

create table if not exists public.huwy_payments(
  operation_id text primary key,   -- id операции ЮMoney: защита от двойного начисления
  address text not null,           -- адрес HUWY получателя (приходит в поле label)
  amount_rub numeric not null,     -- сколько реально пришло (уже за вычетом комиссии)
  huwy numeric not null default 0, -- сколько HUWY начислено
  sender text not null default '', -- кошелёк отправителя
  t timestamptz not null default now()
);
alter table public.huwy_payments enable row level security;
-- политик нет: читает/пишет только сервер (service role), пользователям таблица закрыта

-- Начисление по уведомлению ЮMoney. Вызывает ТОЛЬКО Edge-функция (service role).
create or replace function public.huwy_credit_yoomoney(
  p_address text, p_amount numeric, p_op_id text, p_sender text default ''
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_huwy numeric; prof public.huwy_profiles;
begin
  -- идемпотентность: повтор того же operation_id денег второй раз не даст
  if exists (select 1 from huwy_payments where operation_id = p_op_id) then
    return (select huwy from huwy_payments where operation_id = p_op_id);
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'bad_amount'; end if;
  select * into prof from huwy_profiles where address = upper(trim(p_address));
  if prof.user_id is null then raise exception 'no_rcpt'; end if;
  select rate into v_rate from huwy_settings where id = 1;
  v_huwy := round(p_amount * v_rate, 2);
  update huwy_profiles set balance = round(balance + v_huwy, 2) where user_id = prof.user_id;
  insert into huwy_tx(user_id, kind, amt, note)
  values (prof.user_id, 'deposit', v_huwy, 'ЮMoney ' || p_amount::text || ' ₽');
  insert into huwy_payments(operation_id, address, amount_rub, huwy, sender)
  values (p_op_id, prof.address, p_amount, v_huwy, p_sender);
  return v_huwy;
end $$;
