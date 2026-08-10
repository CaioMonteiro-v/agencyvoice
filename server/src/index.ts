/**
 * AgencyVoice gateway
 * - VOICE_PROVIDER=auto|elevenlabs|local
 * - ElevenLabs via SDK oficial @elevenlabs/elevenlabs-js
 * - Local via AgencyVoice AI (XTTS)
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
import {
  cloneVoiceIvc,
  createElevenClient,
  deleteVoice as deleteElevenVoice,
  textToSpeechMp3,
  verifyApiKey,
} from "./elevenlabs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const uploadsDir = path.join(rootDir, "uploads");
const clientDist = path.join(rootDir, "client", "dist");
const AI_URL = (process.env.AI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 3001;
const ELEVEN_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const PROVIDER_CFG = (process.env.VOICE_PROVIDER || "auto").toLowerCase();

const looksLikeKeyId =
  Boolean(ELEVEN_KEY) &&
  !ELEVEN_KEY.startsWith("sk_") &&
  /^[a-f0-9]{40,80}$/i.test(ELEVEN_KEY);

/** Aceita sk_…; se for só hex (Key ID), marca como inválida. */
const hasEleven =
  ELEVEN_KEY.length > 20 &&
  ELEVEN_KEY !== "sua_chave_aqui" &&
  ELEVEN_KEY.startsWith("sk_") &&
  !looksLikeKeyId;

function resolveProvider(): "elevenlabs" | "local" {
  if (PROVIDER_CFG === "local") return "local";
  if (PROVIDER_CFG === "elevenlabs") {
    // Sem sk_ válida, não quebra o boot no Render — cai para local/offline amigável
    return hasEleven ? "elevenlabs" : "local";
  }
  return hasEleven ? "elevenlabs" : "local";
}

const eleven = hasEleven ? createElevenClient(ELEVEN_KEY) : null;

type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  demo: boolean;
  engine: string;
  provider: "elevenlabs" | "local";
};

const elevenStorePath = path.join(rootDir, "voices", "elevenlabs-registry.json");
const elevenVoices = new Map<string, VoiceRecord>();

function loadElevenRegistry() {
  try {
    if (!fs.existsSync(elevenStorePath)) return;
    const raw = JSON.parse(fs.readFileSync(elevenStorePath, "utf8")) as VoiceRecord[];
    for (const v of raw) elevenVoices.set(v.id, v);
  } catch {
    /* ignore */
  }
}

function saveElevenRegistry() {
  fs.mkdirSync(path.dirname(elevenStorePath), { recursive: true });
  fs.writeFileSync(
    elevenStorePath,
    JSON.stringify(Array.from(elevenVoices.values()), null, 2),
    "utf8"
  );
}

loadElevenRegistry();

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

async function aiFetch(pathname: string, init?: Parameters<typeof fetch>[1]) {
  return fetch(`${AI_URL}${pathname}`, init);
}

app.get("/api/health", async (_req, res) => {
  if (looksLikeKeyId) {
    return res.json({
      ok: true,
      mode: "live",
      provider: "local",
      engine: "agencyvoice-xtts-v2",
      message:
        "ELEVENLABS_API_KEY parece ser Key ID (hex). No Render → Environment, cole a secret sk_…. Usando fallback local.",
    });
  }

  if (PROVIDER_CFG === "elevenlabs" && !hasEleven) {
    // Boot saudável no Render mesmo sem chave — UI orienta a configurar
    return res.json({
      ok: true,
      mode: "booting",
      provider: "elevenlabs",
      engine: "elevenlabs-js",
      message:
        "Serviço no ar. Configure ELEVENLABS_API_KEY=sk_… nas Environment Variables do Render para ativar a clonagem.",
    });
  }

  const provider = resolveProvider();

  if (provider === "elevenlabs" && eleven) {
    try {
      await verifyApiKey(eleven);
      return res.json({
        ok: true,
        mode: "live",
        provider: "elevenlabs",
        engine: "elevenlabs-js · eleven_multilingual_v2",
        device: "cloud",
        message:
          "ElevenLabs SDK conectado — Instant Voice Cloning + TTS ativos.",
      });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        mode: "offline",
        provider: "elevenlabs",
        engine: "elevenlabs-js",
        message:
          err instanceof Error
            ? err.message
            : "Falha ao autenticar na ElevenLabs.",
      });
    }
  }

  try {
    const r = await aiFetch("/health");
    const data = await r.json();
    return res.status(r.status).json({
      ok: Boolean(data.ok),
      mode: data.ready ? "live" : "booting",
      provider: "local",
      engine: data.engine || "agencyvoice-xtts-v2",
      device: data.device,
      message: data.message || "AgencyVoice AI",
    });
  } catch {
    return res.status(503).json({
      ok: false,
      mode: "offline",
      provider: "local",
      engine: "agencyvoice-xtts-v2",
      message:
        "AgencyVoice AI offline — rode npm run dev:ai ou configure ELEVENLABS_API_KEY=sk_…",
    });
  }
});

app.get("/api/voices", async (_req, res) => {
  const voices: VoiceRecord[] = [];

  if (resolveProvider() === "elevenlabs" || PROVIDER_CFG === "auto") {
    voices.push(...Array.from(elevenVoices.values()));
  }

  if (resolveProvider() === "local" || PROVIDER_CFG === "auto") {
    try {
      const r = await aiFetch("/voices");
      if (r.ok) {
        const data = (await r.json()) as {
          voices: Array<Record<string, unknown>>;
        };
        for (const v of data.voices || []) {
          voices.push({
            id: String(v.id),
            name: String(v.name),
            description: v.description ? String(v.description) : undefined,
            sampleCount: Number(v.sample_count ?? v.sampleCount ?? 0),
            createdAt: String(v.created_at ?? v.createdAt ?? ""),
            demo: Boolean(v.demo),
            engine: String(v.engine || "agencyvoice-xtts-v2"),
            provider: "local",
          });
        }
      }
    } catch {
      /* local offline */
    }
  }

  voices.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return res.json({ voices, provider: resolveProvider() });
});

app.post("/api/voices/clone", upload.array("files", 10), async (req, res) => {
  const consent = String(req.body.consent || "") === "true";
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const files = (req.files as Express.Multer.File[]) || [];

  if (!consent) {
    return res.status(400).json({
      error: "É necessário confirmar autorização legal para clonar esta voz.",
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

  const provider = resolveProvider();

  try {
    if (provider === "elevenlabs") {
      if (!eleven) {
        return res.status(400).json({
          error:
            "ELEVENLABS_API_KEY inválida. Use a chave secreta que começa com sk_.",
        });
      }

      const result = await cloneVoiceIvc(eleven, {
        name,
        description,
        files: files.map((f) => ({
          buffer: f.buffer,
          filename: f.originalname || "sample.wav",
        })),
      });

      const voice: VoiceRecord = {
        id: result.voiceId,
        name,
        description: description || undefined,
        sampleCount: files.length,
        createdAt: new Date().toISOString(),
        demo: false,
        engine: "elevenlabs-ivc",
        provider: "elevenlabs",
      };
      elevenVoices.set(voice.id, voice);
      saveElevenRegistry();

      return res.json({
        voice,
        message:
          "Voz clonada com ElevenLabs SDK (voices.ivc.create / Instant Voice Cloning).",
      });
    }

    const form = new FormData();
    form.append("name", name);
    form.append("description", description);
    form.append("consent", "true");
    form.append("language", String(req.body.language || "pt"));
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
    const voice = data.voice as Record<string, unknown>;
    return res.json({
      voice: {
        id: voice.id,
        name: voice.name,
        description: voice.description,
        sampleCount: voice.sample_count ?? voice.sampleCount,
        createdAt: voice.created_at ?? voice.createdAt,
        demo: Boolean(voice.demo),
        engine: voice.engine || "agencyvoice-xtts-v2",
        provider: "local",
      },
      message: data.message,
    });
  } catch (err) {
    console.error(err);
    return res.status(503).json({
      error: err instanceof Error ? err.message : "Falha ao clonar voz.",
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const {
      voiceId,
      text,
      language = "pt",
      stability = 0.5,
      similarityBoost = 0.75,
    } = req.body as {
      voiceId?: string;
      text?: string;
      language?: string;
      stability?: number;
      similarityBoost?: number;
    };

    if (!voiceId || !text?.trim()) {
      return res
        .status(400)
        .json({ error: "Informe voiceId e o texto a ser falado." });
    }

    const elevenVoice = elevenVoices.get(voiceId);
    const useEleven =
      Boolean(eleven) &&
      (Boolean(elevenVoice) ||
        (resolveProvider() === "elevenlabs" && !voiceId.startsWith("av_")));

    if (useEleven && eleven) {
      // Igual ao exemplo do site:
      // elevenlabs.textToSpeech.convert(voiceId, { text, modelId, outputFormat })
      const buffer = await textToSpeechMp3(eleven, {
        voiceId,
        text: text.trim(),
        stability: Number(stability),
        similarityBoost: Number(similarityBoost),
      });
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buffer.length);
      return res.send(buffer);
    }

    const r = await aiFetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceId,
        text: text.trim(),
        language,
        temperature:
          typeof stability === "number" ? 0.35 + stability * 0.5 : 0.7,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      let detail: unknown = errText;
      try {
        detail = JSON.parse(errText);
      } catch {
        /* keep */
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
      error: err instanceof Error ? err.message : "Falha na síntese.",
    });
  }
});

app.delete("/api/voices/:id", async (req, res) => {
  const id = req.params.id;

  if (elevenVoices.has(id) && eleven) {
    try {
      await deleteElevenVoice(eleven, id);
    } catch (err) {
      console.warn("Falha ao remover na ElevenLabs:", err);
    }
    elevenVoices.delete(id);
    saveElevenRegistry();
    return res.json({ ok: true });
  }

  try {
    const r = await aiFetch(`/voices/${encodeURIComponent(id)}`, {
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
    return res.status(503).json({ error: "Provedor de voz offline." });
  }
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  const provider = resolveProvider();
  console.log(`AgencyVoice gateway em http://0.0.0.0:${PORT}`);
  console.log(`Provedor ativo: ${provider}`);
  if (provider === "local") console.log(`IA local: ${AI_URL}`);
  if (hasEleven) console.log("ElevenLabs SDK (@elevenlabs/elevenlabs-js) pronto");
  else if (looksLikeKeyId)
    console.log("Atenção: ELEVENLABS_API_KEY parece ser Key ID, não sk_…");
});
