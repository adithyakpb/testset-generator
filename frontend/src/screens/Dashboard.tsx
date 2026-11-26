import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "../api";
import { Badge, Card } from "../ui";

/** Pipeline step status: in demo mode, derived from mock data. */
function useStepStatus() {
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.listCases() });
  const seeds = useQuery({ queryKey: ["seeds"], queryFn: () => api.listSeeds() });
  const approved = cases.data?.filter((c) => c.status === "approved").length ?? 0;
  return [
    { n: 1, label: "Upload seeds", to: "data", state: (seeds.data?.length ?? 0) > 0 ? "done" : "active", detail: `${seeds.data?.length ?? 0} seed sources` },
    { n: 2, label: "Anonymize", to: "data", state: "done", detail: "4/5 sources anonymized" },
    { n: 3, label: "Analyze", to: "analysis", state: "done", detail: "10 lexicon terms · 6 intents" },
    { n: 4, label: "Response spec", to: "spec", state: "done", detail: "v3 saved" },
    { n: 5, label: "Generate", to: "generate", state: "active", detail: "run the wizard" },
    { n: 6, label: "Review", to: "review", state: approved > 0 ? "active" : "active", detail: `${approved} approved so far` },
    { n: 7, label: "Export", to: "testsets", state: "todo", detail: "JSONL / CSV" },
  ] as const;
}

export default function Dashboard() {
  const { pid = "proj_demo01" } = useParams();
  const steps = useStepStatus();
  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        Pipeline for this project. {demoMode.value && "Running in demo mode with mock data — connect the API for the real thing."}
      </p>
      <Card title="Pipeline">
        <div className="steps">
          {steps.map((s) => (
            <Link key={s.n} to={`/p/${pid}/${s.to}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className={`step ${s.state === "done" ? "done" : s.state === "active" ? "active" : ""}`}>
                <div className="num">{s.state === "done" ? "✓" : s.n}</div>
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="st">{s.detail}</div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Current spec">
          <div className="row-flex">
            <Badge tone="info">v3</Badge>
            <Badge tone="ok">lint clean</Badge>
            <span style={{ color: "var(--muted)", fontSize: "0.86rem" }}>friendly-professional · 2 must-include facts</span>
          </div>
        </Card>
        <Card title="Review queue">
          <div className="row-flex">
            <Badge tone="warn">6 pending</Badge>
            <Badge tone="ok">1 approved</Badge>
            <Badge tone="bad">1 rejected</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}
