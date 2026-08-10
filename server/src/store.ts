import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  demo: boolean;
  engine: string;
  provider: "elevenlabs" | "local";
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
  createdAt: string;
};

export function createStore(rootDir: string) {
  const dataDir = path.join(rootDir, "data");
  const creationsAudioDir = path.join(rootDir, "uploads", "creations");
  const voicesPath = path.join(dataDir, "voices.json");
  const creationsPath = path.join(dataDir, "creations.json");
  const pronunciationsPath = path.join(dataDir, "pronunciations.json");

  for (const dir of [dataDir, creationsAudioDir]) {
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

  return {
    creationsAudioDir,

    listVoices(): VoiceRecord[] {
      return readJson<VoiceRecord[]>(voicesPath, []).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },

    upsertVoice(voice: VoiceRecord) {
      const all = readJson<VoiceRecord[]>(voicesPath, []);
      const idx = all.findIndex((v) => v.id === voice.id);
      if (idx >= 0) all[idx] = { ...all[idx], ...voice };
      else all.unshift(voice);
      writeJson(voicesPath, all);
      return voice;
    },

    deleteVoice(id: string) {
      const all = readJson<VoiceRecord[]>(voicesPath, []).filter((v) => v.id !== id);
      writeJson(voicesPath, all);
    },

    mergeRemoteVoices(remote: VoiceRecord[]) {
      const all = readJson<VoiceRecord[]>(voicesPath, []);
      const map = new Map(all.map((v) => [v.id, v]));
      for (const v of remote) {
        const prev = map.get(v.id);
        map.set(v.id, prev ? { ...prev, ...v, name: v.name || prev.name } : v);
      }
      const merged = Array.from(map.values()).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      writeJson(voicesPath, merged);
      return merged;
    },

    listCreations(): CreationRecord[] {
      return readJson<CreationRecord[]>(creationsPath, []).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
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

    listPronunciations(): PronunciationRule[] {
      return readJson<PronunciationRule[]>(pronunciationsPath, []).sort((a, b) =>
        a.word.localeCompare(b.word, "pt")
      );
    },

    upsertPronunciation(word: string, alias: string, note?: string) {
      const cleanWord = word.trim();
      const cleanAlias = alias.trim();
      if (!cleanWord || !cleanAlias) {
        throw new Error("Informe a palavra e como deve ser pronunciada.");
      }
      const all = readJson<PronunciationRule[]>(pronunciationsPath, []);
      const existing = all.find(
        (r) => r.word.toLowerCase() === cleanWord.toLowerCase()
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

    applyPronunciations(text: string): string {
      const rules = this.listPronunciations();
      let out = text;
      // Longer words first to avoid partial replaces
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
