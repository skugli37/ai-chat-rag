# 🚀 Deploy Multi-Agent RAG aplikacije

## Opcija 1: Vercel (Najlakše) ⭐

### Koraci:
```bash
# 1. Instaliraj Vercel CLI
npm i -g vercel

# 2. Login (otvoriće browser)
vercel login

# 3. Deploy
cd /home/z/my-project
vercel

# 4. Production deploy
vercel --prod
```

**Rezultat:** Dobićeš URL kao `https://ai-chat-rag.vercel.app`

---

## Opcija 2: Railway (Besplatno)

### Koraci:
```bash
# 1. Instaliraj Railway CLI
npm i -g @railway/cli

# 2. Login
railway login

# 3. Deploy
cd /home/z/my-project
railway init
railway up

# 4. Set environment variables
railway variables set DATABASE_URL="file:./dev.db"
```

**URL:** `https://ai-chat-rag.up.railway.app`

---

## Opcija 3: Render (Besplatno)

1. Idi na https://render.com
2. Sign up sa GitHub-om
3. "New Web Service"
4. Connect repo: `skugli37/ai-chat-rag`
5. Build Command: `bun install && bun run build`
6. Start Command: `bun server.js`
7. Deploy!

---

## Opcija 4: Fly.io (Besplatno)

```bash
# 1. Instaliraj flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Deploy
cd /home/z/my-project
fly launch
fly deploy
```

---

## Nakon Deploy-a - Instalacija na telefon 📱

### Android:
1. Chrome → Tvoj URL
2. Menu (⋮) → "Add to Home screen"
3. Gotovo!

### iOS:
1. Safari → Tvoj URL
2. Share → "Add to Home Screen"
3. Gotovo!

---

## Environment Variables (ako treba)

```env
DATABASE_URL="file:./dev.db"
NODE_ENV="production"
```

---

## Provjera da li radi

```bash
# Test API
curl https://tvoj-url.vercel.app/api/documents

# Test chat
curl -X POST https://tvoj-url.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}'
```
