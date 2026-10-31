/* Huwy Wallet — настройки. Сборка не нужна.
   Режим только серверный: Supabase + ЮMoney. */
window.HUWY_CONFIG = {
  RATE: 10,               // курс по умолчанию; точный берётся из БД (huwy_public_config)
  START_BONUS: 100,       // стартовый баланс (дублирует БД, точный — в БД)
  TRADE_WAIT_MS: 15000,   // ожидание результата сделки
  SUPABASE_URL: "https://mdzhhyecvaewqzhjjbpz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_pNiFf09zk12EKKVU7_wIhQ_aDqq0NOi",
  // --- ЮMoney (обычный кошелёк физлица, НЕ ЮKassa) ---
  YOOMONEY_WALLET: "4100119281735129",
  // client_id OAuth-приложения кошелька (публичный, не секрет).
  // В текущей схеме (формы + HTTP-уведомления) НЕ используется — для справки.
  YOOMONEY_CLIENT_ID: "2A1E0780EDB358A33A4427C4C669025AC09F4DDEEF5C51359E06232F6945F678"
};
