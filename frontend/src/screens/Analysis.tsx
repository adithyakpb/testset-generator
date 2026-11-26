import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Empty } from "../ui";

export default function Analysis() {
  const [tab, setTab] = useState<"lexicon" | "intents">("lexicon");
  const lexicon = useQuery({ queryKey: ["lexicon"], queryFn: () => api.listLexicon() });
  const intents = useQuery({ queryKey: ["intents"], queryFn: () => api.listIntents() });

  return (
    <div>
      <h1>Analysis</h1>
      <p>Domain vocabulary and intent clusters auto-extracted from the seed data.</p>

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={tab === "lexicon" ? "on" : ""} onClick={() => setTab("lexicon")}>
          Lexicon
        </button>
        <button className={tab === "intents" ? "on" : ""} onClick={() => setTab("intents")}>
          Intents
        </button>
      </div>

      {tab === "lexicon" && (
        <Card
          title="Lexicon terms & variants"
          actions={<Button variant="ghost">Re-extract</Button>}
        >
          {lexicon.isLoading ? (
            <Empty>Loading…</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Variants (incl. Hinglish / misspellings)</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {lexicon.data?.map((t) => (
                  <tr key={t.term}>
                    <td style={{ fontWeight: 600 }}>{t.term}</td>
                    <td>
                      {t.variants.map((v) => (
                        <code key={v} style={{ marginRight: 6 }}>
                          {v}
                        </code>
                      ))}
                    </td>
                    <td>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "intents" && (
        <Card title="Intent clusters">
          {intents.isLoading ? (
            <Empty>Loading…</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {intents.data?.map((i) => (
                <div key={i.id} className="ex-card">
                  <div className="row-flex" style={{ justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong>{i.name}</strong>
                      <Badge tone="info">{i.count} utterances</Badge>
                    </div>
                    <Button variant="ghost" onClick={() => {
                      const name = prompt("Rename intent", i.name);
                      if (name) i.name = name;
                    }}>
                      Rename
                    </Button>
                  </div>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--muted)", fontSize: "0.86rem" }}>
                    {i.sample_utterances.map((u) => (
                      <li key={u}>“{u}”</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
