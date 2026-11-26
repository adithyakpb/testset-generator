"""Analyze: domain lexicon (TF n-grams), register profile (CMI-style code-mix
estimate), intent clusters (naive shared-keyword bucketing). No KeyBERT/pgvector.
"""
import re
from collections import Counter

STOP = set("a an the i me my we you your he she it is am are was were be been do does did to of in on for with and or but not this that what where how can could will would should please sir ma'am hi hello hey ok okay so very much at from as by the".split())

# Small transliterated Hindi wordlist (Hinglish) + Devanagari detection
HINGLISH_WORDS = set("""kya hai nahi nahin karo karna kar karke mera meri mere tum aap wo ye bhi to hi na ho hoga hogi chahiye dena dedo return kar sakta sakti hoon hu hu mai main mujhe meraa wapas order orderh delivary delivery yaar arre bhai yaar bhaiya thik theek mat kyun kab kaisa kaisi accha achha nahi ji bolona dekho suno paise paisa rupya rupaya wala wali kar diya dena dikha batao samjha""".split())
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z\u0900-\u097F']+", text.lower())


def extract_lexicon(texts: list[str], min_term_freq: int = 2, ngram_range: tuple[int, int] = (1, 3), top_k: int = 60) -> list[dict]:
    counts: Counter = Counter()
    for t in texts:
        toks = tokenize(t)
        for n in range(ngram_range[0], ngram_range[1] + 1):
            for i in range(len(toks) - n + 1):
                gram = " ".join(toks[i:i + n])
                if any(w in STOP for w in toks[i:i + n]):
                    continue
                counts[gram] += 1
    out = []
    for term, freq in counts.most_common():
        if freq < min_term_freq and len(out) > 10:
            break
        variants = sorted({term, term + "s"} - {term}) if not term.endswith("s") else []
        typo_forms = _typo_forms(term)
        out.append({"term": term, "freq": freq, "variants": variants, "typo_forms": typo_forms})
        if len(out) >= top_k:
            break
    return out


def _typo_forms(term: str) -> list[str]:
    """Deterministic common typo surface forms: transpose / dropped letter."""
    forms = set()
    for w in term.split():
        if len(w) < 4:
            continue
        i = len(w) // 2
        forms.add(w[:i] + w[i + 1] + w[i] + w[i + 1:])  # transpose
        forms.add(w[:i] + w[i + 1:])                    # delete
    return sorted({f for f in forms if f and f != term})


def register_profile(texts: list[str]) -> dict:
    """CMI-style estimate: fraction of tokens that are Hindi-script or transliterated
    Hindi wordlist hits, per CMI = 100 * (Hi + (Hm/2)) / (Hi + Hm + En)."""
    hi = en = mixed_tokens = 0
    for t in texts:
        for tok in tokenize(t):
            if DEVANAGARI_RE.search(tok):
                hi += 1
            elif tok in HINGLISH_WORDS:
                mixed_tokens += 1
            else:
                en += 1
    total = hi + mixed_tokens + en
    hindi_like = hi + mixed_tokens
    cmi = round(100.0 * (hi + mixed_tokens / 2) / total, 2) if total else 0.0
    share = round(hindi_like / total, 3) if total else 0.0
    return {
        "language_pairs": [{"pair": "hi-en", "share": share}] if share > 0.05 else [{"pair": "en", "share": 1.0}],
        "cmi_index": cmi,
        "default_cmd": round(min(0.6, share * 0.9), 3),
        "token_counts": {"hindi_script": hi, "transliterated": mixed_tokens, "english": en},
    }


def cluster_intents(texts: list[str], ids: list[str], min_cluster_size: int = 2, max_clusters: int = 12) -> list[dict]:
    """Thin-slice clustering via a keyword inverted index: every significant
    keyword proposes a bucket of the seeds containing it; buckets are taken
    largest-first and each seed joins at most one cluster. Leftovers -> 'misc'."""
    kw_to_idxs: dict[str, set[int]] = {}
    for idx, t in enumerate(texts):
        toks = {w for w in tokenize(t) if w not in STOP and w not in HINGLISH_WORDS and len(w) > 2}
        for w in toks:
            kw_to_idxs.setdefault(w, set()).add(idx)

    clusters: list[dict] = []
    used: set[int] = set()
    for kw, idxs in sorted(kw_to_idxs.items(), key=lambda kv: -len(kv[1])):
        if len(idxs) < min_cluster_size:
            break
        remaining = idxs - used
        if len(remaining) < min_cluster_size:
            continue
        kw_counts: Counter = Counter()
        for i in remaining:
            kw_counts.update(w for w in tokenize(texts[i]) if w not in STOP and w not in HINGLISH_WORDS)
        clusters.append({
            "label": kw,
            "size": len(remaining),
            "top_terms": [w for w, _ in kw_counts.most_common(8)],
            "exemplar_ids": [ids[i] for i in sorted(remaining)[:10]],
        })
        used |= remaining
        if len(clusters) >= max_clusters:
            break

    leftover = [i for i in range(len(texts)) if i not in used]
    if leftover:
        clusters.append({"label": "misc", "size": len(leftover), "top_terms": [],
                         "exemplar_ids": [ids[i] for i in leftover[:10]]})
    if not clusters:
        clusters = [{"label": "general", "size": len(texts), "top_terms": [], "exemplar_ids": ids[:10]}]
    return clusters
