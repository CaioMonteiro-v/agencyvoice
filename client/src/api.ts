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

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  return parseJson(res);
}

export async function listVoices(): Promise<VoiceRecord[]> {
  const res = await fetch("/api/voices");
  const data = await parseJson<{ voices: Array<Record<string, unknown>> }>(res);
  return data.voices.map((v) => ({
    id: String(v.id),
    name: String(v.name),
    description: v.description ? String(v.description) : undefined,
    sampleCount: Number(v.sampleCount ?? v.sample_count ?? 0),
    createdAt: String(v.createdAt ?? v.created_at ?? ""),
    demo: Boolean(v.demo),
    engine: v.engine ? String(v.engine) : undefined,
  }));
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
    voice: {
      id: String(data.voice.id),
      name: String(data.voice.name),
      description: data.voice.description
        ? String(data.voice.description)
        : undefined,
      sampleCount: Number(
        data.voice.sampleCount ?? data.voice.sample_count ?? 0
      ),
      createdAt: String(data.voice.createdAt ?? data.voice.created_at ?? ""),
      demo: Boolean(data.voice.demo),
      engine: data.voice.engine ? String(data.voice.engine) : undefined,
    },
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
}): Promise<{ blob?: Blob; message?: string }> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceId: params.voiceId,
      text: params.text,
      language: "pt",
      stability: params.stability,
      similarityBoost: params.similarityBoost,
    }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return parseJson(res);
  }
  if (!res.ok) {
    throw new Error("Falha ao gerar áudio na AgencyVoice AI.");
  }
  return { blob: await res.blob() };
}
