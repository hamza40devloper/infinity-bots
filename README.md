# KeepAliveMC (MVP)

خلاصة: خدمة بسيطة لتشغيل بوت Minecraft (mineflayer) يبقى 24h كـ "keepalive" للسيرفرات الخاصة بك.

## الملفات
- `server.js` — backend Node.js
- `Dockerfile` — لصنع صورة Docker (مناسبة لـRender)
- `frontend/index.html` — واجهة بسيطة (استضفها على GitHub Pages)
- `.env.example` — مثال متغيرات البيئة

## إعداد محلي
1. انسخ الملفات إلى مجلد.
2. أنشئ `.env` محتويًا `API_KEY=some_secret` (أو ضع env var على Render).
3. تثبيت وتشغيل محليًا:
```bash
npm ci
export API_KEY=your_secret
node server.js
