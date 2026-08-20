export type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  updatedAt?: string;
  lastTrainedAt?: string;
  demo: boolean;
  engine?: string;
  provider?: "elevenlabs" | "local";
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
  voiceId?: string;
  createdAt: string;
};

export type HealthResponse = {
  ok: boolean;
  mode: "live" | "booting" | "offline" | "demo";
  message: string;
  engine?: string;
  device?: string;
  provider?: "elevenlabs" | "local";
};

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 240) };
    }
  }
  if (!res.ok) {
    const err =
      (data as { error?: string; detail?: string }).error ||
      (data as { detail?: string }).detail ||
      (res.status === 413
        ? "Arquivo grande demais para o servidor."
        : res.status === 404
          ? "Perfil não encontrado. Volte à Biblioteca e abra de novo."
          : res.statusText || `Erro HTTP ${res.status}`);
    throw new Error(typeof err === "string" ? err : JSON.stringify(err));
  }
  return data as T;
}

function mapVoice(v: Record<string, unknown>): VoiceRecord {
  return {
    id: String(v.id),
    name: String(v.name),
    description: v.description ? String(v.description) : undefined,
    sampleCount: Number(v.sampleCount ?? v.sample_count ?? 0),
    createdAt: String(v.createdAt ?? v.created_at ?? ""),
    updatedAt: v.updatedAt ? String(v.updatedAt) : undefined,
    lastTrainedAt: v.lastTrainedAt ? String(v.lastTrainedAt) : undefined,
    demo: Boolean(v.demo),
    engine: v.engine ? String(v.engine) : undefined,
    provider:
      v.provider === "elevenlabs" || v.provider === "local"
        ? v.provider
        : undefined,
  };
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  return parseJson(res);
}

export async function listVoices(): Promise<VoiceRecord[]> {
  const res = await fetch("/api/voices");
  const data = await parseJson<{ voices: Array<Record<string, unknown>> }>(res);
  return data.voices.map(mapVoice);
}

export async function getVoiceProfile(id: string): Promise<{
  voice: VoiceRecord;
  samples: VoiceSampleRecord[];
  creations: CreationRecord[];
}> {
  const res = await fetch(`/api/voices/${id}`);
  const data = await parseJson<{
    voice: Record<string, unknown>;
    samples: VoiceSampleRecord[];
    creations: CreationRecord[];
  }>(res);
  return {
    voice: mapVoice(data.voice),
    samples: data.samples || [],
    creations: data.creations || [],
  };
}

export async function cloneVoice(params: {
  name: string;
  description: string;
  consent: boolean;
  files: File[];
}): Promise<{ voice: VoiceRecord; message: string }> {
  const form = new FormData();
  form.append("name", params.name);
  form.append("description", params.description);
  form.append("consent", String(params.consent));
  form.append("language", "pt");
  for (const file of params.files) {
    form.append("files", file, file.name);
  }
  const res = await fetch("/api/voices/clone", {
    method: "POST",
    body: form,
  });
  const data = await parseJson<{
    voice: Record<string, unknown>;
    message: string;
  }>(res);
  return {
    message: data.message,
    voice: mapVoice(data.voice),
  };
}

export async function trainVoice(params: {
  voiceId: string;
  files: File[];
  source?: "record" | "upload";
}): Promise<{ voice: VoiceRecord; samples: VoiceSampleRecord[]; message: string }> {
  const form = new FormData();
  form.append("source", params.source || "upload");
  for (const file of params.files) {
    form.append("files", file, file.name);
  }
  const res = await fetch(`/api/voices/${params.voiceId}/samples`, {
    method: "POST",
    body: form,
  });
  const data = await parseJson<{
    voice: Record<string, unknown>;
    samples: VoiceSampleRecord[];
    message: string;
  }>(res);
  return {
    message: data.message,
    voice: mapVoice(data.voice),
    samples: data.samples || [],
  };
}

export async function deleteVoice(id: string): Promise<void> {
  const res = await fetch(`/api/voices/${id}`, { method: "DELETE" });
  await parseJson(res);
}

export async function deleteSample(
  voiceId: string,
  sampleId: string
): Promise<void> {
  const res = await fetch(`/api/voices/${voiceId}/samples/${sampleId}`, {
    method: "DELETE",
  });
  await parseJson(res);
}

export function sampleAudioUrl(voiceId: string, sampleId: string): string {
  return `/api/voices/${voiceId}/samples/${sampleId}/audio`;
}

export async function generateSpeech(params: {
  voiceId: string;
  text: string;
  stability: number;
  similarityBoost: number;
  title?: string;
  save?: boolean;
}): Promise<{ blob?: Blob; message?: string; creationId?: string | null }> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceId: params.voiceId,
      text: params.text,
      language: "pt",
      stability: params.stability,
      similarityBoost: params.similarityBoost,
      title: params.title,
      save: params.save !== false,
    }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return parseJson(res);
  }
  if (!res.ok) {
    throw new Error("Falha ao gerar áudio.");
  }
  return {
    blob: await res.blob(),
    creationId: res.headers.get("X-Creation-Id"),
  };
}

export async function listCreations(voiceId?: string): Promise<CreationRecord[]> {
  const q = voiceId ? `?voiceId=${encodeURIComponent(voiceId)}` : "";
  const res = await fetch(`/api/creations${q}`);
  const data = await parseJson<{ creations: CreationRecord[] }>(res);
  return data.creations;
}

export function creationAudioUrl(id: string): string {
  return `/api/creations/${id}/audio`;
}

export async function deleteCreation(id: string): Promise<void> {
  const res = await fetch(`/api/creations/${id}`, { method: "DELETE" });
  await parseJson(res);
}

export async function listPronunciations(
  voiceId?: string
): Promise<PronunciationRule[]> {
  const q =
    voiceId !== undefined
      ? `?voiceId=${encodeURIComponent(voiceId)}`
      : "";
  const res = await fetch(`/api/pronunciations${q}`);
  const data = await parseJson<{ pronunciations: PronunciationRule[] }>(res);
  return data.pronunciations;
}

export async function savePronunciation(params: {
  word: string;
  alias: string;
  note?: string;
  voiceId?: string;
}): Promise<PronunciationRule> {
  const res = await fetch("/api/pronunciations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ pronunciation: PronunciationRule }>(res);
  return data.pronunciation;
}

export async function deletePronunciation(id: string): Promise<void> {
  const res = await fetch(`/api/pronunciations/${id}`, { method: "DELETE" });
  await parseJson(res);
}

export async function previewPronunciation(
  text: string,
  voiceId?: string
): Promise<{ original: string; spoken: string }> {
  const res = await fetch("/api/pronunciations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId }),
  });
  return parseJson(res);
}
