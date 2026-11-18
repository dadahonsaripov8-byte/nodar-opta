const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ДАННЫЕ ВАШЕЙ КАССЫ ROLLYPAY (вынесите в .env на продакшене)
const ROLLYPAY_API_URL = 'https://rollypay.io';
const API_KEY = process.env.ROLLYPAY_API_KEY || 'ВАШ_API_KEY';
const SIGNING_SECRET = process.env.ROLLYPAY_SIGNING_SECRET || 'ВАШ_SIGNING_SECRET';
const SITE_URL = process.env.SITE_URL || 'https://ваш-домен.ru';

// Хранилище заказов в памяти (на продакшене замените на PostgreSQL / SQLite / MongoDB)
const orders = new Map();

// 1. Создание платежа на фиксированную сумму 199 ₽
app.post('/api/create-payment', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Укажите email' });
    }

    const orderId = 'nodar_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const nonce = crypto.randomUUID(); // Уникальный X-Nonce для защиты от повторов

    orders.set(orderId, { email, amount: 199, status: 'pending' });

    const response = await fetch(ROLLYPAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'X-Nonce': nonce
      },
      body: JSON.stringify({
        amount: 199,
        currency: 'RUB',
        order_id: orderId,
        description: 'Nodar Opty — тариф Навсегда (199 ₽)',
        success_redirect_url: `${SITE_URL}/success?order_id=${orderId}`,
        callback_url: `${SITE_URL}/api/rollypay-webhook`
        // test: true // Раскомментируйте для проверки в Sandbox-режиме
      })
    });

    const data = await response.json();

    if (!response.ok || !data.pay_url) {
      console.error('Ошибка RollyPay:', data);
      return res.status(502).json({ error: 'Ошибка платёжного шлюза' });
    }

    res.json({ pay_url: data.pay_url, order_id: orderId });
  } catch (error) {
    console.error('Ошибка сервера:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 2. Приём и проверка HMAC-SHA256 вебхука от RollyPay
app.post('/api/rollypay-webhook', (req, res) => {
  const signature = req.headers['x-signature'];
  const rawBody = JSON.stringify(req.body);

  // Проверка подписи X-Signature
  const expectedSignature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(rawBody)
    .digest('hex');

  if (!signature || signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  // Обрабатываем успешную оплату
  if (event.event === 'payment.paid' || event.status === 'paid') {
    const orderId = event.order_id || event.data?.order_id;
    const order = orders.get(orderId);

    if (order && order.status !== 'paid') {
      order.status = 'paid';
      orders.set(orderId, order);

      // ЗДЕСЬ ВЫДАЁМ ДОСТУП ПОЛЬЗОВАТЕЛЮ (отправка ключа на order.email, активация аккаунта)
      console.log(`Оплата 199 ₽ подтверждена! Выдаём доступ навсегда для: ${order.email}`);
    }
  }

  res.status(200).send('OK');
});

// 3. Страница после возврата с оплаты
app.get('/success', (req, res) => {
  res.send(`
    <div style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#fff;min-height:100vh;">
      <h1>Спасибо за покупку Nodar Opty!</h1>
      <p>Как только платёж подтвердится, доступ навсегда будет отправлен на указанный вами Email.</p>
      <a href="/" style="color:#38bdf8;">Вернуться на главную</a>
    </div>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
