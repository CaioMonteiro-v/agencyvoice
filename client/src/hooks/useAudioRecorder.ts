import { useEffect, useRef, useState } from "react";

export type Sample = {
  id: string;
  file: File;
  url: string;
  durationLabel: string;
  source: "record" | "upload";
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/** WhatsApp manda “áudio” como MP4/M4A (container), às vezes sem extensão. */
function isLikelyAudioFile(file: File): boolean {
  const name = file.name || "";
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("audio/")) return true;
  // Áudio do WhatsApp no Windows aparece como "Arquivo MP4" / video/mp4
  if (
    type === "video/mp4" ||
    type === "application/mp4" ||
    type === "video/quicktime"
  ) {
    return true;
  }
  if (/\.(webm|wav|mp3|m4a|ogg|flac|mpeg|mp4|aac|opus|caf|3gp)$/i.test(name)) {
    return true;
  }
  // Nome típico do WhatsApp sem extensão clara
  if (/whatsapp\s*audio/i.test(name)) return true;
  return false;
}

function normalizeAudioFile(file: File): File {
  const name = file.name || "whatsapp-audio.mp4";
  const hasExt = /\.[a-z0-9]+$/i.test(name);
  if (hasExt) return file;
  const type = (file.type || "").toLowerCase();
  const ext =
    type.includes("mpeg") || type.includes("mp3")
      ? ".mp3"
      : type.includes("wav")
        ? ".wav"
        : type.includes("ogg") || type.includes("opus")
          ? ".ogg"
          : ".mp4";
  return new File([file], `${name}${ext}`, {
    type: file.type || "audio/mp4",
    lastModified: file.lastModified,
  });
}

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      samples.forEach((s) => URL.revokeObjectURL(s.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => isLikelyAudioFile(f));
    if (list.length === 0) {
      setError(
        "Arquivo não reconhecido. Áudio do WhatsApp em MP4/M4A agora é aceito — se ainda falhar, renomeie para .mp4 ou exporte em MP3."
      );
      return;
    }
    const tooBig = list.find((f) => f.size > 100 * 1024 * 1024);
    if (tooBig) {
      setError(
        `"${tooBig.name}" passa de 100 MB. Converta para MP3 ou corte o áudio.`
      );
      return;
    }
    setError(null);
    const next: Sample[] = list.map((file) => ({
      id: crypto.randomUUID(),
      file: normalizeAudioFile(file),
      url: URL.createObjectURL(file),
      durationLabel: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      source: "upload" as const,
    }));
    setSamples((prev) => [...prev, ...next]);

    // Tenta ler duração real (útil p/ ~1m50)
    for (const sample of next) {
      const audio = new Audio(sample.url);
      audio.addEventListener("loadedmetadata", () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        setSamples((prev) =>
          prev.map((s) =>
            s.id === sample.id
              ? {
                  ...s,
                  durationLabel: `${formatDuration(Math.round(audio.duration))} · ${(s.file.size / 1024 / 1024).toFixed(1)} MB`,
                }
              : s
          )
        );
      });
    }
  };

  const removeSample = (id: string) => {
    setSamples((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  };

  const clearSamples = () => {
    setSamples((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime });
        const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        const file = new File([blob], `gravacao-${Date.now()}.webm`, {
          type: mime,
        });
        const sample: Sample = {
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(blob),
          durationLabel: formatDuration(seconds),
          source: "record",
        };
        setSamples((prev) => [...prev, sample]);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorder.current = recorder;
      startedAt.current = Date.now();
      setElapsed(0);
      recorder.start(200);
      setRecording(true);
      timer.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }, 250);
    } catch {
      setError(
        "Não foi possível acessar o microfone. Permita o acesso ou envie um arquivo."
      );
    }
  };

  const stop = () => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    mediaRecorder.current?.stop();
    setRecording(false);
  };

  return {
    recording,
    elapsed: formatDuration(elapsed),
    error,
    samples,
    start,
    stop,
    addFiles,
    removeSample,
    clearSamples,
    setError,
  };
}
