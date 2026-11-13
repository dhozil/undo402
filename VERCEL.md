# Undo402 on Vercel

Static frontend only (`frontend/`). All writes are signed by the visitor's own wallet via MetaMask — no backend needed.

## Deploy via dashboard (recommended)
1. Push this repo to GitHub
2. vercel.com → Add New Project → import `dhozil/undo402`
3. Root Directory: `frontend`
4. Deploy — no build command needed

## Deploy via CLI
```bash
npm i -g vercel
vercel --prod
```
`vercel.json` sets output to `frontend/` with SPA fallback.
