import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Seed } from "../api";
import { Badge, Card, Empty } from "../ui";

const KIND_TONE: Record<Seed["pii_status"], "ok" | "warn" | "bad"> = {
  anonymized: "ok",
  scanned: "warn",
  pending: "bad",
};

export default function Data() {
  const qc = useQueryClient();
  const seeds = useQuery({ queryKey: ["seeds"], queryFn: () => api.listSeeds() });
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: (f: File) => api.addSeed(f),
    onSuccess: (s) => {
      setMsg(`Uploaded ${s.name} (${s.count} rows) — queued for PII scan.`);
      qc.invalidateQueries({ queryKey: ["seeds"] });
    },
  });

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      add.mutate(f);
    }
  }

  return (
    <div>
      <h1>Data & Seeds</h1>
      <p>Upload anonymised production data (logs, chats, tickets) as seed material. PII is masked before anything is used.</p>

      <Card title="Upload seed data">
        <div
          className={`dropzone${over ? " over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          Drag & drop <strong>CSV / JSONL / text</strong> files here, or click to browse.
          <div style={{ fontSize: "0.8rem", marginTop: 6 }}>Files are PII-scanned then anonymized automatically.</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.jsonl,.txt,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {msg && <p style={{ color: "var(--ok)" }}>{msg}</p>}
      </Card>

      <Card title="Seed sources">
        {seeds.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !seeds.data?.length ? (
          <Empty>No seeds yet — upload a file to start.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Rows</th>
                <th>PII status</th>
              </tr>
            </thead>
            <tbody>
              {seeds.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.kind}</td>
                  <td>{s.count.toLocaleString()}</td>
                  <td>
                    <Badge tone={KIND_TONE[s.pii_status]}>{s.pii_status}</Badge>
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
