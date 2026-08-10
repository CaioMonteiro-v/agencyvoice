import { useEffect, useMemo, useState } from "react";
import {
  cloneVoice,
  creationAudioUrl,
  deleteCreation,
  deletePronunciation,
  deleteVoice,
  generateSpeech,
  getHealth,
  listCreations,
  listPronunciations,
  listVoices,
  previewPronunciation,
  savePronunciation,
  type CreationRecord,
  type PronunciationRule,
  type VoiceRecord,
} from "./api";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

type View = "landing" | "studio";
type StudioTab =
  | "capturar"
  | "clonar"
  | "gerar"
  | "criacoes"
  | "vozes"
  | "pronuncia";

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button className="brand" onClick={onClick} type="button" aria-label="AgencyVoice">
      <span className="brand-mark" aria-hidden />
      AgencyVoice
    </button>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <a className="btn btn-ghost" href="#como-funciona">
            Como funciona
          </a>
          <button className="btn btn-primary" type="button" onClick={onStart}>
            Abrir estúdio
          </button>
        </div>
      </header>

      <section className="hero">
        <h1 className="hero-brand">
          Agency<span>Voice</span>
        </h1>
        <h2>Nossa IA. A voz do seu candidato.</h2>
        <p>
          AgencyVoice é uma IA própria de clonagem de voz: capture o áudio,
          treine o perfil vocal e gere spots de campanha sob demanda.
        </p>
        <div className="hero-cta">
          <button className="btn btn-primary" type="button" onClick={onStart}>
            Começar clonagem
          </button>
          <a className="btn btn-ghost" href="#como-funciona">
            Ver o fluxo
          </a>
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

      <section className="section" id="como-funciona">
        <div className="section-head">
          <h3>Clonar, guardar e treinar nomes.</h3>
          <p>
            Biblioteca de vozes, histórico de criações e dicionário de
            pronúncia — para a IA falar nomes da campanha do jeito certo.
          </p>
        </div>
        <div className="steps">
          <article className="step">
            <div className="step-num">01</div>
            <h4>Capture e clone</h4>
            <p>
              Grave ou envie áudio limpo do candidato e salve a voz na
              biblioteca.
            </p>
          </article>
          <article className="step">
            <div className="step-num">02</div>
            <h4>Gere e guarde</h4>
            <p>
              Produza spots e abra a aba Criações para ouvir de novo e baixar.
            </p>
          </article>
          <article className="step">
            <div className="step-num">03</div>
            <h4>Treine nomes</h4>
            <p>
              Cadastre como cada nome deve soar — a síntese aplica o alias
              automaticamente.
            </p>
          </article>
        </div>
      </section>

      <footer className="notice">
        <p>
          <strong>Uso responsável:</strong> clone apenas vozes com autorização
          expressa do titular (o próprio candidato ou representante legal).
          Conteúdo gerado deve seguir a legislação eleitoral e as políticas da
          plataforma de voz utilizada.
        </p>
      </footer>
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

function formatWhen(iso: string) {
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

function Studio({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<StudioTab>("capturar");
  const [mode, setMode] = useState<"live" | "booting" | "offline" | "demo">(
    "booting"
  );
  const [modeMsg, setModeMsg] = useState("");
  const [device, setDevice] = useState<string>("");
  const [provider, setProvider] = useState<"elevenlabs" | "local" | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [creations, setCreations] = useState<CreationRecord[]>([]);
  const [pronunciations, setPronunciations] = useState<PronunciationRule[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
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

  const refreshLibrary = async () => {
    const [v, c, p] = await Promise.all([
      listVoices().catch(() => [] as VoiceRecord[]),
      listCreations().catch(() => [] as CreationRecord[]),
      listPronunciations().catch(() => [] as PronunciationRule[]),
    ]);
    setVoices(v);
    setCreations(c);
    setPronunciations(p);
    setSelectedVoiceId((prev) => prev || v[0]?.id || null);
  };

  useEffect(() => {
    getHealth()
      .then((h) => {
        setMode(h.mode);
        setModeMsg(h.message);
        setDevice(h.device || "");
        setProvider(h.provider || "");
      })
      .catch(() => {
        setMode("offline");
        setModeMsg("Gateway offline — rode npm run dev.");
      });
    refreshLibrary().catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const canClone = useMemo(
    () => name.trim().length > 0 && consent && recorder.samples.length > 0 && !busy,
    [name, consent, recorder.samples.length, busy]
  );

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) || null;

  const handleClone = async () => {
    setAlert(null);
    setBusy(true);
    try {
      const result = await cloneVoice({
        name: name.trim(),
        description: description.trim(),
        consent,
        files: recorder.samples.map((s) => s.file),
      });
      setVoices((prev) => [result.voice, ...prev.filter((v) => v.id !== result.voice.id)]);
      setSelectedVoiceId(result.voice.id);
      setAlert({ type: "ok", text: result.message });
      setTab("gerar");
      recorder.clearSamples();
      setConsent(false);
      await refreshLibrary();
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao clonar voz.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedVoiceId || !script.trim()) return;
    setAlert(null);
    setBusy(true);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const result = await generateSpeech({
        voiceId: selectedVoiceId,
        text: script.trim(),
        stability,
        similarityBoost: similarity,
        title: creationTitle.trim() || undefined,
        save: true,
      });

      if (result.blob) {
        const url = URL.createObjectURL(result.blob);
        setAudioUrl(url);
        setAlert({
          type: "ok",
          text: result.creationId
            ? "Áudio gerado e salvo na aba Criações."
            : "Áudio gerado com a voz clonada.",
        });
        await refreshLibrary();
        return;
      }

      setAlert({
        type: "error",
        text: result.message || "A IA não retornou áudio. Verifique o motor.",
      });
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao gerar áudio.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVoice = async (id: string) => {
    try {
      await deleteVoice(id);
      setVoices((prev) => prev.filter((v) => v.id !== id));
      if (selectedVoiceId === id) setSelectedVoiceId(null);
      setAlert({ type: "ok", text: "Voz removida da biblioteca." });
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao remover voz.",
      });
    }
  };

  const handleDeleteCreation = async (id: string) => {
    try {
      await deleteCreation(id);
      setCreations((prev) => prev.filter((c) => c.id !== id));
      if (playingCreationId === id) setPlayingCreationId(null);
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao remover criação.",
      });
    }
  };

  const handleSavePronunciation = async () => {
    setAlert(null);
    try {
      await savePronunciation({
        word: word.trim(),
        alias: alias.trim(),
        note: note.trim() || undefined,
      });
      setWord("");
      setAlias("");
      setNote("");
      const list = await listPronunciations();
      setPronunciations(list);
      setAlert({
        type: "ok",
        text: "Pronúncia salva. Na próxima geração, nomes serão substituídos pelo alias.",
      });
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao salvar pronúncia.",
      });
    }
  };

  const handlePreview = async () => {
    try {
      const r = await previewPronunciation(previewText || script);
      setPreviewSpoken(r.spoken);
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro no preview.",
      });
    }
  };

  const tabs: Array<[StudioTab, string, string]> = [
    ["capturar", "Capturar", "Áudio"],
    ["clonar", "Clonar", "Treinar"],
    ["gerar", "Gerar", "Texto → fala"],
    ["criacoes", "Criações", "Biblioteca"],
    ["vozes", "Vozes", "Armazenadas"],
    ["pronuncia", "Pronúncia", "Nomes"],
  ];

  return (
    <div className="page studio-shell">
      <header className="studio-header">
        <Brand onClick={onBack} />
        <div className="topbar-actions">
          <span className={`mode-pill ${mode === "live" ? "live" : ""}`}>
            <span className="dot" />
            {mode === "live"
              ? provider === "elevenlabs"
                ? "ElevenLabs conectado"
                : `AgencyVoice AI · ${device || "pronta"}`
              : mode === "booting"
                ? "Carregando…"
                : "Offline"}
          </span>
          <button className="btn btn-ghost" type="button" onClick={onBack}>
            Início
          </button>
        </div>
      </header>

      {modeMsg && (
        <div
          className={`alert ${mode === "live" ? "ok" : mode === "offline" ? "error" : "info"}`}
          style={{ marginBottom: "1rem" }}
        >
          {modeMsg}
        </div>
      )}

      <nav className="progress studio-tabs" aria-label="Abas do estúdio">
        {tabs.map(([id, title, sub]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => {
              setAlert(null);
              setTab(id);
            }}
          >
            <small>{title}</small>
            <strong>{sub}</strong>
          </button>
        ))}
      </nav>

      {tab === "capturar" && (
        <section className="panel">
          <h2>Capturar áudio</h2>
          <p className="lead">
            Grave 1–5 minutos de fala limpa ou envie arquivos (webm, mp3, wav).
            Quanto melhor a amostra, mais fiel o clone.
          </p>
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
                    : "Clique no microfone para gravar"}
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
                Arraste arquivos de áudio ou clique para enviar
              </div>
            </div>

            <div>
              <h3 className="panel-sub">Amostras ({recorder.samples.length})</h3>
              {recorder.samples.length === 0 ? (
                <p className="empty">Nenhuma amostra ainda.</p>
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
              {(recorder.error || alert) && (
                <div className={`alert ${recorder.error ? "error" : alert?.type || "info"}`}>
                  {recorder.error || alert?.text}
                </div>
              )}
              <div className="actions" style={{ marginTop: "1.25rem" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={recorder.samples.length === 0}
                  onClick={() => {
                    setAlert(null);
                    setTab("clonar");
                  }}
                >
                  Continuar para clonar
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "clonar" && (
        <section className="panel">
          <h2>Clonar a voz</h2>
          <p className="lead">
            Dê um nome ao perfil vocal e confirme a autorização. A voz fica
            salva na aba Vozes para reutilizar.
            {provider === "elevenlabs"
              ? " Clonagem via Instant Voice Cloning (ElevenLabs)."
              : " A AgencyVoice AI cria o clone localmente."}
          </p>
          <div className="grid-2">
            <div>
              <div className="field">
                <label htmlFor="voice-name">Nome do candidato / voz</label>
                <input
                  id="voice-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Candidato Silva"
                />
              </div>
              <div className="field">
                <label htmlFor="voice-desc">Descrição (opcional)</label>
                <textarea
                  id="voice-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tom firme, sotaque paulista, ritmo de comício…"
                />
              </div>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Confirmo que tenho autorização legal para capturar e clonar
                  esta voz, e que o uso respeitará a legislação eleitoral e os
                  termos da API de voz.
                </span>
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setTab("capturar")}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canClone}
                  onClick={handleClone}
                >
                  {busy ? "Clonando…" : `Clonar com ${recorder.samples.length} amostra(s)`}
                </button>
              </div>
              {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}
            </div>
            <div>
              <h3 className="panel-sub">Biblioteca rápida</h3>
              {voices.length === 0 ? (
                <p className="empty">Nenhuma voz clonada ainda.</p>
              ) : (
                <div className="voice-list">
                  {voices.slice(0, 6).map((v) => (
                    <div key={v.id} className="voice-item">
                      <div>
                        <strong>{v.name}</strong>
                        <span>
                          {v.engine || "AgencyVoice AI"} · {v.sampleCount} amostra(s)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: "1rem" }}
                onClick={() => setTab("vozes")}
              >
                Ver todas as vozes
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === "gerar" && (
        <section className="panel">
          <h2>Gerar fala</h2>
          <p className="lead">
            Escreva o roteiro, gere o áudio e ele entra automaticamente na aba
            Criações. Nomes cadastrados em Pronúncia são aplicados na síntese.
          </p>
          <div className="grid-2">
            <div>
              <div className="field">
                <label>Voz selecionada</label>
                {voices.length === 0 ? (
                  <p className="empty">
                    Nenhuma voz ainda.{" "}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "0.3rem 0.7rem", display: "inline-flex" }}
                      onClick={() => setTab("capturar")}
                    >
                      Capturar áudio
                    </button>
                  </p>
                ) : (
                  <div className="voice-list">
                    {voices.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`voice-item ${selectedVoiceId === v.id ? "selected" : ""}`}
                        onClick={() => setSelectedVoiceId(v.id)}
                      >
                        <div>
                          <strong>{v.name}</strong>
                          <span>{v.engine || "AgencyVoice AI"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="creation-title">Título da criação (opcional)</label>
                <input
                  id="creation-title"
                  value={creationTitle}
                  onChange={(e) => setCreationTitle(e.target.value)}
                  placeholder="Ex.: Spot rádio 30s — zona norte"
                />
              </div>

              <div className="field">
                <label htmlFor="script">Roteiro</label>
                <textarea
                  id="script"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="Digite o texto que a voz clonada deve falar…"
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
                  disabled={!selectedVoice || !script.trim() || busy}
                  onClick={handleGenerate}
                >
                  {busy ? "Gerando…" : "Gerar e salvar"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setTab("criacoes")}
                >
                  Ver criações
                </button>
              </div>

              {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}

              {audioUrl && (
                <div className="player-box">
                  <strong>Resultado</strong>
                  <audio src={audioUrl} controls autoPlay />
                  <div className="actions" style={{ marginTop: "0.75rem" }}>
                    <a
                      className="btn btn-ghost"
                      href={audioUrl}
                      download={
                        provider === "elevenlabs"
                          ? "agencyvoice.mp3"
                          : "agencyvoice.wav"
                      }
                    >
                      Baixar áudio
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3 className="panel-sub">Dicas</h3>
              <p className="empty" style={{ marginBottom: "0.75rem" }}>
                Cadastre nomes difíceis na aba Pronúncia (ex.: &quot;João&quot; →
                &quot;Juão&quot;) antes de gerar.
              </p>
              <p className="empty">
                Motor:{" "}
                <strong style={{ color: "var(--foam)" }}>
                  {provider === "elevenlabs"
                    ? "elevenlabs · eleven_multilingual_v2"
                    : "agencyvoice-xtts-v2"}
                </strong>
                {device ? ` (${device})` : ""}.
              </p>
              {pronunciations.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <h3 className="panel-sub">Regras ativas ({pronunciations.length})</h3>
                  <ul className="rule-list">
                    {pronunciations.slice(0, 8).map((r) => (
                      <li key={r.id}>
                        <strong>{r.word}</strong> → {r.alias}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "criacoes" && (
        <section className="panel">
          <h2>Criações</h2>
          <p className="lead">
            Histórico dos áudios gerados. Clique para ouvir de novo, baixar ou
            excluir.
          </p>
          {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}
          {creations.length === 0 ? (
            <p className="empty">
              Nenhuma criação ainda. Gere um áudio na aba Gerar.
            </p>
          ) : (
            <div className="creation-list">
              {creations.map((c) => (
                <article key={c.id} className="creation-item">
                  <div className="creation-meta">
                    <strong>{c.title}</strong>
                    <span>
                      {c.voiceName} · {formatWhen(c.createdAt)} · {c.provider}
                    </span>
                    <p>{c.text}</p>
                    {c.textSpoken !== c.text && (
                      <p className="spoken-hint">Falado como: {c.textSpoken}</p>
                    )}
                  </div>
                  <div className="creation-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "0.45rem 0.85rem" }}
                      onClick={() =>
                        setPlayingCreationId((prev) => (prev === c.id ? null : c.id))
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
                      onClick={() => handleDeleteCreation(c.id)}
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
          <div className="actions" style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTab("gerar")}
            >
              Nova geração
            </button>
          </div>
        </section>
      )}

      {tab === "vozes" && (
        <section className="panel">
          <h2>Biblioteca de vozes</h2>
          <p className="lead">
            Vozes clonadas e sincronizadas. Selecione uma para gerar ou remova
            as que não precisa mais.
          </p>
          {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}
          {voices.length === 0 ? (
            <p className="empty">
              Biblioteca vazia. Clone a primeira voz nas abas Capturar → Clonar.
            </p>
          ) : (
            <div className="voice-list voice-library">
              {voices.map((v) => (
                <div
                  key={v.id}
                  className={`voice-item ${selectedVoiceId === v.id ? "selected" : ""}`}
                >
                  <div>
                    <strong>{v.name}</strong>
                    <span>
                      {v.provider || "local"} · {v.engine || "—"} ·{" "}
                      {v.sampleCount} amostra(s)
                      {v.createdAt ? ` · ${formatWhen(v.createdAt)}` : ""}
                    </span>
                    {v.description && <span>{v.description}</span>}
                  </div>
                  <div className="voice-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "0.4rem 0.75rem" }}
                      onClick={() => {
                        setSelectedVoiceId(v.id);
                        setTab("gerar");
                      }}
                    >
                      Usar
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: "0.4rem 0.75rem" }}
                      onClick={() => handleDeleteVoice(v.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="actions" style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => refreshLibrary()}
            >
              Atualizar biblioteca
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTab("capturar")}
            >
              Clonar nova voz
            </button>
          </div>
        </section>
      )}

      {tab === "pronuncia" && (
        <section className="panel">
          <h2>Treinar pronúncia de nomes</h2>
          <p className="lead">
            Cadastre como a voz deve falar nomes e termos da campanha. Na
            geração, a palavra escrita é trocada pelo alias fonético antes do
            TTS.
          </p>
          <div className="grid-2">
            <div>
              <div className="field">
                <label htmlFor="pr-word">Nome / palavra escrita</label>
                <input
                  id="pr-word"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="Ex.: Xi Jinping"
                />
              </div>
              <div className="field">
                <label htmlFor="pr-alias">Como deve soar (fonética aproximada)</label>
                <input
                  id="pr-alias"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Ex.: Chi Chin ping"
                />
              </div>
              <div className="field">
                <label htmlFor="pr-note">Nota (opcional)</label>
                <input
                  id="pr-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex.: nome do aliado / cidade"
                />
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!word.trim() || !alias.trim()}
                  onClick={handleSavePronunciation}
                >
                  Salvar pronúncia
                </button>
              </div>
              {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}

              <div className="field" style={{ marginTop: "1.5rem" }}>
                <label htmlFor="pr-preview">Prévia no texto</label>
                <textarea
                  id="pr-preview"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="Cole um trecho do roteiro para ver como ficará falado…"
                />
              </div>
              <div className="actions">
                <button type="button" className="btn btn-ghost" onClick={handlePreview}>
                  Aplicar regras
                </button>
              </div>
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
                <p className="empty">
                  Ainda sem regras. Ex.: &quot;Guarujá&quot; → &quot;Guaruujá&quot;.
                </p>
              ) : (
                <div className="voice-list">
                  {pronunciations.map((r) => (
                    <div key={r.id} className="voice-item">
                      <div>
                        <strong>
                          {r.word} → {r.alias}
                        </strong>
                        <span>{r.note || "Sem nota"}</span>
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
