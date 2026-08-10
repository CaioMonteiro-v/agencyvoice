# Deploy no Render

## 1. Blueprint

1. Abra https://dashboard.render.com/select-repo?type=blueprint  
2. Repo: `CaioMonteiro-v/agencyvoice`  
3. Branch: `cursor/agencyvoice-clonagem-voz-7a78` (ou `main` após merge)  
4. Apply o `render.yaml`

## 2. Environment Variables (obrigatório para clonagem cloud)

No serviço web → **Environment**:

| Key | Value |
|-----|--------|
| `ELEVENLABS_API_KEY` | `sk_...` (secret da ElevenLabs, **não** o Key ID) |
| `VOICE_PROVIDER` | `elevenlabs` |
| `NODE_VERSION` | `22` |

A chave **não** precisa estar no Cursor nem no Git — só no painel do Render.

## 3. Deploy

Se o serviço for **Docker** (erro `open Dockerfile: no such file`):
- Já existe `Dockerfile` na raiz — faça **Manual Deploy** de novo

Se for **Native Node**:
- Build: `npm run install:all && npm run build`
- Start: `npm run start:web`

Health: `GET /api/health`

## 4. Teste

Abra `https://<seu-servico>.onrender.com` → **Abrir estúdio**:

1. **Capturar / Clonar** — grave ou envie áudio e salve a voz  
2. **Gerar** — roteiro → fala (salva automaticamente em **Criações**)  
3. **Criações** — ouça, baixe e gerencie spots gerados  
4. **Vozes** — biblioteca das vozes clonadas (sincroniza com ElevenLabs)  
5. **Pronúncia** — treine nomes (palavra → como deve soar)

> Free tier do Render “dorme” após inatividade; o primeiro request pode demorar ~1 min.  
> Disco do plano free é efêmero: criações/pronúncias locais podem sumir no redeploy. Vozes clonadas na conta ElevenLabs voltam ao sincronizar a aba **Vozes**.
