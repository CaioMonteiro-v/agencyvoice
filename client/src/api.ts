export type VoiceRecord = {
  id: string;
  name: string;
  description?: string;
  sampleCount: number;
  createdAt: string;
  demo: boolean;
  elevenLabsVoiceId?: string;
};

export type HealthResponse = {
  ok: boolean;
  mode: "live" | "demo";
  message: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: string }).error || res.statusText;
    throw new Error(err);
  }
  return data as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  return parseJson(res);
}

export async function listVoices(): Promise<VoiceRecord[]> {
  const res = await fetch("/api/voices");
  const data = await parseJson<{ voices: VoiceRecord[] }>(res);
  return data.voices;
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
  for (const file of params.files) {
    form.append("files", file, file.name);
  }
  const res = await fetch("/api/voices/clone", {
    method: "POST",
    body: form,
  });
  return parseJson(res);
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
}): Promise<{
  blob?: Blob;
  demo?: boolean;
  text?: string;
  voiceName?: string;
  message?: string;
}> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return parseJson(res);
  }
  if (!res.ok) {
    throw new Error("Falha ao gerar áudio.");
  }
  return { blob: await res.blob() };
}
