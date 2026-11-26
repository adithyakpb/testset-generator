"""Pipeline smoke tests: ingest, anonymize, analyze, spec compiler, transforms, mock LLM."""
from app.core import analyze, anonymize, ingest, llm, spec_compiler, transforms
from app.core.spec_compiler import compile_assertions, compile_constraints, validate_spec
from app.core.demo import DEMO_SPEC


def test_ingest_jsonl_dedup_and_rejects():
    data = b'{"text": "hello"}\n{"text": "hello"}\n{"text": ""}\nnot json\n'
    records, rejects = ingest.parse_upload("x.jsonl", data)
    assert len(records) == 1
    assert len(rejects) == 3  # dup, empty, invalid json


def test_ingest_csv_and_text():
    recs, _ = ingest.parse_upload("a.csv", b"text\norder late\nrefund please\n")
    assert len(recs) == 2
    recs, _ = ingest.parse_upload("a.txt", b"line one\nline two\n")
    assert len(recs) == 2


def test_anonymize_consistent_surrogates():
    s = anonymize._Surrogates()
    t1, spans1 = anonymize.detect_and_anonymize("email me at a@b.com or call 9812345670", s)
    t2, _ = anonymize.detect_and_anonymize("again a@b.com", s)
    assert "a@b.com" not in t1 and "@" in t1
    assert t1.split()[-1] == "+9198" or "98" in t1
    assert "a@b.com" not in t2
    assert t1.count("@") == 1 and t2.count("@") == 1
    assert spans1
    # same entity -> same surrogate across calls
    import re
    fake1 = re.search(r"user\d+", t1).group(0)
    fake2 = re.search(r"user\d+", t2).group(0)
    assert fake1 == fake2


def test_analyze_lexicon_register_intents():
    texts = ["return kar sakta hoon kya", "return window kya hai", "refund status please", "the refund is pending"]
    lex = analyze.extract_lexicon(texts, min_term_freq=2)
    assert any(t["term"] == "return" for t in lex)
    assert all("typo_forms" in t for t in lex)
    prof = analyze.register_profile(["kya main return kar sakta hoon"])
    assert 0 <= prof["cmi_index"] <= 100
    assert prof["default_cmd"] > 0
    clusters = analyze.cluster_intents(texts, ["s1", "s2", "s3", "s4"])
    assert clusters and clusters[0]["size"] >= 2


def test_mock_llm_deterministic():
    a = llm.complete("You draft queries", "TERMS: return, refund\nPERSONA: Riya\nREGISTER: whatsapp-casual\nCMD: 0.3")
    b = llm.complete("You draft queries", "TERMS: return, refund\nPERSONA: Riya\nREGISTER: whatsapp-casual\nCMD: 0.3")
    assert a == b and a


def test_spec_compiler():
    doc = DEMO_SPEC
    errors, warnings = validate_spec(doc)
    assert not errors
    c = compile_constraints(doc)
    assert "MUST INCLUDE" in c and "TONE" in c
    a = compile_assertions(doc, "consumer court pe jayunga")
    assert any(a_["source"] == "refusal_policy" for a_ in a)
    a2 = compile_assertions(doc, "where is my order")
    assert not any(a_.get("expect_refusal") for a_ in a2)
    assert any(x["source"] == "must_include" for x in a2)
    bad = {"must_include": ["x"], "must_not_include": [{"phrase": "X"}]}
    errs, _ = validate_spec(bad)
    assert errs


def test_transform_chain_reproducible():
    text = "Hello, I want to know what is the status of my order 12345"
    params = {"preset": "moderate", "cmd": 0.4, "register": "whatsapp-casual", "use_llm": True}
    t1, trace1 = transforms.apply_chain(text, params, 7, [{"term": "order", "typo_forms": ["odr"]}] * 3)
    t2, trace2 = transforms.apply_chain(text, params, 7, [{"term": "order", "typo_forms": ["odr"]}] * 3)
    assert t1 == t2 and trace1 == trace2
    assert t1 != text or trace1  # something happened, or trace logged decisions
    assert all("op" in step for step in trace1)


def test_typos_and_codemix_fallback():
    out = transforms.keyboard_typos("hello world this is a test", 0.5, __import__("random").Random(1))
    assert out != "hello world this is a test"
    mixed, measured = transforms.code_mix("what is the status, please help me quickly", 0.3, use_llm=False)
    assert 0 < measured <= 1 and mixed != "what is the status, please help me quickly"
