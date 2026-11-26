import { useQuery } from "@tanstack/react-query";
import { api, type TestCase } from "../api";
import { Badge, Button, Card, Empty } from "../ui";

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJsonl(cases: TestCase[]): string {
  return cases
    .map((c) =>
      JSON.stringify({
        id: c.id,
        intent: c.intent,
        persona: c.persona,
        cmd: c.cmd,
        turns: c.turns.map((t) => ({ role: t.role, text: t.text })),
        expected: c.expected,
        status: c.status,
      }),
    )
    .join("\n");
}

function exportCsv(cases: TestCase[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [["id", "intent", "persona", "register", "cmd", "user_turns", "expected_response", "status"]];
  for (const c of cases) {
    rows.push([
      c.id,
      c.intent,
      c.persona.name,
      c.persona.register,
      String(c.cmd),
      c.turns.map((t) => `${t.role}: ${t.text}`).join(" | "),
      c.expected.response,
      c.status,
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export default function Testsets() {
  const testsets = useQuery({ queryKey: ["testsets"], queryFn: () => api.listTestsets() });
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.listCases() });

  function doExport(format: "jsonl" | "csv") {
    const cs = (cases.data ?? []).filter((c) => c.status === "approved");
    if (format === "jsonl") download("testset-export.jsonl", exportJsonl(cs), "application/jsonl");
    else download("testset-export.csv", exportCsv(cs), "text/csv");
  }

  return (
    <div>
      <h1>Testsets & Export</h1>
      <p>Named collections of curated cases. Exports carry the response-spec assertions with every case.</p>

      <Card title="Export current approved cases">
        <div className="row-flex">
          <Button variant="primary" onClick={() => doExport("jsonl")}>
            ⬇ Download JSONL
          </Button>
          <Button onClick={() => doExport("csv")}>⬇ Download CSV</Button>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            {(cases.data?.filter((c) => c.status === "approved").length ?? 0)} approved cases included (DeepEval / Promptfoo formats land with the backend).
          </span>
        </div>
      </Card>

      <Card title="Testsets">
        {testsets.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !testsets.data?.length ? (
          <Empty>No testsets yet — approve cases in the review queue and create one.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Spec version</th>
                <th>Total</th>
                <th>Approved</th>
                <th>Rejected</th>
                <th>Pending</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {testsets.data.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td style={{ color: "var(--muted)" }}>{new Date(t.created_at).toLocaleDateString()}</td>
                  <td>
                    <Badge tone="info">spec v{t.spec_version}</Badge>
                  </td>
                  <td>{t.counts.total}</td>
                  <td style={{ color: "var(--ok)" }}>{t.counts.approved}</td>
                  <td style={{ color: "var(--bad)" }}>{t.counts.rejected}</td>
                  <td style={{ color: "var(--warn)" }}>{t.counts.pending}</td>
                  <td>
                    <div className="card-actions">
                      <Button variant="ghost" onClick={() => doExport("jsonl")}>JSONL</Button>
                      <Button variant="ghost" onClick={() => doExport("csv")}>CSV</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
