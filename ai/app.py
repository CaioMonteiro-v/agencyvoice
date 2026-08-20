"""AgencyVoice AI API — FastAPI."""

from __future__ import annotations

import logging
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from voice_engine import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agencyvoice.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        engine.ensure_loaded()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Modelo ainda não carregado no startup: %s", exc)
    yield


app = FastAPI(
    title="AgencyVoice AI",
    description="IA própria de clonagem de voz para campanhas",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    voice_id: str = Field(..., alias="voiceId")
    text: str
    language: str = "pt"
    temperature: float = 0.7

    model_config = {"populate_by_name": True}


@app.get("/health")
def health() -> dict:
    return {"ok": True, **engine.status}


@app.get("/voices")
def list_voices() -> dict:
    return {"voices": [v.to_public() for v in engine.list_voices()]}


@app.post("/voices/clone")
async def clone_voice(
    name: Annotated[str, Form()],
    consent: Annotated[str, Form()] = "false",
    description: Annotated[str, Form()] = "",
    language: Annotated[str, Form()] = "pt",
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> dict:
    if consent.lower() != "true":
        raise HTTPException(
            status_code=400,
            detail="É necessário confirmar autorização legal para clonar esta voz.",
        )
    if not name.strip():
        raise HTTPException(status_code=400, detail="Informe o nome do candidato/voz.")
    uploads = files or []
    if not uploads:
        raise HTTPException(status_code=400, detail="Envie pelo menos uma amostra de áudio.")

    tmpdir = Path(tempfile.mkdtemp(prefix="av_clone_"))
    try:
        saved: list[Path] = []
        for i, upload in enumerate(uploads):
            suffix = Path(upload.filename or f"sample_{i}.wav").suffix or ".wav"
            dest = tmpdir / f"sample_{i}{suffix}"
            with dest.open("wb") as fh:
                shutil.copyfileobj(upload.file, fh)
            saved.append(dest)

        profile = engine.clone_voice(
            name=name,
            description=description,
            sample_paths=saved,
            language=language or "pt",
        )
        return {
            "voice": profile.to_public(),
            "message": "Perfil vocal criado na AgencyVoice AI. Pronto para síntese.",
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("clone failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/tts")
def tts(body: TTSRequest) -> FileResponse:
    try:
        path = engine.synthesize(
            voice_id=body.voice_id,
            text=body.text,
            language=body.language,
            temperature=body.temperature,
        )
        return FileResponse(
            path,
            media_type="audio/wav",
            filename=path.name,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("tts failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/voices/{voice_id}/samples")
async def add_voice_samples(
    voice_id: str,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> dict:
    """Adiciona áudios ao perfil para ir treinando / melhorando o clone."""
    uploads = files or []
    if not uploads:
        raise HTTPException(status_code=400, detail="Envie pelo menos uma amostra.")

    if not engine.get_voice(voice_id):
        raise HTTPException(status_code=404, detail="Perfil de voz não encontrado.")

    tmpdir = Path(tempfile.mkdtemp(prefix="av_train_"))
    try:
        saved: list[Path] = []
        for i, upload in enumerate(uploads):
            suffix = Path(upload.filename or f"sample_{i}.wav").suffix or ".wav"
            dest = tmpdir / f"sample_{i}{suffix}"
            with dest.open("wb") as fh:
                shutil.copyfileobj(upload.file, fh)
            saved.append(dest)

        profile = engine.add_samples(voice_id=voice_id, sample_paths=saved)
        return {
            "voice": profile.to_public(),
            "message": f"Perfil atualizado com {len(saved)} nova(s) amostra(s).",
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("add samples failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str) -> dict:
    ok = engine.delete_voice(voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Voz não encontrada.")
    return {"ok": True}
