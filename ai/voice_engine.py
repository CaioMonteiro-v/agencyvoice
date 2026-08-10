"""
AgencyVoice AI — motor próprio de clonagem de voz.

Pipeline:
  1. Ingestão e limpeza das amostras do candidato
  2. Criação de perfil vocal (referências + metadados)
  3. Síntese zero-shot com XTTS-v2 (português nativo)

A ElevenLabs foi só referência de produto; a inferência roda aqui.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("agencyvoice.ai")

# Aceite não-interativo da licença CPML do XTTS (não-comercial por padrão).
# Para uso comercial, obtenha licença ou troque o backbone do motor.
os.environ.setdefault("COQUI_TOS_AGREED", "1")

ROOT = Path(__file__).resolve().parents[1]
VOICES_DIR = Path(os.environ.get("AGENCYVOICE_VOICES_DIR", ROOT / "voices"))
MODELS_DIR = Path(os.environ.get("AGENCYVOICE_MODELS_DIR", Path(__file__).parent / "models"))
OUTPUT_DIR = Path(os.environ.get("AGENCYVOICE_OUTPUT_DIR", ROOT / "uploads" / "generated"))


@dataclass
class VoiceProfile:
    id: str
    name: str
    description: str
    sample_count: int
    created_at: str
    language: str = "pt"
    status: str = "ready"  # ready | loading | error
    engine: str = "agencyvoice-xtts-v2"
    demo: bool = False

    def to_public(self) -> dict[str, Any]:
        return asdict(self)


def _patch_xtts_audio_loader() -> None:
    """Evita torchcodec/torchaudio.load quebrado em CPU sem libnvrtc."""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    import TTS.tts.models.xtts as xtts_mod

    def load_audio(audiopath, sampling_rate):  # type: ignore[no-untyped-def]
        data, lsr = sf.read(audiopath, dtype="float32", always_2d=False)
        if isinstance(data, np.ndarray) and data.ndim > 1:
            data = data.mean(axis=-1)
        audio = torch.as_tensor(data, dtype=torch.float32).unsqueeze(0)
        if audio.abs().max() > 1.1:
            audio = audio / 32768.0
        if lsr != sampling_rate:
            audio = torchaudio.functional.resample(audio, lsr, sampling_rate)
        audio = torch.clamp(audio, -1.0, 1.0)
        return audio

    xtts_mod.load_audio = load_audio


class VoiceEngine:
    """Clonagem e síntese locais com XTTS-v2."""

    def __init__(self) -> None:
        VOICES_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        self._tts = None
        self._load_error: str | None = None
        self._device = "cpu"
        self._ready = False

        try:
            import torch

            if torch.cuda.is_available():
                self._device = "cuda"
        except Exception:
            self._device = "cpu"

    @property
    def status(self) -> dict[str, Any]:
        return {
            "ready": self._ready,
            "device": self._device,
            "engine": "agencyvoice-xtts-v2",
            "language": "pt",
            "load_error": self._load_error,
            "mode": "live" if self._ready else "booting",
            "message": (
                f"AgencyVoice AI pronta ({self._device})"
                if self._ready
                else (
                    f"Carregando modelo XTTS… ({self._load_error})"
                    if self._load_error
                    else "Inicializando AgencyVoice AI…"
                )
            ),
        }

    def ensure_loaded(self) -> None:
        if self._ready:
            return
        if self._load_error and "unavailable" in (self._load_error or ""):
            raise RuntimeError(self._load_error)

        try:
            from TTS.api import TTS

            _patch_xtts_audio_loader()

            model_name = "tts_models/multilingual/multi-dataset/xtts_v2"
            logger.info("Carregando %s em %s…", model_name, self._device)
            self._tts = TTS(model_name, progress_bar=False)
            if self._device == "cuda":
                self._tts.to("cuda")
            self._ready = True
            self._load_error = None
            logger.info("Modelo carregado.")
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            logger.exception("Falha ao carregar XTTS")
            raise RuntimeError(
                "Não foi possível carregar o modelo AgencyVoice AI (XTTS-v2). "
                f"Detalhe: {exc}"
            ) from exc

    def _profile_dir(self, voice_id: str) -> Path:
        return VOICES_DIR / voice_id

    def _meta_path(self, voice_id: str) -> Path:
        return self._profile_dir(voice_id) / "profile.json"

    def _refs_dir(self, voice_id: str) -> Path:
        return self._profile_dir(voice_id) / "refs"

    def list_voices(self) -> list[VoiceProfile]:
        voices: list[VoiceProfile] = []
        if not VOICES_DIR.exists():
            return voices
        for path in sorted(VOICES_DIR.iterdir(), reverse=True):
            meta = path / "profile.json"
            if not meta.exists():
                continue
            data = json.loads(meta.read_text(encoding="utf-8"))
            voices.append(VoiceProfile(**data))
        return voices

    def get_voice(self, voice_id: str) -> VoiceProfile | None:
        meta = self._meta_path(voice_id)
        if not meta.exists():
            return None
        return VoiceProfile(**json.loads(meta.read_text(encoding="utf-8")))

    def _convert_to_wav(self, src: Path, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() == ".wav":
            shutil.copy2(src, dest)
            return
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "22050",
            "-sample_fmt",
            "s16",
            str(dest),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not dest.exists():
            raise RuntimeError(
                f"Falha ao converter áudio {src.name}: {result.stderr[-400:]}"
            )

    def clone_voice(
        self,
        *,
        name: str,
        description: str,
        sample_paths: list[Path],
        language: str = "pt",
    ) -> VoiceProfile:
        if not sample_paths:
            raise ValueError("Envie pelo menos uma amostra de áudio.")

        voice_id = f"av_{uuid.uuid4().hex[:12]}"
        refs = self._refs_dir(voice_id)
        refs.mkdir(parents=True, exist_ok=True)

        saved = 0
        for i, src in enumerate(sample_paths):
            dest = refs / f"ref_{i:02d}.wav"
            self._convert_to_wav(Path(src), dest)
            saved += 1

        profile = VoiceProfile(
            id=voice_id,
            name=name.strip(),
            description=(description or "").strip(),
            sample_count=saved,
            created_at=datetime.now(timezone.utc).isoformat(),
            language=language,
            status="ready",
            engine="agencyvoice-xtts-v2",
            demo=False,
        )
        self._meta_path(voice_id).write_text(
            json.dumps(asdict(profile), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return profile

    def reference_wavs(self, voice_id: str) -> list[str]:
        refs = self._refs_dir(voice_id)
        if not refs.exists():
            return []
        files = sorted(refs.glob("*.wav"))
        return [str(p) for p in files]

    def add_samples(
        self,
        *,
        voice_id: str,
        sample_paths: list[Path],
    ) -> VoiceProfile:
        """Alimenta o perfil com mais áudios — XTTS usa todas as refs na síntese."""
        profile = self.get_voice(voice_id)
        if not profile:
            raise FileNotFoundError("Perfil de voz não encontrado.")
        if not sample_paths:
            raise ValueError("Envie pelo menos uma amostra de áudio.")

        refs = self._refs_dir(voice_id)
        refs.mkdir(parents=True, exist_ok=True)
        existing = len(list(refs.glob("*.wav")))

        for i, src in enumerate(sample_paths):
            dest = refs / f"ref_{existing + i:02d}.wav"
            self._convert_to_wav(Path(src), dest)

        profile.sample_count = len(list(refs.glob("*.wav")))
        profile.status = "ready"
        self._meta_path(voice_id).write_text(
            json.dumps(asdict(profile), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return profile

    def synthesize(
        self,
        *,
        voice_id: str,
        text: str,
        language: str | None = None,
        temperature: float = 0.7,
    ) -> Path:
        profile = self.get_voice(voice_id)
        if not profile:
            raise FileNotFoundError("Perfil de voz não encontrado.")

        refs = self.reference_wavs(voice_id)
        if not refs:
            raise FileNotFoundError("Amostras de referência ausentes no perfil.")

        clean = (text or "").strip()
        if not clean:
            raise ValueError("Texto vazio.")

        self.ensure_loaded()
        assert self._tts is not None

        out = OUTPUT_DIR / f"{voice_id}_{uuid.uuid4().hex[:8]}.wav"
        lang = language or profile.language or "pt"

        # XTTS aceita um path ou lista; múltiplas refs melhoram o clone
        speaker_wav: str | list[str] = refs if len(refs) > 1 else refs[0]

        self._tts.tts_to_file(
            text=clean,
            file_path=str(out),
            speaker_wav=speaker_wav,
            language=lang,
            split_sentences=True,
        )

        if not out.exists():
            raise RuntimeError("Síntese concluiu sem gerar arquivo de áudio.")
        return out

    def delete_voice(self, voice_id: str) -> bool:
        path = self._profile_dir(voice_id)
        if not path.exists():
            return False
        shutil.rmtree(path)
        return True


engine = VoiceEngine()
