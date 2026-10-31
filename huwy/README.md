# Huwy Wallet

Игровой кошелёк: валюта **HUWY**, регистрация/вход, переводы по адресу,
пополнение через ЮMoney, трейдинг, QR + сканер камеры, админ-выдача, PWA-установка.

**Стек:** только HTML + CSS + JS. Без Node.js, без фреймворков, без сборки.
Библиотеки с CDN: `qrcodejs` (QR), `html5-qrcode` (сканер), `supabase-js` (сервер).
Сервер: Supabase (Postgres + Auth) + Edge-функция приёма уведомлений ЮMoney.

Аккаунты и балансы хранятся на сервере. Подделать баланс через DevTools нельзя:
переводы, начисления и исход трейдинга считают SQL-функции с проверками и лимитами.

## Структура

```
huwy-wallet/
├── index.html
├── manifest.webmanifest
├── sw.js
├── icons/icon.svg
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── config.js   ← URL Supabase, anon-ключ, номер кошелька ЮMoney
│       └── app.js
├── supabase/
│   ├── schema.sql      ← таблицы + защищённые функции (выполнить 1 раз)
│   ├── yoomoney.sql    ← приём оплаты ЮMoney (выполнить 1 раз)
│   └── functions/
│       └── yoomoney-notify/index.ts  ← приём уведомлений (деплой через Dashboard)
```

## Запуск (порядок важен)

Проект: `mdzhhyecvaewqzhjjbpz.supabase.co`

**Шаг 1 — таблицы (1 раз):** Dashboard → SQL Editor → New query →
вставь целиком `supabase/schema.sql` → Run, затем так же `supabase/yoomoney.sql`.

**Шаг 2 — админ-пароль (только на сервере, в git не попадает!):**
В SQL Editor выполни, подставив СВОЙ пароль:
```sql
update huwy_settings
set admin_hash = crypt('ТВОЙ_ПАРОЛЬ', gen_salt('bf'))
where id = 1;
```
После 5 неверных попыток сервер блокирует админку на 15 минут.

**Шаг 3 — вход без почты (обязательно):** Authentication → Providers → Email →
выключи `Confirm email`. (Не в разделе Emails/Templates, а именно Providers → Email.)
Вход в кошелёк — только по логину и паролю (внутри используется технический email,
почта игрокам не нужна), со включённым подтверждением никто не сможет войти.

**Шаг 4 — ключ сайта:** Dashboard → Settings → API → скопируй
`anon public key` → вставь в `SUPABASE_ANON_KEY` в `assets/js/config.js`.
URL уже вписан. Внимание: это НЕ пароль БД — пароль БД никуда в код не вписывается.

**Шаг 5 — уведомления ЮMoney:**
1. Dashboard → Edge Functions → New Function → имя `yoomoney-notify` →
   вставь код из `supabase/functions/yoomoney-notify/index.ts` → Deploy.
2. Edge Functions → Secrets → добавь `YOOMONEY_SECRET` = секретное слово из
   настроек HTTP-уведомлений кошелька (кнопка «Показать секрет»).
   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` подставляются сами.
3. В кошельке ЮMoney (`4100119281735129`):
   Настройки → Уведомления по HTTP → https://yoomoney.ru/transfer/myservices/http-notification
   вставь адрес ниже → включи «Отправлять HTTP-уведомления» → «Протестировать».
   На один кошелёк — только один адрес уведомлений.

## Готовые URI

| Что | Значение |
|---|---|
| Redirect URI (куда ЮMoney вернёт плательщика; подставляется сам, настраивать не надо) | `https://<твой-ник>.github.io/huwy-wallet/?pay=success` |
| Notification URI (вставить в настройки HTTP-уведомлений кошелька) | `https://mdzhhyecvaewqzhjjbpz.supabase.co/functions/v1/yoomoney-notify` |
| Кошелёк получателя | `4100119281735129` (уже в `config.js`) |

## Как это работает

Игрок жмёт «Оплатить через ЮMoney» → уходит на yoomoney.ru (сумма,
метка `label` = его адрес HUWY) → платит → ЮMoney шлёт подписанное уведомление
на Edge-функцию → та проверяет подпись HMAC-SHA256, начисляет `сумма × курс`
через `huwy_credit_yoomoney` (повтор того же `operation_id` денег дважды не даст).
Игрок возвращается по Redirect URI, баланс обновляется сам.

**Оговорки:** зачисляем по факту (`amount` из уведомления) — при оплате картой
ЮMoney снимет ~3% с получателя. Для снятия лимитов кошелёк лучше идентифицировать.

**Что защищает сервер:**
- переводы — атомарная SQL-функция: баланс, адрес, лимит 30/час;
- пополнение — только по подписанному уведомлению ЮMoney;
- трейдинг — выигрыш решает `random()` на сервере;
- чужие балансы и история недоступны (Row Level Security);
- админ-пароль — bcrypt-хэш только в БД + блокировка перебора.

## Выкладка на GitHub Pages

1. Создай репозиторий `huwy-wallet` (Public).
2. Загрузи туда **содержимое папки `huwy-wallet/`**: `Upload files` или через git:
```bash
cd huwy-wallet
git init -b main
git add .
git commit -m "Huwy Wallet"
git remote add origin https://github.com/<ник>/huwy-wallet.git
git push -u origin main
```
3. Settings → Pages → Deploy from branch → `main` → `/ (root)` → Save.
4. Готово: `https://<твой-ник>.github.io/huwy-wallet/`

## Лицензия

MIT — делай что хочешь.
