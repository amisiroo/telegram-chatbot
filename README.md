# Telegram Chatbot (Serverless, Node.js + MongoDB)

A crash-proof Telegram bot built for **Vercel serverless functions** using `node-telegram-bot-api`, with a layered structure (controller → model → utilities) and MongoDB persistence (Mongoose). The bot is designed to run on webhooks for reliability on serverless platforms, and to avoid top-level crashes by **lazy-requiring** heavy deps.

---

## ✨ Features

* **Webhook-driven** Telegram bot (ready for Vercel `/api` route).
* **Lazy imports & singletons** to avoid serverless cold-start crashes.
* **MongoDB persistence** via Mongoose models.
* **Separation of concerns** (controller/model/utilities).
* Safe env var usage; no hardcoded tokens.

> Vercel exposes serverless routes from the `/api` directory by default, which maps well to Telegram webhooks. ([Marc Littlemore][1])
> Telegram bots must use either long polling or a webhook; serverless prefers webhooks. ([Telegram Core][2])

---

## 🧱 Tech Stack

* **Runtime:** Node.js (Vercel Serverless Functions)
* **Telegram SDK:** `node-telegram-bot-api`
* **Database:** MongoDB + Mongoose
* **Hosting:** Vercel (recommended)

---

## 🚀 Quick Start

### 1) Prerequisites

* Node.js 18+ and a Telegram bot token from **@BotFather**. ([Telegram Core][2])
* A MongoDB connection URI (Atlas or self-hosted).

### 2) Clone & install

```bash
git clone https://github.com/amisiroo/telegram-chatbot.git
cd telegram-chatbot
npm install
```

### 3) Environment variables

```
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=mongodb+srv://...
BOT_SECRET=optional_random_string   # if you verify secrets/signature
```

## 🔐 Security Notes

* **Never** commit your `BOT_TOKEN` or `DATABASE_URL`.
* Consider validating a shared secret on webhook requests (via `BOT_SECRET`) if you proxy through your own API gateway.
* Sanitize all user input.

---

## ❓FAQ

**Q: Do I need to “set webhook” again after every deploy?**
A: Only if your public URL changes. If the domain stays the same, the webhook stays valid. (You can verify with `getWebhookInfo`.) ([Telegram Core][2])

**Q: Can I keep the DB “always connected”?**
A: In serverless, there’s no true “always on”. Use the **cached connection** singleton so warm invocations reuse it. If you need zero-cold-start and persistent sockets, consider a small always-on VM/server. ([Marc Littlemore][1])

**Q: Polling vs Webhook?**
A: **Webhook** is recommended for serverless (event-driven, no idle polling). Use polling only for quick local tests. ([Telegram Core][2])

---

## 📚 References

* Telegram Bot API docs / tutorial (BotFather, webhooks, best practices). ([Telegram Core][2])
* Vercel serverless functions and `/api` convention (good fit for webhooks). ([Marc Littlemore][1])
* Modern Node.js Telegram bot stacks (alternatives like telegraf/grammY). ([LogRocket Blog][3])

---

## 📄 License

MIT (or your choice—add a `LICENSE` file if desired).

---

If you’d like, I can also open a PR to your repo with this `README.md` and (optionally) add example controller/model stubs and a `connectToDB.js` using the cached pattern.

[1]: https://www.marclittlemore.com/serverless-telegram-chatbot-vercel
[2]: https://core.telegram.org/bots/tutorial
[3]: https://blog.logrocket.com/building-telegram-bot-grammy
