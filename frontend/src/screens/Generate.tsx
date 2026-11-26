import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type GenerationConfig, type Job } from "../api";
import { Badge, Button, Card, Progress } from "../ui";

const MESSY: { key: GenerationConfig["messiness"]; label: string; desc: string }[] = [
  { key: "mild", label: "Mild", desc: "casing & punctuation slips only" },
  { key: "moderate", label: "Moderate", desc: "+ typos, fillers, informal phrasing" },
  { key: "heavy", label: "Heavy", desc: "+ run-ons, aggressive code-mix, missing words" },
];

export default function Generate() {
  const intents = useQuery({ queryKey: ["intents"], queryFn: () => api.listIntents() });
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState<GenerationConfig>({
    name: "support-batch",
    mode: "single_turn",
    count: 200,
    messiness: "moderate",
    cmd: 0.35,
    register: "whatsapp-casual",
  });
  const [job, setJob] = useState<Job | null>(null);

  const submit = useMutation({
    mutationFn: (c: GenerationConfig) => api.createGenerationJob(c),
    onSuccess: async (r) => {
      setStep(2);
      poll(r.id);
    },
  });

  async function poll(id: string) {
    const j = await api.getJob(id);
    setJob(j);
    if (j.status === "running" || j.status === "queued") setTimeout(() => void poll(id), 400);
  }

  const set = (patch: Partial<GenerationConfig>) => setCfg({ ...cfg, ...patch });

  return (
    <div>
      <h1>Generate test cases</h1>
      <p>Configure a generation batch. Runs as an async job — progress polls below.</p>

      <Card title="1 · Mode & volume">
        <div className="field">
          <label className="fld">Conversation mode</label>
          <div className="segmented">
            <button className={cfg.mode === "single_turn" ? "on" : ""} onClick={() => set({ mode: "single_turn" })}>
              Single-turn
            </button>
            <button className={cfg.mode === "multi_turn" ? "on" : ""} onClick={() => set({ mode: "multi_turn" })}>
              Multi-turn
            </button>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="fld">Job name</label>
            <input type="text" value={cfg.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label className="fld">Number of cases: {cfg.count}</label>
            <input type="range" min={10} max={1000} step={10} className="slider" value={cfg.count} onChange={(e) => set({ count: Number(e.target.value) })} />
          </div>
        </div>
      </Card>

      <Card title="2 · Realism controls">
        <label className="fld">Messiness preset</label>
        <div className="steps" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 16 }}>
          {MESSY.map((m) => (
            <div key={m.key} className={`step ${cfg.messiness === m.key ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => set({ messiness: m.key })}>
              <div className="num">{cfg.messiness === m.key ? "●" : "○"}</div>
              <div style={{ fontWeight: 600 }}>{m.label}</div>
              <div className="st">{m.desc}</div>
            </div>
          ))}
        </div>
        <div className="field">
          <label className="fld">
            Code-mixing degree (CMD) <span className="slider-value">{cfg.cmd.toFixed(2)}</span>
          </label>
          <input type="range" min={0} max={1} step={0.05} className="slider" value={cfg.cmd} onChange={(e) => set({ cmd: Number(e.target.value) })} />
          <div className="slider-label">
            <span>0 — monolingual English</span>
            <span>1 — heavily blended Hinglish</span>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 280 }}>
          <label className="fld">Register</label>
          <select value={cfg.register} onChange={(e) => set({ register: e.target.value })}>
            <option value="whatsapp-casual">whatsapp-casual</option>
            <option value="sms-terse">sms-terse</option>
            <option value="email-formal">email-formal</option>
          </select>
        </div>
      </Card>

      <Card
        title="3 · Confirm & run"
        actions={
          <Button variant="primary" disabled={step === 2 || submit.isPending} onClick={() => submit.mutate(cfg)}>
            {submit.isPending ? "Starting…" : "Start generation job"}
          </Button>
        }
      >
        <div className="row-flex">
          <Badge tone="info">{cfg.mode.replace("_", "-")}</Badge>
          <Badge tone="info">{cfg.count} cases</Badge>
          <Badge tone="info">{cfg.messiness}</Badge>
          <Badge tone="info">CMD {cfg.cmd.toFixed(2)}</Badge>
          <Badge tone="info">{cfg.register}</Badge>
        </div>
        <p style={{ fontSize: "0.85rem" }}>
          Seed filter: all {intents.data?.length ?? 0} intents. Deterministic given seed — same config reproduces the same cases.
        </p>
      </Card>

      {step === 2 && job && (
        <Card title={`Job ${job.id}`}>
          {job.status === "succeeded" ? (
            <div className="row-flex">
              <Badge tone="ok">succeeded</Badge>
              <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                {job.progress.total} cases generated → check the <a href="#/review">Review queue</a>.
              </span>
            </div>
          ) : job.status === "failed" ? (
            <Badge tone="bad">failed: {job.error}</Badge>
          ) : (
            <Progress done={job.progress.done} total={job.progress.total} />
          )}
        </Card>
      )}
    </div>
  );
}
