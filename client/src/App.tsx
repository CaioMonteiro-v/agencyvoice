import { useEffect, useMemo, useState } from "react";
import {
  cloneVoice,
  deleteVoice,
  generateSpeech,
  getHealth,
  listVoices,
  type VoiceRecord,
} from "./api";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

type View = "landing" | "studio";
type Step = 0 | 1 | 2;

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
          <h3>Três passos. Uma voz de campanha.</h3>
          <p>
            Mesma experiência das plataformas de voice cloning — com motor
            próprio rodando na AgencyVoice AI (XTTS, português nativo).
          </p>
        </div>
        <div className="steps">
          <article className="step">
            <div className="step-num">01</div>
            <h4>Capture o áudio</h4>
            <p>
              Grave no navegador ou envie 1–5 minutos de fala limpa do
              candidato, sem ruído e com um único locutor.
            </p>
          </article>
          <article className="step">
            <div className="step-num">02</div>
            <h4>Clone a voz</h4>
            <p>
              A IA aprende tom, ritmo e timbre. Em segundos você tem um modelo
              vocal pronto para a campanha.
            </p>
          </article>
          <article className="step">
            <div className="step-num">03</div>
            <h4>Gere sob demanda</h4>
            <p>
              Digite o roteiro e produza spots, stories e narrações com a voz
              do candidato — sem remarcar estúdio.
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

function Studio({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [mode, setMode] = useState<"live" | "booting" | "offline" | "demo">(
    "booting"
  );
  const [modeMsg, setModeMsg] = useState("");
  const [device, setDevice] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [script, setScript] = useState(
    "Olá, eu sou candidato a representar você. Juntos vamos transformar nossa cidade."
  );
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(
    null
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const recorder = useAudioRecorder();

  useEffect(() => {
    getHealth()
      .then((h) => {
        setMode(h.mode);
        setModeMsg(h.message);
        setDevice(h.device || "");
      })
      .catch(() => {
        setMode("offline");
        setModeMsg("AgencyVoice AI offline — rode npm run dev.");
      });
    listVoices()
      .then((v) => {
        setVoices(v);
        if (v[0]) setSelectedVoiceId(v[0].id);
      })
      .catch(() => undefined);
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
      setVoices((prev) => [result.voice, ...prev]);
      setSelectedVoiceId(result.voice.id);
      setAlert({ type: "ok", text: result.message });
      setStep(2);
      recorder.clearSamples();
      setConsent(false);
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
      });

      if (result.blob) {
        const url = URL.createObjectURL(result.blob);
        setAudioUrl(url);
        setAlert({
          type: "ok",
          text: "Áudio gerado pela AgencyVoice AI com a voz clonada.",
        });
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

  const handleDelete = async (id: string) => {
    try {
      await deleteVoice(id);
      setVoices((prev) => prev.filter((v) => v.id !== id));
      if (selectedVoiceId === id) {
        setSelectedVoiceId(null);
      }
    } catch (err) {
      setAlert({
        type: "error",
        text: err instanceof Error ? err.message : "Erro ao remover voz.",
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
              ? `AgencyVoice AI · ${device || "pronta"}`
              : mode === "booting"
                ? "Carregando modelo…"
                : "IA offline"}
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

      <nav className="progress" aria-label="Etapas">
        {(
          [
            ["Capturar", "Áudio do candidato"],
            ["Clonar", "Treinar o modelo"],
            ["Gerar", "Texto → fala"],
          ] as const
        ).map(([title, sub], i) => (
          <button
            key={title}
            type="button"
            className={`${step === i ? "active" : ""} ${step > i ? "done" : ""}`}
            onClick={() => setStep(i as Step)}
          >
            <small>0{i + 1}</small>
            <strong>{title}</strong>
            <span style={{ display: "block", color: "var(--muted)", fontSize: "0.78rem" }}>
              {sub}
            </span>
          </button>
        ))}
      </nav>

      {step === 0 && (
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
              <h3
                style={{
                  margin: "0 0 0.75rem",
                  fontFamily: "var(--font-display)",
                  fontSize: "1.1rem",
                }}
              >
                Amostras ({recorder.samples.length})
              </h3>
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
              {(recorder.error || alert) && step === 0 && (
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
                    setStep(1);
                  }}
                >
                  Continuar para clonar
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="panel">
          <h2>Clonar a voz</h2>
          <p className="lead">
            Dê um nome ao perfil vocal e confirme a autorização. A AgencyVoice
            AI cria o clone a partir das suas amostras — sem enviar áudio para
            APIs de terceiros.
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
                  onClick={() => setStep(0)}
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
              {alert && step === 1 && (
                <div className={`alert ${alert.type}`}>{alert.text}</div>
              )}
            </div>
            <div>
              <h3
                style={{
                  margin: "0 0 0.75rem",
                  fontFamily: "var(--font-display)",
                  fontSize: "1.1rem",
                }}
              >
                Vozes salvas
              </h3>
              {voices.length === 0 ? (
                <p className="empty">Nenhuma voz clonada ainda nesta sessão.</p>
              ) : (
                <div className="voice-list">
                  {voices.map((v) => (
                    <div key={v.id} className="voice-item">
                      <div>
                        <strong>{v.name}</strong>
                        <span>
                          {v.engine || "AgencyVoice AI"} · {v.sampleCount} amostra(s)
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: "0.4rem 0.7rem" }}
                        onClick={() => handleDelete(v.id)}
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

      {step === 2 && (
        <section className="panel">
          <h2>Gerar fala</h2>
          <p className="lead">
            Escreva o roteiro e gere o áudio com a voz clonada. Ajuste
            estabilidade e semelhança para o tom da campanha.
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
                      onClick={() => setStep(0)}
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
                  {busy ? "Gerando…" : "Gerar áudio"}
                </button>
              </div>

              {alert && step === 2 && (
                <div className={`alert ${alert.type}`}>{alert.text}</div>
              )}

              {audioUrl && (
                <div className="player-box">
                  <strong>Resultado</strong>
                  <audio src={audioUrl} controls autoPlay />
                  <div className="actions" style={{ marginTop: "0.75rem" }}>
                    <a className="btn btn-ghost" href={audioUrl} download="agencyvoice.wav">
                      Baixar WAV
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3
                style={{
                  margin: "0 0 0.75rem",
                  fontFamily: "var(--font-display)",
                  fontSize: "1.1rem",
                }}
              >
                Dicas de campanha
              </h3>
              <p className="empty" style={{ marginBottom: "0.75rem" }}>
                Use frases curtas e naturais. Ideal: 1–5 min de áudio limpo para
                clone rápido; mais amostras = timbre mais fiel.
              </p>
              <p className="empty">
                Motor:{" "}
                <strong style={{ color: "var(--foam)" }}>
                  agencyvoice-xtts-v2
                </strong>{" "}
                · português nativo · roda na sua infra
                {device ? ` (${device})` : ""}.
              </p>
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
