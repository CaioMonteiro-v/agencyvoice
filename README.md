# AgencyVoice AI

IA própria de clonagem de voz para campanhas. A ElevenLabs serviu só de **referência de produto** — a inferência roda no nosso motor (XTTS-v2), com português nativo.

## Arquitetura

```
Browser (React)
    → Gateway Node (:3001)
        → AgencyVoice AI / Python FastAPI (:8000)
            → XTTS-v2 (clone zero-shot + síntese)
            → perfis em /voices/<id>/
```

1. **Captura** — microfone ou upload  
2. **Clone** — cria perfil vocal com as amostras do candidato  
3. **Gera** — texto → fala com o timbre clonado  

## Provedores de voz

| `VOICE_PROVIDER` | Comportamento |
|------------------|---------------|
| `auto` (padrão) | ElevenLabs se `ELEVENLABS_API_KEY` (`sk_…`) existir; senão IA local |
| `elevenlabs` | SDK oficial `@elevenlabs/elevenlabs-js` (IVC + `textToSpeech.convert`) |
| `local` | AgencyVoice AI (XTTS) |

ElevenLabs no gateway segue o mesmo padrão do site:

```ts
elevenlabs.textToSpeech.convert(voiceId, {
  text,
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
});
```

```bash
cp .env.example .env
# ELEVENLABS_API_KEY=sk_...   ← secret, NÃO o Key ID
```

**Nunca commit a API key.** O arquivo `.env` já está no `.gitignore`.

## Setup local

```bash
npm run install:all
npm run setup:ai   # só se for usar motor local
cp .env.example .env
# ELEVENLABS_API_KEY=sk_...
npm run dev
```

- App: http://localhost:5173  
- Gateway: http://localhost:3001  

## Deploy no Render

1. Merge/push desta branch no GitHub  
2. Em [Render → New → Blueprint](https://dashboard.render.com/select-repo?type=blueprint), conecte o repo `agencyvoice`  
3. No serviço, defina o secret **`ELEVENLABS_API_KEY`** com a chave `sk_…` (não o Key ID)  
4. Deploy usa `render.yaml` → build do frontend + `npm run start:web`

A API key **nunca** vai no código nem no Git — só em `.env` local ou Environment Variables do Render.

## Hardware

| Ambiente | Expectativa |
|----------|-------------|
| GPU CUDA | Clone/síntese em segundos |
| CPU | Funciona; frases curtas em poucos segundos após o modelo carregado |

## Licença do modelo

O backbone atual (**XTTS-v2**) usa a licença CPML da Coqui (não-comercial por padrão). Defina `COQUI_TOS_AGREED=1` para baixar. Para uso comercial em campanha, avalie licenciamento Coqui ou a troca do backbone do motor (`ai/voice_engine.py`) por um modelo com licença permissiva.

## Uso responsável

Clone apenas vozes com autorização expressa do titular e respeite a legislação eleitoral.

## Stack

- React + Vite  
- Express (gateway)  
- FastAPI + Coqui XTTS-v2 (motor AgencyVoice AI)
