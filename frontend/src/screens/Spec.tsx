import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ResponseSpec } from "../api";
import { Badge, Button, Card } from "../ui";

const TONE_PRESETS = [
  "friendly-professional",
  "formal",
  "concise-transactional",
  "empathetic-support",
  "playful",
];
const FLOW_STEPS = [
  { key: "acknowledge", label: "Acknowledge" },
  { key: "answer", label: "Answer" },
  { key: "next_step", label: "Next step" },
  { key: "clarify", label: "Clarify" },
  { key: "apologize", label: "Apologize" },
  { key: "escalate", label: "Escalate" },
];

type Draft = ResponseSpec;

function lint(d: Draft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (d.must_include.some((m) => !m.trim())) errors.push("Empty must-include row.");
  const mi = new Set(d.must_include.map((m) => m.trim().toLowerCase()));
  for (const p of d.must_not_include.phrases) if (mi.has(p.trim().toLowerCase())) errors.push(`"${p}" is in both must-include and must-not-include.`);
  for (const t of d.must_not_include.topics) if (mi.has(t.trim().toLowerCase())) errors.push(`"${t}" is in both must-include and must-not-include.`);
  if (new Set(d.must_include.map((m) => m.toLowerCase())).size !== d.must_include.length) warnings.push("Duplicate must-include facts.");
  if (/\b(good|nice)\b/i.test(d.tone.description)) warnings.push('Vague tone description ("good"/"nice") — be specific.');
  for (const m of d.must_include) if (m.length > 200) warnings.push(`Fact longer than 200 chars — likely a paragraph, not a fact: "${m.slice(0, 40)}…"`);
  return { errors, warnings };
}

/** Field-level diff between two spec objects, for the save-preview modal. */
function diffSpec(a: Draft, b: Draft): { field: string; kind: "add" | "del"; text: string }[] {
  const out: { field: string; kind: "add" | "del"; text: string }[] = [];
  const pushList = (field: string, xs: string[], ys: string[]) => {
    for (const x of xs) if (!ys.includes(x)) out.push({ field, kind: "del", text: x });
    for (const y of ys) if (!xs.includes(y)) out.push({ field, kind: "add", text: y });
  };
  if (a.tone.preset !== b.tone.preset || a.tone.description !== b.tone.description) {
    out.push({ field: "tone", kind: "add", text: `${b.tone.preset} — ${b.tone.description}` });
    out.push({ field: "tone", kind: "del", text: `${a.tone.preset} — ${a.tone.description}` });
  }
  pushList("structure.flow", a.structure.flow, b.structure.flow);
  if (a.structure.max_sentences !== b.structure.max_sentences)
    out.push({ field: "structure.max_sentences", kind: "add", text: String(b.structure.max_sentences) }, { field: "structure.max_sentences", kind: "del", text: String(a.structure.max_sentences) });
  pushList("must_include", a.must_include, b.must_include);
  pushList("must_not_include.phrases", a.must_not_include.phrases, b.must_not_include.phrases);
  pushList("must_not_include.topics", a.must_not_include.topics, b.must_not_include.topics);
  if (a.format.output !== b.format.output)
    out.push({ field: "format.output", kind: "add", text: b.format.output }, { field: "format.output", kind: "del", text: a.format.output });
  if (a.format.max_length_chars !== b.format.max_length_chars)
    out.push({ field: "format.max_length_chars", kind: "add", text: String(b.format.max_length_chars) }, { field: "format.max_length_chars", kind: "del", text: String(a.format.max_length_chars) });
  if (a.refusal_policy.message !== b.refusal_policy.message || a.refusal_policy.behavior !== b.refusal_policy.behavior)
    out.push({ field: "refusal_policy", kind: "add", text: `${b.refusal_policy.behavior}: ${b.refusal_policy.message}` });
  return out;
}

function ListBuilder({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="list-builder">
      {items.map((v, i) => (
        <div className="list-row" key={i}>
          <input
            type="text"
            value={v}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove">
            ✕
          </Button>
        </div>
      ))}
      <div>
        <Button variant="ghost" onClick={() => onChange([...items, ""])}>
          + Add row
        </Button>
      </div>
    </div>
  );
}

export default function Spec() {
  const qc = useQueryClient();
  const specQ = useQuery({ queryKey: ["spec"], queryFn: () => api.getSpec() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (specQ.data && !draft) setDraft(structuredClone(specQ.data));
  }, [specQ.data, draft]);

  const save = useMutation({
    mutationFn: (d: Draft) => api.saveSpec(d),
    onSuccess: (s) => {
      setDraft(structuredClone(s));
      setShowDiff(false);
      qc.invalidateQueries({ queryKey: ["spec"] });
    },
  });

  if (specQ.isLoading || !draft) return <p>Loading spec…</p>;
  const d = draft;
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const lintRes = lint(d);
  const diff = specQ.data ? diffSpec(specQ.data, d) : [];

  const toggleFlow = (key: string) => {
    const flow = d.structure.flow.includes(key) ? d.structure.flow.filter((f) => f !== key) : [...d.structure.flow, key];
    set({ structure: { ...d.structure, flow } });
  };

  return (
    <div>
      <div className="row-flex" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Response Spec</h1>
          <p style={{ marginBottom: 0 }}>“This is how I want responses to look.” Saves create a new version.</p>
        </div>
        <div className="row-flex">
          <Badge tone="info">v{d.version}</Badge>
          <Button variant="primary" disabled={lintRes.errors.length > 0 || diff.length === 0} onClick={() => setShowDiff(true)}>
            Save as v{d.version + 1}
          </Button>
        </div>
      </div>

      {lintRes.errors.length > 0 && (
        <div className="card" style={{ borderColor: "var(--bad-border)" }}>
          {lintRes.errors.map((e) => (
            <div key={e} className="err-hint">✕ {e}</div>
          ))}
        </div>
      )}

      <Card title="Tone">
        <div className="grid-2">
          <div className="field">
            <label className="fld">Preset</label>
            <select value={d.tone.preset} onChange={(e) => set({ tone: { ...d.tone, preset: e.target.value } })}>
              {TONE_PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="fld">Banned styles (comma-separated)</label>
            <input
              type="text"
              value={d.tone.banned_styles.join(", ")}
              onChange={(e) => set({ tone: { ...d.tone, banned_styles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })}
            />
          </div>
        </div>
        <div className="field">
          <label className="fld">Describe in your words</label>
          <textarea value={d.tone.description} onChange={(e) => set({ tone: { ...d.tone, description: e.target.value } })} />
        </div>
      </Card>

      <Card title="Structure">
        <label className="fld">Response flow (click to add/remove — order shown is order enforced)</label>
        <div className="row-flex" style={{ marginBottom: 12 }}>
          {FLOW_STEPS.map((s) => (
            <span key={s.key} className={`chip${d.structure.flow.includes(s.key) ? " active" : ""}`} onClick={() => toggleFlow(s.key)}>
              {s.label}
            </span>
          ))}
        </div>
        <div className="field" style={{ maxWidth: 240 }}>
          <label className="fld">Max sentences</label>
          <input
            type="number"
            min={1}
            max={20}
            value={d.structure.max_sentences}
            onChange={(e) => set({ structure: { ...d.structure, max_sentences: Number(e.target.value) || 1 } })}
          />
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Must always include">
          <ListBuilder items={d.must_include} onChange={(must_include) => set({ must_include })} placeholder="e.g. return window is 30 days from delivery" />
        </Card>
        <Card title="Must never include">
          <label className="fld">Topics</label>
          <ListBuilder items={d.must_not_include.topics} onChange={(topics) => set({ must_not_include: { ...d.must_not_include, topics } })} placeholder="e.g. giving legal advice about consumer court" />
          <label className="fld" style={{ marginTop: 12 }}>Phrases</label>
          <ListBuilder items={d.must_not_include.phrases} onChange={(phrases) => set({ must_not_include: { ...d.must_not_include, phrases } })} placeholder="e.g. as an AI" />
        </Card>
      </div>

      <Card title="Format">
        <div className="grid-2">
          <div className="field">
            <label className="fld">Output</label>
            <div className="segmented">
              {(["plain", "markdown"] as const).map((o) => (
                <button key={o} className={d.format.output === o ? "on" : ""} onClick={() => set({ format: { ...d.format, output: o } })}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="fld">Max length: {d.format.max_length_chars} chars</label>
            <input
              type="range"
              min={200}
              max={2000}
              step={100}
              className="slider"
              value={d.format.max_length_chars}
              onChange={(e) => set({ format: { ...d.format, max_length_chars: Number(e.target.value) } })}
            />
          </div>
        </div>
      </Card>

      <Card title="Refusal policy">
        <div className="grid-2">
          <div>
            <label className="fld">When trigger phrases appear, the assistant should…</label>
            <div className="segmented">
              {["refuse-and-redirect", "redirect-to-human", "refuse-only"].map((b) => (
                <button key={b} className={d.refusal_policy.behavior === b ? "on" : ""} onClick={() => set({ refusal_policy: { ...d.refusal_policy, behavior: b } })}>
                  {b}
                </button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="fld">Trigger phrases (comma-separated)</label>
              <input
                type="text"
                value={d.refusal_policy.trigger_hints.join(", ")}
                onChange={(e) => set({ refusal_policy: { ...d.refusal_policy, trigger_hints: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })}
              />
            </div>
          </div>
          <div className="field">
            <label className="fld">Refusal message</label>
            <textarea value={d.refusal_policy.message} onChange={(e) => set({ refusal_policy: { ...d.refusal_policy, message: e.target.value } })} />
          </div>
        </div>
      </Card>

      <Card title={`Golden examples (${d.examples.length})`} actions={<Button variant="ghost" onClick={() => set({ examples: [...d.examples, { id: `EX-${d.examples.length + 1}`, intent: "", user: "", ideal_response: "", why: "" }] })}>+ Add example</Button>}>
        <p style={{ marginTop: 0 }}>Golden pairs anchor generation and calibrate judge assertions.</p>
        {d.examples.map((ex, i) => (
          <div className="ex-card" key={ex.id}>
            <div className="row-flex" style={{ justifyContent: "space-between" }}>
              <Badge tone="info">{ex.id}</Badge>
              <Button variant="ghost" onClick={() => set({ examples: d.examples.filter((_, j) => j !== i) })}>✕ remove</Button>
            </div>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div>
                <label className="fld">Intent</label>
                <input type="text" value={ex.intent} onChange={(e) => set({ examples: d.examples.map((x, j) => (j === i ? { ...x, intent: e.target.value } : x)) })} />
                <label className="fld" style={{ marginTop: 8 }}>User utterance</label>
                <textarea value={ex.user} onChange={(e) => set({ examples: d.examples.map((x, j) => (j === i ? { ...x, user: e.target.value } : x)) })} />
                <label className="fld" style={{ marginTop: 8 }}>Why this is ideal</label>
                <input type="text" value={ex.why} onChange={(e) => set({ examples: d.examples.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)) })} />
              </div>
              <div>
                <label className="fld">Ideal response</label>
                <textarea style={{ minHeight: 130 }} value={ex.ideal_response} onChange={(e) => set({ examples: d.examples.map((x, j) => (j === i ? { ...x, ideal_response: e.target.value } : x)) })} />
              </div>
            </div>
          </div>
        ))}
      </Card>

      {showDiff && (
        <div className="modal-overlay" onClick={() => setShowDiff(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Diff v{d.version} → v{d.version + 1}</h2>
            {diff.length === 0 && <p>No changes.</p>}
            {diff.map((x, i) => (
              <span key={i} className={x.kind === "add" ? "diff-add" : "diff-del"}>
                {x.kind === "add" ? "+" : "−"} [{x.field}] {x.text}
              </span>
            ))}
            <div className="row-flex" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <Button onClick={() => setShowDiff(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => save.mutate(d)}>
                {save.isPending ? "Saving…" : `Create v${d.version + 1}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
