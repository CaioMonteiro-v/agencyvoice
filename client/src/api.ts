export type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  demo: boolean;
  engine?: string;
  provider?: "elevenlabs" | "local";
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

export type HealthResponse = {
  ok: boolean;
  mode: "live" | "booting" | "offline" | "demo";
  message: string;
  engine?: string;
  device?: string;
  provider?: "elevenlabs" | "local";
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      (data as { error?: string; detail?: string }).error ||
      (data as { detail?: string }).detail ||
      res.statusText;
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

export async function deleteVoice(id: string): Promise<void> {
  const res = await fetch(`/api/voices/${id}`, { method: "DELETE" });
  await parseJson(res);
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
    throw new Error("Falha ao gerar áudio na AgencyVoice AI.");
  }
  return {
    blob: await res.blob(),
    creationId: res.headers.get("X-Creation-Id"),
  };
}

export async function listCreations(): Promise<CreationRecord[]> {
  const res = await fetch("/api/creations");
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

export async function listPronunciations(): Promise<PronunciationRule[]> {
  const res = await fetch("/api/pronunciations");
  const data = await parseJson<{ pronunciations: PronunciationRule[] }>(res);
  return data.pronunciations;
}

export async function savePronunciation(params: {
  word: string;
  alias: string;
  note?: string;
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
  text: string
): Promise<{ original: string; spoken: string }> {
  const res = await fetch("/api/pronunciations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return parseJson(res);
}
