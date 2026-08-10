import { Readable } from "stream";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Cliente oficial ElevenLabs — mesmo padrão do site:
 *   elevenlabs.textToSpeech.convert(voiceId, { text, modelId, outputFormat })
 *   elevenlabs.voices.ivc.create({ name, files })
 */
export function createElevenClient(apiKey: string) {
  return new ElevenLabsClient({ apiKey });
}

export async function streamToBuffer(
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | Readable
): Promise<Buffer> {
  // Web ReadableStream (SDK return type)
  if (typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  // Node stream
  const nodeStream = stream as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function cloneVoiceIvc(
  client: ElevenLabsClient,
  params: {
    name: string;
    description?: string;
    files: Array<{ buffer: Buffer; filename: string }>;
  }
) {
  const files = params.files.map((f) => {
    const stream = Readable.from(f.buffer);
    // SDK tipa como File-like; filename ajuda o multipart
    (stream as Readable & { path?: string }).path = f.filename;
    return stream;
  });

  return client.voices.ivc.create({
    name: params.name,
    description: params.description || undefined,
    files,
    removeBackgroundNoise: true,
    labels: {
      language: "pt",
      use_case: "campaign",
      product: "agencyvoice",
    },
  });
}

export async function textToSpeechMp3(
  client: ElevenLabsClient,
  params: {
    voiceId: string;
    text: string;
    stability?: number;
    similarityBoost?: number;
  }
) {
  const audio = await client.textToSpeech.convert(params.voiceId, {
    text: params.text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: params.stability ?? 0.5,
      similarityBoost: params.similarityBoost ?? 0.75,
    },
  });
  return streamToBuffer(audio);
}

export async function verifyApiKey(client: ElevenLabsClient) {
  return client.user.get();
}

export async function deleteVoice(client: ElevenLabsClient, voiceId: string) {
  return client.voices.delete(voiceId);
}
