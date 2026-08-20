import { useEffect, useMemo, useState } from "react";
import {
  cloneVoice,
  creationAudioUrl,
  deleteCreation,
  deletePronunciation,
  deleteSample,
  deleteVoice,
  generateSpeech,
  getHealth,
  getVoiceProfile,
  listPronunciations,
  listVoices,
  previewPronunciation,
  sampleAudioUrl,
  savePronunciation,
  trainVoice,
  type CreationRecord,
  type PronunciationRule,
  type VoiceRecord,
  type VoiceSampleRecord,
} from "./api";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

type View = "landing" | "studio";
type StudioPage = "biblioteca" | "pronuncia" | "nova" | "perfil";
type ProfileSection = "treinar" | "gerar" | "criacoes" | "nomes";

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button className="brand" onClick={onClick} type="button" aria-label="AgencyVoice">
      <span className="brand-mark" aria-hidden />
      AgencyVoice
    </button>
  );
}

function formatWhen(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <button className="btn btn-primary" type="button" onClick={onStart}>
            Abrir estúdio
          </button>
        </div>
      </header>

      <section className="hero">
        <h1 className="hero-brand">
          Agency<span>Voice</span>
        </h1>
        <h2>A voz do candidato. Melhor a cada áudio.</h2>
        <p>
          Crie o perfil (ex.: Fábio), alimente com várias gravações e vá
          treinando até a fala sair natural — inclusive os nomes da campanha.
        </p>
        <div className="hero-cta">
          <button className="btn btn-primary" type="button" onClick={onStart}>
            Ir para a Biblioteca
          </button>
        </div>
        <div className="wave-visual" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              style={{
                height: `${18 + ((i * 17) % 70)}%`,
                animationDelay: `${(i % 8) * 0.08}s`,
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function MicIcon({ recording }: { recording: boolean }) {
  if (recording) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}

function SampleCapture({
  recorder,
  drag,
  setDrag,
}: {
  recorder: ReturnType<typeof useAudioRecorder>;
  drag: boolean;
  setDrag: (v: boolean) => void;
}) {
  return (
    <div className="grid-2">
      <div>
        <div className="recorder">
          <button
            type="button"
            className={`mic-btn ${recorder.recording ? "recording" : ""}`}
            onClick={() => (recorder.recording ? recorder.stop() : recorder.start())}
            aria-label={recorder.recording ? "Parar gravação" : "Iniciar gravação"}
          >
            <MicIcon recording={recorder.recording} />
          </button>
          <div className="timer">{recorder.elapsed}</div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.92rem" }}>
            {recorder.recording
              ? "Gravando… clique para parar"
              : "Grave fala limpa do candidato"}
          </p>
        </div>
        <div
          className={`upload-zone ${drag ? "drag" : ""}`}
          style={{ marginTop: "1rem" }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) recorder.addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg"
            multiple
            onChange={(e) => {
              if (e.target.files) recorder.addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          Ou arraste / envie arquivos de áudio
        </div>
      </div>
      <div>
        <h3 className="panel-sub">Fila ({recorder.samples.length})</h3>
        {recorder.samples.length === 0 ? (
          <p className="empty">Nenhum áudio na fila ainda.</p>
        ) : (
          <div className="samples">
            {recorder.samples.map((s) => (
              <div className="sample" key={s.id}>
                <div className="meta">
                  <strong>{s.file.name}</strong>
                  <span>
                    {s.source === "record" ? "Gravação" : "Upload"} · {s.durationLabel}
                  </span>
                  <audio src={s.url} controls preload="metadata" />
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ padding: "0.45rem 0.75rem" }}
                  onClick={() => recorder.removeSample(s.id)}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
        {recorder.error && <div className="alert error">{recorder.error}</div>}
      </div>
    </div>
  );
}

function Studio({ onBack }: { onBack: () => void }) {
  const [page, setPage] = useState<StudioPage>("biblioteca");
  const [profileSection, setProfileSection] = useState<ProfileSection>("treinar");
  const [mode, setMode] = useState<"live" | "booting" | "offline" | "demo">("booting");
  const [modeMsg, setModeMsg] = useState("");
  const [provider, setProvider] = useState<"elevenlabs" | "local" | "">("");
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [activeVoice, setActiveVoice] = useState<VoiceRecord | null>(null);
  const [samples, setSamples] = useState<VoiceSampleRecord[]>([]);
  const [creations, setCreations] = useState<CreationRecord[]>([]);
  const [pronunciations, setPronunciations] = useState<PronunciationRule[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [script, setScript] = useState(
    "Olá, eu sou candidato a representar você. Juntos vamos transformar nossa cidade."
  );
  const [creationTitle, setCreationTitle] = useState("");
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(
    null
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [word, setWord] = useState("");
  const [alias, setAlias] = useState("");
  const [note, setNote] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewSpoken, setPreviewSpoken] = useState("");
  const [playingCreationId, setPlayingCreationId] = useState<string | null>(null);

  const recorder = useAudioRecorder();

  const refreshVoices = async () => {
    const list = await listVoices().catch(() => [] as VoiceRecord[]);
    setVoices(list);
    return list;
  };

  const openProfile = async (id: string, section: ProfileSection = "treinar") => {
    const profile = await getVoiceProfile(id);
    setActiveVoice(profile.voice);
    setSamples(profile.samples);
    setCreations(profile.creations);
    const rules = await listPronunciations(id).catch(() => [] as PronunciationRule[]);
    setPronunciations(rules);
    setProfileSection(section);
    setPage("perfil");
    setAlert(null);
  };

  useEffect(() => {
    getHealth()
      .then((h) => {
        setMode(h.mode);
        setModeMsg(h.message);
        setProvider(h.provider || "");
      })
      .catch(() => {
        setMode("offline");
        setModeMsg("Gateway offline — rode npm run dev.");
      });
    refreshVoices().catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const canCreate = useMemo(
    () => name.trim().length > 0 && consent && recorder.samples.length > 0 && !busy,
    [name, consent, recorder.samples.length, busy]
  );

  const handleCreate = async () => {
    setAlert(null);
    setBusy(true);
    try {
      const result = await cloneVoice({
        name: name.trim(),
        description: description.trim(),
        consent,
        files: recorder.samples.map((s) => s.file),
      });
      recorder.clearSamples();
      setConsent(false);
      setName("");
      setDescription("");
      await refreshVoices();
      setAlert({ type: "ok", text: result.message });
      await openProfile(result.voice.id, "treinar");
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao criar perfil.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTrain = async () => {
    if (!activeVoice || recorder.samples.length === 0) return;
    setAlert(null);
    setBusy(true);
    try {
      const hasRecord = recorder.samples.some((s) => s.source === "record");
      const result = await trainVoice({
        voiceId: activeVoice.id,
        files: recorder.samples.map((s) => s.file),
        source: hasRecord ? "record" : "upload",
      });
      setActiveVoice(result.voice);
      setSamples(result.samples);
      recorder.clearSamples();
      await refreshVoices();
      setAlert({
        type: result.message.toLowerCase().includes("falhou") ? "info" : "ok",
        text: result.message,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Erro ao treinar.";
      const text =
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? "Falha de rede ou o servidor demorou (Render free “acorda” lento). Espere 1 min e tente de novo — se o áudio for WAV grande, mande em MP3."
          : raw;
      setAlert({ type: "error", text });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!activeVoice || !script.trim()) return;
    setAlert(null);
    setBusy(true);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const result = await generateSpeech({
        voiceId: activeVoice.id,
        text: script.trim(),
        stability,
        similarityBoost: similarity,
        title: creationTitle.trim() || undefined,
        save: true,
      });
      if (result.blob) {
        setAudioUrl(URL.createObjectURL(result.blob));
        const profile = await getVoiceProfile(activeVoice.id);
        setCreations(profile.creations);
        setAlert({
          type: "ok",
          text: "Áudio gerado e salvo nas criações deste perfil.",
        });
        return;
      }
      setAlert({
        type: "error",
        text: result.message || "A IA não retornou áudio.",
      });
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao gerar.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSavePronunciation = async (forVoice?: string) => {
    setAlert(null);
    try {
      await savePronunciation({
        word: word.trim(),
        alias: alias.trim(),
        note: note.trim() || undefined,
        voiceId: forVoice,
      });
      setWord("");
      setAlias("");
      setNote("");
      const list = await listPronunciations(forVoice);
      setPronunciations(list);
      setAlert({
        type: "ok",
        text: "Pronúncia salva. Na geração, o nome será falado pelo alias.",
      });
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao salvar.",
      });
    }
  };

  return (
    <div className="page studio-shell">
      <header className="studio-header">
        <Brand onClick={onBack} />
        <div className="topbar-actions">
          <span className={`mode-pill ${mode === "live" ? "live" : ""}`}>
            <span className="dot" />
            {mode === "live"
              ? provider === "elevenlabs"
                ? "ElevenLabs"
                : "AgencyVoice AI"
              : mode === "booting"
                ? "Carregando…"
                : "Offline"}
          </span>
          <button className="btn btn-ghost" type="button" onClick={onBack}>
            Início
          </button>
        </div>
      </header>

      {modeMsg && page === "biblioteca" && (
        <div
          className={`alert ${mode === "live" ? "ok" : mode === "offline" ? "error" : "info"}`}
          style={{ marginBottom: "1rem" }}
        >
          {modeMsg}
        </div>
      )}

      {page !== "perfil" && (
        <nav className="progress studio-tabs studio-tabs-compact" aria-label="Navegação">
          <button
            type="button"
            className={page === "biblioteca" || page === "nova" ? "active" : ""}
            onClick={() => {
              setPage("biblioteca");
              setAlert(null);
              refreshVoices();
            }}
          >
            <small>Estúdio</small>
            <strong>Biblioteca</strong>
          </button>
          <button
            type="button"
            className={page === "pronuncia" ? "active" : ""}
            onClick={async () => {
              setPage("pronuncia");
              setAlert(null);
              setPronunciations(await listPronunciations().catch(() => []));
            }}
          >
            <small>Campanha</small>
            <strong>Pronúncia</strong>
          </button>
        </nav>
      )}

      {page === "biblioteca" && (
        <section className="panel">
          <div className="library-head">
            <div>
              <h2>Biblioteca de vozes</h2>
              <p className="lead" style={{ marginBottom: 0 }}>
                Abra um perfil (como Fábio), alimente com vários áudios e vá
                treinando até ficar bom.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPage("nova");
                setAlert(null);
                recorder.clearSamples();
              }}
            >
              Nova voz
            </button>
          </div>

          {voices.length === 0 ? (
            <p className="empty" style={{ marginTop: "1.5rem" }}>
              Nenhum perfil ainda. Crie o primeiro com “Nova voz”.
            </p>
          ) : (
            <div className="profile-grid">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="profile-card"
                  onClick={() => openProfile(v.id).catch((err) =>
                    setAlert({
                      type: "error",
                      text: err instanceof Error ? err.message : "Erro ao abrir.",
                    })
                  )}
                >
                  <div className="profile-avatar" aria-hidden>
                    {(v.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="profile-card-body">
                    <strong>{v.name}</strong>
                    <span>
                      {v.sampleCount} áudio(s) · {v.provider || "voz"}
                    </span>
                    <span>Treino: {formatWhen(v.lastTrainedAt || v.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {alert && page === "biblioteca" && (
            <div className={`alert ${alert.type}`}>{alert.text}</div>
          )}
        </section>
      )}

      {page === "nova" && (
        <section className="panel">
          <button
            type="button"
            className="btn btn-ghost back-link"
            onClick={() => setPage("biblioteca")}
          >
            ← Voltar à Biblioteca
          </button>
          <h2>Nova voz</h2>
          <p className="lead">
            Crie o perfil do candidato. Depois você abre a página dele e
            continua adicionando áudios para treinar.
          </p>
          <div className="field">
            <label htmlFor="voice-name">Nome do perfil</label>
            <input
              id="voice-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Fábio"
            />
          </div>
          <div className="field">
            <label htmlFor="voice-desc">Descrição (opcional)</label>
            <textarea
              id="voice-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tom de comício, sotaque…"
            />
          </div>
          <SampleCapture recorder={recorder} drag={drag} setDrag={setDrag} />
          <label className="consent" style={{ marginTop: "1rem" }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Confirmo autorização legal para capturar e clonar esta voz.
            </span>
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCreate}
              onClick={handleCreate}
            >
              {busy ? "Criando…" : "Criar perfil e clonar"}
            </button>
          </div>
          {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}
        </section>
      )}

      {page === "perfil" && activeVoice && (
        <section className="panel profile-page">
          <button
            type="button"
            className="btn btn-ghost back-link"
            onClick={() => {
              setPage("biblioteca");
              setActiveVoice(null);
              refreshVoices();
            }}
          >
            ← Biblioteca
          </button>

          <header className="profile-hero">
            <div className="profile-avatar lg" aria-hidden>
              {activeVoice.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2>{activeVoice.name}</h2>
              <p>
                {activeVoice.sampleCount} áudio(s) de treino ·{" "}
                {activeVoice.engine || activeVoice.provider}
                {activeVoice.description ? ` · ${activeVoice.description}` : ""}
              </p>
              <p className="muted-line">
                Último treino: {formatWhen(activeVoice.lastTrainedAt || activeVoice.updatedAt)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginLeft: "auto", alignSelf: "flex-start" }}
              onClick={async () => {
                if (!confirm(`Excluir o perfil ${activeVoice.name}?`)) return;
                await deleteVoice(activeVoice.id);
                setPage("biblioteca");
                setActiveVoice(null);
                await refreshVoices();
              }}
            >
              Excluir perfil
            </button>
          </header>

          <nav className="profile-sections" aria-label="Seções do perfil">
            {(
              [
                ["treinar", "Treinar"],
                ["gerar", "Gerar"],
                ["criacoes", "Criações"],
                ["nomes", "Nomes"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={profileSection === id ? "active" : ""}
                onClick={() => {
                  setAlert(null);
                  setProfileSection(id);
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}

          {profileSection === "treinar" && (
            <div className="profile-section">
              <h3 className="panel-sub">Alimentar a IA</h3>
              <p className="empty" style={{ marginBottom: "1rem" }}>
                Pode mandar áudio longo (ex.: 1m50). Passo a passo:{" "}
                <strong style={{ color: "var(--foam)" }}>1)</strong> grave ou
                envie o arquivo →{" "}
                <strong style={{ color: "var(--foam)" }}>2)</strong> ele aparece
                na fila →{" "}
                <strong style={{ color: "var(--foam)" }}>3)</strong> clique em
                “Adicionar e atualizar voz”. Se o WAV for muito pesado, use MP3
                ou corte em pedaços de 30–60s.
              </p>
              <SampleCapture recorder={recorder} drag={drag} setDrag={setDrag} />
              <div className="actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={recorder.samples.length === 0 || busy}
                  onClick={handleTrain}
                >
                  {busy
                    ? "Enviando e treinando… (pode levar um minuto)"
                    : recorder.samples.length === 0
                      ? "Coloque um áudio na fila primeiro"
                      : `Adicionar ${recorder.samples.length} áudio(s) e atualizar voz`}
                </button>
              </div>

              <h3 className="panel-sub" style={{ marginTop: "2rem" }}>
                Áudios no perfil ({samples.length})
              </h3>
              {samples.length === 0 ? (
                <p className="empty">Ainda sem amostras salvas neste servidor.</p>
              ) : (
                <div className="samples">
                  {samples.map((s) => (
                    <div className="sample" key={s.id}>
                      <div className="meta">
                        <strong>{s.originalName}</strong>
                        <span>
                          {s.source} · {formatSize(s.size)} · {formatWhen(s.createdAt)}
                        </span>
                        <audio
                          src={sampleAudioUrl(activeVoice.id, s.id)}
                          controls
                          preload="metadata"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: "0.45rem 0.75rem" }}
                        onClick={async () => {
                          await deleteSample(activeVoice.id, s.id);
                          const profile = await getVoiceProfile(activeVoice.id);
                          setSamples(profile.samples);
                          setActiveVoice(profile.voice);
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {profileSection === "gerar" && (
            <div className="profile-section">
              <h3 className="panel-sub">Gerar com a voz de {activeVoice.name}</h3>
              <div className="field">
                <label htmlFor="creation-title">Título (opcional)</label>
                <input
                  id="creation-title"
                  value={creationTitle}
                  onChange={(e) => setCreationTitle(e.target.value)}
                  placeholder="Spot rádio 30s"
                />
              </div>
              <div className="field">
                <label htmlFor="script">Roteiro</label>
                <textarea
                  id="script"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="Texto que a voz deve falar…"
                />
              </div>
              <div className="sliders">
                <div className="slider">
                  <label>
                    <span>Estabilidade</span>
                    <span>{stability.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={stability}
                    onChange={(e) => setStability(Number(e.target.value))}
                  />
                </div>
                <div className="slider">
                  <label>
                    <span>Semelhança</span>
                    <span>{similarity.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={similarity}
                    onChange={(e) => setSimilarity(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!script.trim() || busy}
                  onClick={handleGenerate}
                >
                  {busy ? "Gerando…" : "Gerar e salvar"}
                </button>
              </div>
              {audioUrl && (
                <div className="player-box">
                  <strong>Resultado</strong>
                  <audio src={audioUrl} controls autoPlay />
                </div>
              )}
            </div>
          )}

          {profileSection === "criacoes" && (
            <div className="profile-section">
              <h3 className="panel-sub">Criações de {activeVoice.name}</h3>
              {creations.length === 0 ? (
                <p className="empty">Nada gerado ainda neste perfil.</p>
              ) : (
                <div className="creation-list">
                  {creations.map((c) => (
                    <article key={c.id} className="creation-item">
                      <div className="creation-meta">
                        <strong>{c.title}</strong>
                        <span>{formatWhen(c.createdAt)}</span>
                        <p>{c.text}</p>
                      </div>
                      <div className="creation-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "0.45rem 0.85rem" }}
                          onClick={() =>
                            setPlayingCreationId((p) => (p === c.id ? null : c.id))
                          }
                        >
                          {playingCreationId === c.id ? "Fechar" : "Ouvir"}
                        </button>
                        <a
                          className="btn btn-ghost"
                          style={{ padding: "0.45rem 0.85rem" }}
                          href={creationAudioUrl(c.id)}
                          download={c.filename}
                        >
                          Baixar
                        </a>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: "0.45rem 0.85rem" }}
                          onClick={async () => {
                            await deleteCreation(c.id);
                            setCreations((prev) => prev.filter((x) => x.id !== c.id));
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                      {playingCreationId === c.id && (
                        <audio
                          className="creation-player"
                          src={creationAudioUrl(c.id)}
                          controls
                          autoPlay
                        />
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {profileSection === "nomes" && (
            <div className="profile-section">
              <h3 className="panel-sub">Pronúncia para {activeVoice.name}</h3>
              <p className="empty" style={{ marginBottom: "1rem" }}>
                Treine como nomes devem soar neste perfil. Ex.: palavra escrita
                → como falar.
              </p>
              <div className="grid-2">
                <div>
                  <div className="field">
                    <label>Nome escrito</label>
                    <input
                      value={word}
                      onChange={(e) => setWord(e.target.value)}
                      placeholder="Ex.: Guarujá"
                    />
                  </div>
                  <div className="field">
                    <label>Como deve soar</label>
                    <input
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder="Ex.: Guaruujá"
                    />
                  </div>
                  <div className="field">
                    <label>Nota</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!word.trim() || !alias.trim()}
                      onClick={() => handleSavePronunciation(activeVoice.id)}
                    >
                      Salvar para este perfil
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="panel-sub">Regras ({pronunciations.length})</h3>
                  {pronunciations.length === 0 ? (
                    <p className="empty">Nenhuma regra neste perfil.</p>
                  ) : (
                    <div className="voice-list">
                      {pronunciations.map((r) => (
                        <div key={r.id} className="voice-item">
                          <div>
                            <strong>
                              {r.word} → {r.alias}
                            </strong>
                            <span>{r.note || (r.voiceId ? "Deste perfil" : "Global")}</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: "0.4rem 0.7rem" }}
                            onClick={async () => {
                              await deletePronunciation(r.id);
                              setPronunciations((prev) =>
                                prev.filter((x) => x.id !== r.id)
                              );
                            }}
                          >
                            Excluir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {page === "pronuncia" && (
        <section className="panel">
          <h2>Pronúncia de nomes</h2>
          <p className="lead">
            Dicionário global da campanha. Regras por perfil ficam dentro da
            página da voz na Biblioteca.
          </p>
          <div className="grid-2">
            <div>
              <div className="field">
                <label>Nome / palavra</label>
                <input
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="Ex.: Xi Jinping"
                />
              </div>
              <div className="field">
                <label>Como deve soar</label>
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Ex.: Chi Chin ping"
                />
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!word.trim() || !alias.trim()}
                  onClick={() => handleSavePronunciation()}
                >
                  Salvar global
                </button>
              </div>
              {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}
              <div className="field" style={{ marginTop: "1.25rem" }}>
                <label>Prévia</label>
                <textarea
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="Cole um trecho do roteiro…"
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  const r = await previewPronunciation(previewText);
                  setPreviewSpoken(r.spoken);
                }}
              >
                Aplicar regras
              </button>
              {previewSpoken && (
                <div className="player-box">
                  <strong>Texto enviado ao TTS</strong>
                  <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
                    {previewSpoken}
                  </p>
                </div>
              )}
            </div>
            <div>
              <h3 className="panel-sub">Dicionário ({pronunciations.length})</h3>
              {pronunciations.length === 0 ? (
                <p className="empty">Vazio por enquanto.</p>
              ) : (
                <div className="voice-list">
                  {pronunciations.map((r) => (
                    <div key={r.id} className="voice-item">
                      <div>
                        <strong>
                          {r.word} → {r.alias}
                        </strong>
                        <span>{r.voiceId ? `Perfil ${r.voiceId.slice(0, 8)}…` : "Global"}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: "0.4rem 0.7rem" }}
                        onClick={async () => {
                          await deletePronunciation(r.id);
                          setPronunciations((prev) =>
                            prev.filter((x) => x.id !== r.id)
                          );
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("landing");
  return view === "landing" ? (
    <Landing onStart={() => setView("studio")} />
  ) : (
    <Studio onBack={() => setView("landing")} />
  );
}
