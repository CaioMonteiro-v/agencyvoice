/**
 * AgencyVoice gateway
 * - Biblioteca de perfis (ex.: Fábio) com amostras + retreino
 * - VOICE_PROVIDER=auto|elevenlabs|local
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
  addSamplesToVoice,
  cloneVoiceIvc,
  createElevenClient,
  deleteVoice as deleteElevenVoice,
  listElevenVoices,
  textToSpeechMp3,
  verifyApiKey,
} from "./elevenlabs.js";
import { createStore, type VoiceRecord } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const uploadsDir = path.join(rootDir, "uploads");
const clientDist = path.join(rootDir, "client", "dist");
const AI_URL = (process.env.AI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 3001;
const ELEVEN_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const PROVIDER_CFG = (process.env.VOICE_PROVIDER || "auto").toLowerCase();

const store = createStore(rootDir);

const looksLikeKeyId =
  Boolean(ELEVEN_KEY) &&
  !ELEVEN_KEY.startsWith("sk_") &&
  /^[a-f0-9]{40,80}$/i.test(ELEVEN_KEY);

const hasEleven =
  ELEVEN_KEY.length > 20 &&
  ELEVEN_KEY !== "sua_chave_aqui" &&
  ELEVEN_KEY.startsWith("sk_") &&
  !looksLikeKeyId;

function resolveProvider(): "elevenlabs" | "local" {
  if (PROVIDER_CFG === "local") return "local";
  if (PROVIDER_CFG === "elevenlabs") {
    return hasEleven ? "elevenlabs" : "local";
  }
  return hasEleven ? "elevenlabs" : "local";
}

const eleven = hasEleven ? createElevenClient(ELEVEN_KEY) : null;

function migrateLegacyRegistry() {
  const legacy = path.join(rootDir, "voices", "elevenlabs-registry.json");
  try {
    if (!fs.existsSync(legacy)) return;
    const raw = JSON.parse(fs.readFileSync(legacy, "utf8")) as VoiceRecord[];
    for (const v of raw) store.upsertVoice(v);
  } catch {
    /* ignore */
  }
}

migrateLegacyRegistry();

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
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

function saveUploadedSamples(
  voiceId: string,
  files: Express.Multer.File[],
  source: "record" | "upload" | "clone" = "clone"
) {
  return files.map((f) =>
    store.addSample({
      voiceId,
      buffer: f.buffer,
      originalName: f.originalname || "sample.webm",
      mimeType: f.mimetype || "audio/webm",
      source,
    })
  );
}

async function syncElevenVoicesIntoStore() {
  if (!eleven) return store.listVoices().filter((v) => v.provider === "elevenlabs");
  try {
    const remote = await listElevenVoices(eleven);
    const mapped: VoiceRecord[] = (remote || [])
      .map((v) => {
        const id = String(v.voiceId || (v as { voice_id?: string }).voice_id || "");
        const samples =
          (v as { samples?: unknown[] }).samples?.length ??
          Number((v as { sampleCount?: number }).sampleCount ?? 0);
        return {
          id,
          name: String(v.name || "Voz ElevenLabs"),
          description: v.description ? String(v.description) : undefined,
          sampleCount: Math.max(samples, store.listSamples(id).length),
          createdAt: String(
            (v as { createdAtUnix?: number }).createdAtUnix
              ? new Date(
                  Number((v as { createdAtUnix?: number }).createdAtUnix) * 1000
                ).toISOString()
              : new Date().toISOString()
          ),
          demo: Boolean((v as { isOwner?: boolean }).isOwner === false),
          engine: "elevenlabs",
          provider: "elevenlabs" as const,
        };
      })
      .filter((v) => v.id);
    return store.mergeRemoteVoices(mapped);
  } catch (err) {
    console.warn("Falha ao sincronizar vozes ElevenLabs:", err);
    return store.listVoices();
  }
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
          "ElevenLabs conectado — clone, alimente amostras e gere na Biblioteca.",
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
  const seen = new Set<string>();

  if (resolveProvider() === "elevenlabs" || PROVIDER_CFG === "auto") {
    const synced = await syncElevenVoicesIntoStore();
    for (const v of synced) {
      if (!seen.has(v.id)) {
        voices.push({
          ...v,
          sampleCount: Math.max(v.sampleCount, store.listSamples(v.id).length),
        });
        seen.add(v.id);
      }
    }
  }

  for (const v of store.listVoices()) {
    if (seen.has(v.id)) continue;
    voices.push({
      ...v,
      sampleCount: Math.max(v.sampleCount, store.listSamples(v.id).length),
    });
    seen.add(v.id);
  }

  if (resolveProvider() === "local" || PROVIDER_CFG === "auto") {
    try {
      const r = await aiFetch("/voices");
      if (r.ok) {
        const data = (await r.json()) as {
          voices: Array<Record<string, unknown>>;
        };
        for (const v of data.voices || []) {
          const id = String(v.id);
          if (seen.has(id)) continue;
          const voice: VoiceRecord = {
            id,
            name: String(v.name),
            description: v.description ? String(v.description) : undefined,
            sampleCount: Math.max(
              Number(v.sample_count ?? v.sampleCount ?? 0),
              store.listSamples(id).length
            ),
            createdAt: String(v.created_at ?? v.createdAt ?? ""),
            demo: Boolean(v.demo),
            engine: String(v.engine || "agencyvoice-xtts-v2"),
            provider: "local",
          };
          store.upsertVoice(voice);
          voices.push(voice);
          seen.add(id);
        }
      }
    } catch {
      /* local offline */
    }
  }

  voices.sort((a, b) =>
    (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1
  );
  return res.json({ voices, provider: resolveProvider() });
});

app.get("/api/voices/:id", (req, res) => {
  const voice = store.getVoice(req.params.id);
  if (!voice) {
    return res.status(404).json({ error: "Perfil de voz não encontrado." });
  }
  const samples = store.listSamples(voice.id);
  const creations = store.listCreations(voice.id);
  return res.json({
    voice: { ...voice, sampleCount: Math.max(voice.sampleCount, samples.length) },
    samples,
    creations,
  });
});

app.post("/api/voices/clone", upload.array("files", 20), async (req, res) => {
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

      const now = new Date().toISOString();
      const voice: VoiceRecord = {
        id: result.voiceId,
        name,
        description: description || undefined,
        sampleCount: files.length,
        createdAt: now,
        updatedAt: now,
        lastTrainedAt: now,
        demo: false,
        engine: "elevenlabs-ivc",
        provider: "elevenlabs",
      };
      store.upsertVoice(voice);
      saveUploadedSamples(voice.id, files, "clone");

      return res.json({
        voice,
        samples: store.listSamples(voice.id),
        message: `Perfil “${name}” criado. Abra na Biblioteca para ir adicionando áudios e treinando.`,
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
    const rawVoice = data.voice as Record<string, unknown>;
    const now = new Date().toISOString();
    const voice: VoiceRecord = {
      id: String(rawVoice.id),
      name: String(rawVoice.name),
      description: rawVoice.description
        ? String(rawVoice.description)
        : undefined,
      sampleCount: Number(
        rawVoice.sample_count ?? rawVoice.sampleCount ?? files.length
      ),
      createdAt: String(rawVoice.created_at ?? rawVoice.createdAt ?? now),
      updatedAt: now,
      lastTrainedAt: now,
      demo: Boolean(rawVoice.demo),
      engine: String(rawVoice.engine || "agencyvoice-xtts-v2"),
      provider: "local",
    };
    store.upsertVoice(voice);
    saveUploadedSamples(voice.id, files, "clone");
    return res.json({
      voice,
      samples: store.listSamples(voice.id),
      message: data.message || `Perfil “${name}” criado na Biblioteca.`,
    });
  } catch (err) {
    console.error(err);
    return res.status(503).json({
      error: err instanceof Error ? err.message : "Falha ao clonar voz.",
    });
  }
});

/** Alimenta o perfil com mais áudios e atualiza o clone (treinar). */
app.post(
  "/api/voices/:id/samples",
  upload.array("files", 20),
  async (req, res) => {
    const voice = store.getVoice(req.params.id);
    if (!voice) {
      return res.status(404).json({ error: "Perfil de voz não encontrado." });
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      return res
        .status(400)
        .json({ error: "Envie pelo menos um áudio para treinar." });
    }

    const source =
      String(req.body.source || "") === "record" ? "record" : "upload";

    try {
      const saved = saveUploadedSamples(voice.id, files, source);

      if (voice.provider === "elevenlabs" && eleven) {
        await addSamplesToVoice(eleven, {
          voiceId: voice.id,
          name: voice.name,
          description: voice.description,
          files: files.map((f) => ({
            buffer: f.buffer,
            filename: f.originalname || "sample.wav",
          })),
        });
      } else if (voice.provider === "local" || voice.id.startsWith("av_")) {
        const form = new FormData();
        for (const f of files) {
          form.append("files", f.buffer, {
            filename: f.originalname || "sample.wav",
            contentType: f.mimetype || "audio/wav",
          });
        }
        const r = await aiFetch(`/voices/${encodeURIComponent(voice.id)}/samples`, {
          method: "POST",
          headers: form.getHeaders(),
          body: form as unknown as NodeJS.ReadableStream,
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
            error: "Falha ao atualizar o perfil local com novas amostras.",
            detail,
          });
        }
      } else if (eleven) {
        // voz remota sem provider marcado — tenta ElevenLabs
        await addSamplesToVoice(eleven, {
          voiceId: voice.id,
          name: voice.name,
          description: voice.description,
          files: files.map((f) => ({
            buffer: f.buffer,
            filename: f.originalname || "sample.wav",
          })),
        });
      }

      const updated = store.markTrained(voice.id);
      return res.json({
        voice: updated || store.getVoice(voice.id),
        samples: store.listSamples(voice.id),
        added: saved,
        message: `${saved.length} áudio(s) adicionados. A voz de ${voice.name} foi atualizada — continue alimentando para ficar melhor.`,
      });
    } catch (err) {
      console.error(err);
      return res.status(503).json({
        error:
          err instanceof Error
            ? err.message
            : "Falha ao treinar com novas amostras.",
      });
    }
  }
);

app.get("/api/voices/:id/samples", (req, res) => {
  const voice = store.getVoice(req.params.id);
  if (!voice) {
    return res.status(404).json({ error: "Perfil de voz não encontrado." });
  }
  return res.json({ samples: store.listSamples(voice.id) });
});

app.get("/api/voices/:id/samples/:sampleId/audio", (req, res) => {
  const sample = store.getSample(req.params.id, req.params.sampleId);
  if (!sample) {
    return res.status(404).json({ error: "Amostra não encontrada." });
  }
  const file = store.sampleFilePath(sample);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Arquivo de áudio ausente." });
  }
  res.setHeader("Content-Type", sample.mimeType);
  return res.sendFile(file);
});

app.delete("/api/voices/:id/samples/:sampleId", (req, res) => {
  const voice = store.getVoice(req.params.id);
  if (!voice) {
    return res.status(404).json({ error: "Perfil de voz não encontrado." });
  }
  store.deleteSample(voice.id, req.params.sampleId);
  return res.json({
    ok: true,
    samples: store.listSamples(voice.id),
    voice: store.getVoice(voice.id),
  });
});

app.post("/api/tts", async (req, res) => {
  try {
    const {
      voiceId,
      text,
      language = "pt",
      stability = 0.5,
      similarityBoost = 0.75,
      title,
      save = true,
    } = req.body as {
      voiceId?: string;
      text?: string;
      language?: string;
      stability?: number;
      similarityBoost?: number;
      title?: string;
      save?: boolean;
    };

    if (!voiceId || !text?.trim()) {
      return res
        .status(400)
        .json({ error: "Informe voiceId e o texto a ser falado." });
    }

    const originalText = text.trim();
    const spokenText = store.applyPronunciations(originalText, voiceId);
    const storedVoice = store.getVoice(voiceId);

    const useEleven =
      Boolean(eleven) &&
      (storedVoice?.provider === "elevenlabs" ||
        (resolveProvider() === "elevenlabs" && !voiceId.startsWith("av_")));

    let buffer: Buffer;
    let mimeType: string;
    let providerLabel: string;

    if (useEleven && eleven) {
      buffer = await textToSpeechMp3(eleven, {
        voiceId,
        text: spokenText,
        stability: Number(stability),
        similarityBoost: Number(similarityBoost),
      });
      mimeType = "audio/mpeg";
      providerLabel = "elevenlabs";
    } else {
      const r = await aiFetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId,
          text: spokenText,
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

      buffer = Buffer.from(await r.arrayBuffer());
      mimeType = "audio/wav";
      providerLabel = "local";
    }

    let creationId: string | undefined;
    if (save !== false) {
      const creation = store.saveCreation({
        title: (title || "").trim() || originalText.slice(0, 48),
        voiceId,
        voiceName: storedVoice?.name || "Voz",
        text: originalText,
        textSpoken: spokenText,
        buffer,
        mimeType,
        provider: providerLabel,
      });
      creationId = creation.id;
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    if (creationId) res.setHeader("X-Creation-Id", creationId);
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
  const stored = store.getVoice(id);

  if ((stored?.provider === "elevenlabs" || !id.startsWith("av_")) && eleven) {
    try {
      await deleteElevenVoice(eleven, id);
    } catch (err) {
      console.warn("Falha ao remover na ElevenLabs:", err);
    }
    store.deleteVoice(id);
    return res.json({ ok: true });
  }

  try {
    const r = await aiFetch(`/voices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && !stored) {
      return res.status(r.status).json({
        error: (data as { detail?: string }).detail || "Falha ao remover voz.",
      });
    }
    store.deleteVoice(id);
    return res.json({ ok: true });
  } catch {
    if (stored) {
      store.deleteVoice(id);
      return res.json({ ok: true });
    }
    return res.status(503).json({ error: "Provedor de voz offline." });
  }
});

app.get("/api/creations", (req, res) => {
  const voiceId = req.query.voiceId ? String(req.query.voiceId) : undefined;
  return res.json({ creations: store.listCreations(voiceId) });
});

app.get("/api/creations/:id/audio", (req, res) => {
  const creation = store.getCreation(req.params.id);
  if (!creation) {
    return res.status(404).json({ error: "Criação não encontrada." });
  }
  const file = path.join(store.creationsAudioDir, creation.filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Áudio da criação não encontrado." });
  }
  res.setHeader("Content-Type", creation.mimeType);
  return res.sendFile(file);
});

app.delete("/api/creations/:id", (req, res) => {
  const creation = store.getCreation(req.params.id);
  if (!creation) {
    return res.status(404).json({ error: "Criação não encontrada." });
  }
  store.deleteCreation(req.params.id);
  return res.json({ ok: true });
});

app.get("/api/pronunciations", (req, res) => {
  const voiceId =
    req.query.voiceId !== undefined ? String(req.query.voiceId) : undefined;
  return res.json({
    pronunciations: store.listPronunciations(
      voiceId === "" ? null : voiceId
    ),
  });
});

app.post("/api/pronunciations", (req, res) => {
  try {
    const { word, alias, note, voiceId } = req.body as {
      word?: string;
      alias?: string;
      note?: string;
      voiceId?: string;
    };
    const rule = store.upsertPronunciation(
      String(word || ""),
      String(alias || ""),
      note ? String(note) : undefined,
      voiceId ? String(voiceId) : undefined
    );
    return res.json({ pronunciation: rule });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Dados inválidos.",
    });
  }
});

app.delete("/api/pronunciations/:id", (req, res) => {
  store.deletePronunciation(req.params.id);
  return res.json({ ok: true });
});

app.post("/api/pronunciations/preview", (req, res) => {
  const body = req.body as { text?: string; voiceId?: string };
  const text = String(body.text || "");
  return res.json({
    original: text,
    spoken: store.applyPronunciations(text, body.voiceId),
  });
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
  if (hasEleven) console.log("ElevenLabs SDK pronto");
  else if (looksLikeKeyId)
    console.log("Atenção: ELEVENLABS_API_KEY parece ser Key ID, não sk_…");
});
