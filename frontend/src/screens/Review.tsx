import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TestCase } from "../api";
import { Badge, Button, Card, Empty, NoisyText } from "../ui";

function CaseCard({ c }: { c: TestCase }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [userText, setUserText] = useState(c.turns[0]?.text ?? "");
  const [resp, setResp] = useState(c.expected.response);
  const [inspect, setInspect] = useState(false);

  const review = useMutation({
    mutationFn: (args: { decision: "approve" | "reject" | "edit"; edits?: { userText?: string; expectedResponse?: string } }) =>
      api.reviewCase(c.id, args.decision, args.edits),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });

  const statusTone = c.status === "approved" ? "ok" : c.status === "rejected" ? "bad" : "warn";

  return (
    <Card
      title={
        <span className="row-flex">
          <code>{c.id}</code>
          <Badge tone="info">{c.intent}</Badge>
          <Badge>
            {c.persona.name} · {c.persona.register}
          </Badge>
          <Badge>CMD {c.cmd.toFixed(2)}</Badge>
          <Badge tone={statusTone}>{c.status}</Badge>
        </span>
      }
      actions={
        <div className="card-actions">
          <Button variant="primary" onClick={() => review.mutate({ decision: "approve" })} disabled={review.isPending}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => review.mutate({ decision: "reject" })} disabled={review.isPending}>
            Reject
          </Button>
          <Button onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</Button>
        </div>
      }
    >
      <div className="casewalk">
        {c.turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 2 }}>
              {t.role === "user" ? `${c.persona.name} (user)` : "assistant"}
            </div>
            {t.role === "user" ? (
              editing && i === 0 ? (
                <textarea value={userText} onChange={(e) => setUserText(e.target.value)} />
              ) : (
                <div>
                  <NoisyText text={t.text} />
                  {t.clean && (
                    <>
                      {" "}
                      <button className="btn btn-ghost" style={{ padding: "0 6px", fontSize: "0.75rem" }} onClick={() => setInspect(!inspect)}>
                        {inspect ? "hide" : "before/after"}
                      </button>
                    </>
                  )}
                  {inspect && t.clean && (
                    <div style={{ marginTop: 8, fontSize: "0.82rem" }}>
                      <div className="diff-del">clean seed: {t.clean}</div>
                      <div className="diff-add">generated: {t.text}</div>
                      <div style={{ color: "var(--muted)", marginTop: 4 }}>ops: {(t.ops ?? []).join(", ")}</div>
                    </div>
                  )}
                </div>
              )
            ) : (
              t.text
            )}
          </div>
        ))}
      </div>

      {editing ? (
        <div className="field">
          <label className="fld">Expected response</label>
          <textarea value={resp} onChange={(e) => setResp(e.target.value)} style={{ minHeight: 90 }} />
          <div className="row-flex" style={{ marginTop: 8 }}>
            <Button
              variant="primary"
              onClick={() => review.mutate({ decision: "edit", edits: { userText, expectedResponse: resp } })}
              disabled={review.isPending}
            >
              Save edit (approves)
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <label className="fld">Expected response (spec v{c.expected.spec_version})</label>
          <div className="ex-card" style={{ marginBottom: 8 }}>
            {c.expected.response}
          </div>
          <label className="fld">Assertions</label>
          <div className="assertions">
            {c.expected.assertions.map((a, i) => (
              <div key={i} className="assertion">
                <span className="scorer">{a.scorer}</span>
                {a.pattern && <code>{a.negate ? "NOT " : ""}/{a.pattern}/</code>}
                {a.criterion && <span>{a.criterion}</span>}
                {a.source && <span style={{ color: "var(--muted)" }}>← {a.source}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Review() {
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.listCases() });
  const [fIntent, setFIntent] = useState("all");
  const [fStatus, setFStatus] = useState("pending");

  const intents = useMemo(() => Array.from(new Set(cases.data?.map((c) => c.intent) ?? [])), [cases.data]);
  const filtered = cases.data?.filter(
    (c) => (fIntent === "all" || c.intent === fIntent) && (fStatus === "all" || c.status === fStatus),
  );

  return (
    <div>
      <h1>Review queue</h1>
      <p>Approve, reject, or edit generated cases. Approved cases feed exports and can be pinned as spec examples.</p>

      <div className="filters">
        <select value={fIntent} onChange={(e) => setFIntent(e.target.value)}>
          <option value="all">All intents</option>
          {intents.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          {["pending", "approved", "rejected", "all"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem", alignSelf: "center" }}>
          {filtered?.length ?? 0} case{filtered?.length === 1 ? "" : "s"}
        </span>
      </div>

      {cases.isLoading ? (
        <Empty>Loading…</Empty>
      ) : !filtered?.length ? (
        <Empty>No cases match these filters.</Empty>
      ) : (
        filtered.map((c) => <CaseCard key={c.id} c={c} />)
      )}
    </div>
  );
}
