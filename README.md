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

## Setup

```bash
# Node
npm run install:all

# Python + modelo (CPU; use GPU se disponível)
npm run setup:ai

cp .env.example .env
npm run dev
```

- App: http://localhost:5173  
- Gateway: http://localhost:3001  
- IA: http://localhost:8000/health  

Na primeira síntese o modelo XTTS (~2GB) é baixado automaticamente.

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
