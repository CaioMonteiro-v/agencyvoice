# AgencyVoice

Clonagem de voz para campanhas — capture o áudio do candidato, treine um clone com IA e gere spots a partir de texto.

Inspirado no fluxo da [ElevenLabs Voice Cloning](https://elevenlabs.io/voice-cloning): gravação/upload → clone instantâneo → texto para fala.

## O que faz

1. **Captura** — grava pelo microfone ou envia arquivos de áudio
2. **Clona** — cria um modelo vocal via Instant Voice Cloning (ElevenLabs)
3. **Gera** — transforma roteiros em áudio com a voz do candidato

Sem chave de API, o app roda em **modo demonstração** (clone simulado + síntese do navegador).

## Requisitos

- Node.js 20+
- Conta e API key da [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) (para clonagem real)

## Setup

```bash
cp .env.example .env
# Edite .env e cole sua ELEVENLABS_API_KEY

npm run install:all
npm run dev
```

- App: http://localhost:5173  
- API: http://localhost:3001  

## Produção

```bash
npm run build
# Defina ELEVENLABS_API_KEY e PORT
npm start
```

O servidor Express serve o frontend buildado e a API.

## Uso responsável

Clone **apenas** vozes com autorização expressa do titular. Em campanhas, respeite a legislação eleitoral e os termos da ElevenLabs (Voice Captcha / verificação quando exigidos).

## Stack

- React + Vite (frontend)
- Express + Multer (backend)
- ElevenLabs API (`/v1/voices/add`, `/v1/text-to-speech`)
