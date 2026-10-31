/* Huwy Wallet — настройки. Сборка не нужна.
   Сервер: Firebase (Auth + Firestore). ЮMoney и Supabase удалены. */
window.HUWY_CONFIG = {
  FIREBASE: {
    apiKey: "AIzaSyBH6uO2r7d00ADENycwmCpyRo6miHZ5ZXk",
    authDomain: "tlpr0d.firebaseapp.com",
    projectId: "tlpr0d",
    storageBucket: "tlpr0d.firebasestorage.app",
    messagingSenderId: "341530473345",
    appId: "1:341530473345:web:9f129b22137982df83ae80"
  },
  RATE: 10,               // ориентировочный курс для отображения ≈₽
  START_BONUS: 100,       // должен совпадать с balance в firestore.rules
  TRADE_WAIT_MS: 15000,
  // UID аккаунта админа (Firebase Console → Authentication → Users → UID).
  // Пока пусто — вкладка «Админ» скрыта, права никому не выданы.
  // После вставки заменить ADMIN_UID_PLACEHOLDER в firestore.rules на тот же UID.
  ADMIN_UID: ""
};
