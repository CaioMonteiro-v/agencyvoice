import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const uploadsDir = path.join(rootDir, "uploads");
const clientDist = path.join(rootDir, "client", "dist");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const hasApiKey =
  API_KEY.length > 10 && API_KEY !== "sua_chave_aqui";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(webm|wav|mp3|m4a|ogg|flac|mpeg)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error("Apenas arquivos de áudio são permitidos"));
      return;
    }
    cb(null, true);
  },
});

type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  demo: boolean;
  elevenLabsVoiceId?: string;
};

const voices = new Map<string, VoiceRecord>();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: hasApiKey ? "live" : "demo",
    message: hasApiKey
      ? "Conectado à ElevenLabs"
      : "Modo demonstração — configure ELEVENLABS_API_KEY no .env",
  });
});

app.get("/api/voices", (_req, res) => {
  res.json({ voices: Array.from(voices.values()).reverse() });
});

app.post("/api/voices/clone", upload.array("files", 10), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const consent = String(req.body.consent || "") === "true";
    const files = (req.files as Express.Multer.File[]) || [];

    if (!consent) {
      return res.status(400).json({
        error:
          "É necessário confirmar autorização legal para clonar esta voz.",
      });
    }
    if (!name) {
      return res.status(400).json({ error: "Informe o nome do candidato/voz." });
    }
    if (files.length === 0) {
      return res
        .status(400)
        .json({ error: "Envie pelo menos uma amostra de áudio." });
    }

    if (!hasApiKey) {
      const id = `demo_${Date.now()}`;
      const record: VoiceRecord = {
        id,
        name,
        description: description || undefined,
        sampleCount: files.length,
        createdAt: new Date().toISOString(),
        demo: true,
      };
      voices.set(id, record);
      for (const f of files) {
        try {
          fs.unlinkSync(f.path);
        } catch {
          /* ignore */
        }
      }
      return res.json({
        voice: record,
        message:
          "Clone criado em modo demonstração. Adicione ELEVENLABS_API_KEY para clonar de verdade.",
      });
    }

    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    form.append("remove_background_noise", "true");
    form.append(
      "labels",
      JSON.stringify({ language: "pt", use_case: "campaign" })
    );

    for (const f of files) {
      form.append("files", fs.createReadStream(f.path), {
        filename: f.originalname || path.basename(f.path),
        contentType: f.mimetype || "audio/mpeg",
      });
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        ...form.getHeaders(),
      },
      body: form as unknown as NodeJS.ReadableStream,
    });

    const raw = await response.text();
    let data: { voice_id?: string; detail?: unknown; message?: string } = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }

    for (const f of files) {
      try {
        fs.unlinkSync(f.path);
      } catch {
        /* ignore */
      }
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          (typeof data.detail === "string" && data.detail) ||
          data.message ||
          "Falha ao clonar voz na ElevenLabs.",
        detail: data.detail,
      });
    }

    const id = data.voice_id || `voice_${Date.now()}`;
    const record: VoiceRecord = {
      id,
      name,
      description: description || undefined,
      sampleCount: files.length,
      createdAt: new Date().toISOString(),
      demo: false,
      elevenLabsVoiceId: id,
    };
    voices.set(id, record);

    return res.json({
      voice: record,
      message: "Voz clonada com sucesso.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Erro interno ao clonar voz.",
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { voiceId, text, stability = 0.5, similarityBoost = 0.75 } = req.body as {
      voiceId?: string;
      text?: string;
      stability?: number;
      similarityBoost?: number;
    };

    if (!voiceId || !text?.trim()) {
      return res
        .status(400)
        .json({ error: "Informe voiceId e o texto a ser falado." });
    }

    const voice = voices.get(voiceId);
    if (!voice) {
      return res.status(404).json({ error: "Voz não encontrada neste servidor." });
    }

    if (voice.demo || !hasApiKey) {
      // Demo: return a tiny silent-ish wav placeholder message as JSON
      // Frontend will use Web Speech API as fallback for demo playback.
      return res.json({
        demo: true,
        text: text.trim(),
        voiceName: voice.name,
        message:
          "Modo demonstração: use a síntese do navegador ou configure a API key.",
      });
    }

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice.elevenLabsVoiceId || voice.id}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: Number(stability),
            similarity_boost: Number(similarityBoost),
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      return res.status(ttsRes.status).json({
        error: "Falha ao gerar áudio.",
        detail: errText,
      });
    }

    const buffer = Buffer.from(await ttsRes.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Erro interno no TTS.",
    });
  }
});

app.delete("/api/voices/:id", async (req, res) => {
  const voice = voices.get(req.params.id);
  if (!voice) {
    return res.status(404).json({ error: "Voz não encontrada." });
  }

  if (!voice.demo && hasApiKey) {
    try {
      await fetch(`https://api.elevenlabs.io/v1/voices/${voice.id}`, {
        method: "DELETE",
        headers: { "xi-api-key": API_KEY },
      });
    } catch (err) {
      console.warn("Falha ao remover voz na ElevenLabs:", err);
    }
  }

  voices.delete(req.params.id);
  return res.json({ ok: true });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`AgencyVoice API em http://localhost:${PORT}`);
  console.log(
    hasApiKey
      ? "Modo LIVE (ElevenLabs)"
      : "Modo DEMO — defina ELEVENLABS_API_KEY no .env"
  );
});
