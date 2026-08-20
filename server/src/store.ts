import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  updatedAt?: string;
  lastTrainedAt?: string;
  demo: boolean;
  engine: string;
  provider: "elevenlabs" | "local";
};

export type VoiceSampleRecord = {
  id: string;
  voiceId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  source: "record" | "upload" | "clone";
  size: number;
  createdAt: string;
};

export type CreationRecord = {
  id: string;
  title: string;
  voiceId: string;
  voiceName: string;
  text: string;
  textSpoken: string;
  filename: string;
  mimeType: string;
  createdAt: string;
  provider: string;
};

export type PronunciationRule = {
  id: string;
  word: string;
  alias: string;
  note?: string;
  /** Se definido, vale só para essa voz; senão, global. */
  voiceId?: string;
  createdAt: string;
};

export function createStore(rootDir: string) {
  const dataDir = path.join(rootDir, "data");
  const creationsAudioDir = path.join(rootDir, "uploads", "creations");
  const voicesAudioDir = path.join(rootDir, "uploads", "voices");
  const voicesPath = path.join(dataDir, "voices.json");
  const samplesPath = path.join(dataDir, "samples.json");
  const creationsPath = path.join(dataDir, "creations.json");
  const pronunciationsPath = path.join(dataDir, "pronunciations.json");

  for (const dir of [dataDir, creationsAudioDir, voicesAudioDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function readJson<T>(file: string, fallback: T): T {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  function writeJson(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  }

  function voiceSamplesDir(voiceId: string) {
    const dir = path.join(voicesAudioDir, voiceId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function syncSampleCount(voiceId: string) {
    const count = readJson<VoiceSampleRecord[]>(samplesPath, []).filter(
      (s) => s.voiceId === voiceId
    ).length;
    const all = readJson<VoiceRecord[]>(voicesPath, []);
    const idx = all.findIndex((v) => v.id === voiceId);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        sampleCount: count,
        updatedAt: new Date().toISOString(),
      };
      writeJson(voicesPath, all);
    }
    return count;
  }

  return {
    creationsAudioDir,
    voicesAudioDir,
    voiceSamplesDir,

    listVoices(): VoiceRecord[] {
      return readJson<VoiceRecord[]>(voicesPath, []).sort((a, b) =>
        (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1
      );
    },

    getVoice(id: string) {
      return this.listVoices().find((v) => v.id === id) || null;
    },

    upsertVoice(voice: VoiceRecord) {
      const all = readJson<VoiceRecord[]>(voicesPath, []);
      const idx = all.findIndex((v) => v.id === voice.id);
      const now = new Date().toISOString();
      const next = {
        ...voice,
        updatedAt: voice.updatedAt || now,
      };
      if (idx >= 0) all[idx] = { ...all[idx], ...next };
      else all.unshift(next);
      writeJson(voicesPath, all);
      return next;
    },

    deleteVoice(id: string) {
      const all = readJson<VoiceRecord[]>(voicesPath, []).filter((v) => v.id !== id);
      writeJson(voicesPath, all);

      const samples = readJson<VoiceSampleRecord[]>(samplesPath, []);
      const keep = samples.filter((s) => s.voiceId !== id);
      const removed = samples.filter((s) => s.voiceId === id);
      writeJson(samplesPath, keep);
      for (const s of removed) {
        const file = path.join(voicesAudioDir, id, s.filename);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      const dir = path.join(voicesAudioDir, id);
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      const creations = readJson<CreationRecord[]>(creationsPath, []);
      writeJson(
        creationsPath,
        creations.filter((c) => c.voiceId !== id)
      );
    },

    mergeRemoteVoices(remote: VoiceRecord[]) {
      const all = readJson<VoiceRecord[]>(voicesPath, []);
      const map = new Map(all.map((v) => [v.id, v]));
      for (const v of remote) {
        const prev = map.get(v.id);
        map.set(v.id, prev ? { ...prev, ...v, name: v.name || prev.name } : v);
      }
      const merged = Array.from(map.values()).sort((a, b) =>
        (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1
      );
      writeJson(voicesPath, merged);
      return merged;
    },

    markTrained(voiceId: string) {
      const all = readJson<VoiceRecord[]>(voicesPath, []);
      const idx = all.findIndex((v) => v.id === voiceId);
      if (idx < 0) return null;
      const now = new Date().toISOString();
      all[idx] = {
        ...all[idx],
        lastTrainedAt: now,
        updatedAt: now,
        sampleCount: this.listSamples(voiceId).length,
      };
      writeJson(voicesPath, all);
      return all[idx];
    },

    listSamples(voiceId: string): VoiceSampleRecord[] {
      return readJson<VoiceSampleRecord[]>(samplesPath, [])
        .filter((s) => s.voiceId === voiceId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    addSample(params: {
      voiceId: string;
      buffer: Buffer;
      originalName: string;
      mimeType: string;
      source: "record" | "upload" | "clone";
    }): VoiceSampleRecord {
      const id = `sm_${randomUUID().slice(0, 12)}`;
      const ext =
        path.extname(params.originalName) ||
        (params.mimeType.includes("wav")
          ? ".wav"
          : params.mimeType.includes("mpeg") || params.mimeType.includes("mp3")
            ? ".mp3"
            : ".webm");
      const filename = `${id}${ext}`;
      const dir = voiceSamplesDir(params.voiceId);
      fs.writeFileSync(path.join(dir, filename), params.buffer);
      const record: VoiceSampleRecord = {
        id,
        voiceId: params.voiceId,
        filename,
        originalName: params.originalName || filename,
        mimeType: params.mimeType || "audio/webm",
        source: params.source,
        size: params.buffer.length,
        createdAt: new Date().toISOString(),
      };
      const all = readJson<VoiceSampleRecord[]>(samplesPath, []);
      all.unshift(record);
      writeJson(samplesPath, all);
      syncSampleCount(params.voiceId);
      return record;
    },

    getSample(voiceId: string, sampleId: string) {
      return (
        this.listSamples(voiceId).find((s) => s.id === sampleId) || null
      );
    },

    sampleFilePath(sample: VoiceSampleRecord) {
      return path.join(voicesAudioDir, sample.voiceId, sample.filename);
    },

    deleteSample(voiceId: string, sampleId: string) {
      const all = readJson<VoiceSampleRecord[]>(samplesPath, []);
      const target = all.find((s) => s.id === sampleId && s.voiceId === voiceId);
      const next = all.filter(
        (s) => !(s.id === sampleId && s.voiceId === voiceId)
      );
      writeJson(samplesPath, next);
      if (target) {
        const file = path.join(voicesAudioDir, voiceId, target.filename);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      syncSampleCount(voiceId);
    },

    listCreations(voiceId?: string): CreationRecord[] {
      const all = readJson<CreationRecord[]>(creationsPath, []).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      return voiceId ? all.filter((c) => c.voiceId === voiceId) : all;
    },

    saveCreation(params: {
      title: string;
      voiceId: string;
      voiceName: string;
      text: string;
      textSpoken: string;
      buffer: Buffer;
      mimeType: string;
      provider: string;
    }): CreationRecord {
      const id = `cr_${randomUUID().slice(0, 12)}`;
      const ext = params.mimeType.includes("wav") ? "wav" : "mp3";
      const filename = `${id}.${ext}`;
      fs.writeFileSync(path.join(creationsAudioDir, filename), params.buffer);
      const record: CreationRecord = {
        id,
        title: params.title || params.text.slice(0, 48),
        voiceId: params.voiceId,
        voiceName: params.voiceName,
        text: params.text,
        textSpoken: params.textSpoken,
        filename,
        mimeType: params.mimeType,
        createdAt: new Date().toISOString(),
        provider: params.provider,
      };
      const all = readJson<CreationRecord[]>(creationsPath, []);
      all.unshift(record);
      writeJson(creationsPath, all);
      return record;
    },

    getCreation(id: string) {
      return this.listCreations().find((c) => c.id === id) || null;
    },

    deleteCreation(id: string) {
      const all = readJson<CreationRecord[]>(creationsPath, []);
      const target = all.find((c) => c.id === id);
      const next = all.filter((c) => c.id !== id);
      writeJson(creationsPath, next);
      if (target) {
        const file = path.join(creationsAudioDir, target.filename);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    },

    listPronunciations(voiceId?: string | null): PronunciationRule[] {
      const all = readJson<PronunciationRule[]>(pronunciationsPath, []);
      const filtered =
        voiceId === undefined
          ? all
          : all.filter((r) => !r.voiceId || r.voiceId === voiceId);
      return filtered.sort((a, b) => a.word.localeCompare(b.word, "pt"));
    },

    upsertPronunciation(
      word: string,
      alias: string,
      note?: string,
      voiceId?: string
    ) {
      const cleanWord = word.trim();
      const cleanAlias = alias.trim();
      if (!cleanWord || !cleanAlias) {
        throw new Error("Informe a palavra e como deve ser pronunciada.");
      }
      const all = readJson<PronunciationRule[]>(pronunciationsPath, []);
      const existing = all.find(
        (r) =>
          r.word.toLowerCase() === cleanWord.toLowerCase() &&
          (r.voiceId || "") === (voiceId || "")
      );
      if (existing) {
        existing.alias = cleanAlias;
        existing.note = note?.trim() || existing.note;
        writeJson(pronunciationsPath, all);
        return existing;
      }
      const rule: PronunciationRule = {
        id: `pr_${randomUUID().slice(0, 10)}`,
        word: cleanWord,
        alias: cleanAlias,
        note: note?.trim() || undefined,
        voiceId: voiceId || undefined,
        createdAt: new Date().toISOString(),
      };
      all.push(rule);
      writeJson(pronunciationsPath, all);
      return rule;
    },

    deletePronunciation(id: string) {
      const all = readJson<PronunciationRule[]>(pronunciationsPath, []).filter(
        (r) => r.id !== id
      );
      writeJson(pronunciationsPath, all);
    },

    applyPronunciations(text: string, voiceId?: string): string {
      const rules = this.listPronunciations(voiceId);
      let out = text;
      const sorted = [...rules].sort((a, b) => b.word.length - a.word.length);
      for (const rule of sorted) {
        const escaped = rule.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "gi");
        out = out.replace(re, rule.alias);
      }
      return out;
    },
  };
}

export type AgencyStore = ReturnType<typeof createStore>;
