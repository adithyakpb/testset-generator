"""Ingest: uploaded file bytes (csv/jsonl/text) -> SeedRecord dicts.

Thin slice: CSV needs a text-ish column (or single col), JSONL rows with
`text` (optionally role/session_id/turn_index), text = one record per line.
Malformed rows are collected as rejects, never silently dropped.
"""
import csv
import hashlib
import io
import json


def parse_upload(filename: str, data: bytes, max_record_chars: int = 8000) -> tuple[list[dict], list[dict]]:
    records: list[dict] = []
    rejects: list[dict] = []
    name = (filename or "").lower()

    def _add(text, idx, **kw):
        text = (text or "").strip()
        if not text or len(text) > max_record_chars:
            rejects.append({"row_index": idx, "reason": "empty or too long", "raw_excerpt": text[:120]})
            return
        records.append({
            "text": text,
            "content_hash": hashlib.sha256(text.encode()).hexdigest()[:16],
            "role": kw.get("role"),
            "turn_index": kw.get("turn_index"),
            "session_id": kw.get("session_id"),
            "meta": kw.get("meta", {"source": name}),
        })

    if name.endswith(".jsonl") or name.endswith(".json"):
        for i, line in enumerate(data.decode("utf-8", errors="replace").splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                rejects.append({"row_index": i, "reason": "invalid json", "raw_excerpt": line[:120]})
                continue
            _add(row.get("text"), i, role=row.get("role"),
                 turn_index=row.get("turn_index"), session_id=row.get("session_id"), meta={"source": name, **{k: v for k, v in row.items() if k not in ("text", "role", "turn_index", "session_id")}})
    elif name.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(data.decode("utf-8", errors="replace")))
        text_col = next((c for c in (reader.fieldnames or []) if c.lower() in ("text", "message", "utterance", "query", "body", "content")), None)
        if reader.fieldnames and len(reader.fieldnames) == 1 and text_col is None:
            text_col = reader.fieldnames[0]
        if text_col is None:
            rejects.append({"row_index": 0, "reason": "no recognizable text column", "raw_excerpt": str(reader.fieldnames)[:120]})
            return records, rejects
        for i, row in enumerate(reader, start=1):
            _add(row.get(text_col), i)
    else:  # plain text: one non-empty line per record
        for i, line in enumerate(data.decode("utf-8", errors="replace").splitlines()):
            _add(line, i)

    # dedup by content hash (keep first)
    seen, deduped = set(), []
    for r in records:
        if r["content_hash"] in seen:
            rejects.append({"row_index": len(deduped), "reason": "duplicate", "raw_excerpt": r["text"][:120]})
            continue
        seen.add(r["content_hash"])
        deduped.append(r)
    return deduped, rejects
