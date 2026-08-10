/**
 * AgencyVoice gateway — sobe o frontend e encaminha /api para a IA Python.
 * A clonagem e a síntese rodam no motor AgencyVoice (XTTS), não em API externa.
 */
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
const AI_URL = (process.env.AI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 3001;

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
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

async function aiFetch(pathname: string, init?: fetch.RequestInit) {
  return fetch(`${AI_URL}${pathname}`, init);
}

app.get("/api/health", async (_req, res) => {
  try {
    const r = await aiFetch("/health");
    const data = await r.json();
    res.status(r.status).json({
      ok: Boolean(data.ok),
      mode: data.ready ? "live" : "booting",
      engine: data.engine || "agencyvoice-xtts-v2",
      device: data.device,
      message: data.message || "AgencyVoice AI",
    });
  } catch {
    res.status(503).json({
      ok: false,
      mode: "offline",
      engine: "agencyvoice-xtts-v2",
      message:
        "AgencyVoice AI offline — inicie o motor Python (`npm run dev:ai`).",
    });
  }
});

app.get("/api/voices", async (_req, res) => {
  try {
    const r = await aiFetch("/voices");
    const data = await r.json();
    res.status(r.status).json(data);
  } catch {
    res.status(503).json({ error: "IA offline", voices: [] });
  }
});

app.post("/api/voices/clone", upload.array("files", 10), async (req, res) => {
  try {
    const form = new FormData();
    form.append("name", String(req.body.name || ""));
    form.append("description", String(req.body.description || ""));
    form.append("consent", String(req.body.consent || "false"));
    form.append("language", String(req.body.language || "pt"));

    const files = (req.files as Express.Multer.File[]) || [];
    for (const f of files) {
      form.append("files", f.buffer, {
        filename: f.originalname || "sample.wav",
        contentType: f.mimetype || "audio/wav",
      });
    }

    const r = await aiFetch("/voices/clone", {
      method: "POST",
      headers: form.getHeaders(),
      body: form as unknown as NodeJS.ReadableStream,
    });

    const raw = await r.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { detail: raw };
    }

    if (!r.ok) {
      return res.status(r.status).json({
        error:
          (typeof data.detail === "string" && data.detail) ||
          (data.error as string) ||
          "Falha ao clonar voz.",
        detail: data.detail,
      });
    }

    // Normaliza shape para o frontend
    const voice = data.voice as Record<string, unknown>;
    return res.json({
      voice: {
        id: voice.id,
        name: voice.name,
        description: voice.description,
        sampleCount: voice.sample_count ?? voice.sampleCount,
        createdAt: voice.created_at ?? voice.createdAt,
        demo: Boolean(voice.demo),
        engine: voice.engine,
      },
      message: data.message,
    });
  } catch (err) {
    console.error(err);
    return res.status(503).json({
      error:
        err instanceof Error
          ? err.message
          : "AgencyVoice AI indisponível para clonagem.",
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { voiceId, text, language = "pt", stability } = req.body as {
      voiceId?: string;
      text?: string;
      language?: string;
      stability?: number;
    };

    if (!voiceId || !text?.trim()) {
      return res
        .status(400)
        .json({ error: "Informe voiceId e o texto a ser falado." });
    }

    const r = await aiFetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceId,
        text: text.trim(),
        language,
        temperature: typeof stability === "number" ? 0.35 + stability * 0.5 : 0.7,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      let detail: unknown = errText;
      try {
        detail = JSON.parse(errText);
      } catch {
        /* keep text */
      }
      return res.status(r.status).json({
        error: "Falha ao gerar áudio na AgencyVoice AI.",
        detail,
      });
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(503).json({
      error:
        err instanceof Error
          ? err.message
          : "AgencyVoice AI indisponível para síntese.",
    });
  }
});

app.delete("/api/voices/:id", async (req, res) => {
  try {
    const r = await aiFetch(`/voices/${encodeURIComponent(req.params.id)}`, {
      method: "DELETE",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: (data as { detail?: string }).detail || "Falha ao remover voz.",
      });
    }
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: "AgencyVoice AI offline." });
  }
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`AgencyVoice gateway em http://localhost:${PORT}`);
  console.log(`IA alvo: ${AI_URL}`);
});
