"""Demo seed: small Hinglish e-commerce project so the UI has data at first boot."""
DEMO_TEXTS = [
    "my order 12345 has not arrived yet, it has been 10 days. please help",
    "kya main 40 din baad return kar sakta hoon? order was a kurta",
    "Hi, I received a wrong item in order 98765. I ordered shoes but got sandals",
    "refund kab tak aayega? I returned the phone cover last week",
    "My name is Riya and my email is riya@gmail.com, please update my phone number to +919812345670",
    "the delivery guy did not call me, package showing out for delivery since 3 days",
    "I want to cancel order 55555 and get a refund to my card",
    "payment deduct ho gaya but order confirm nahi hua, bahut dikkat ho rahi hai",
    "do you have this t-shirt in XL size? want to exchange",
    "courier ne bola parcel street pe rakh diya but mujhe kuch nahi mila",
    "invoice chahiye order 71234 ke liye, GST number add karna hai",
    "product quality is very bad, fabric tore after one wash, want refund",
    "can I change delivery address after shipping? order is in transit",
    "app se coupon apply nahi ho raha hai, discount code INVALID dikha raha hai",
    "when will my sofa cover be back in stock? out of stock since long",
    "return window khatam ho gaya but item damaged aaya tha, kya kar sakte hain?",
    "track order 45678 - tracking link not working, showing error",
    "mera refund 15 din se pending hai, bank me credit nahi hua abhi tak",
    "exchange ke liye pickup kab aayega? Yaar jaldi batao please",
    "I was charged twice for the same order, please refund extra payment",
]

DEMO_SPEC = {
    "schema_version": 1,
    "spec_id": "ecommerce-support-bot",
    "version": 1,
    "tone": {
        "preset": "friendly-professional",
        "description": "Warm, patient, never robotic. Use 'aap' for Hindi words.",
        "banned_styles": ["sarcastic", "condescending"],
    },
    "structure": {"flow": ["acknowledge", "answer", "next_step"], "max_sentences": 5},
    "must_include": [
        "return window is 30 days from delivery",
        "refund goes to original payment method within 5-7 business days",
    ],
    "must_not_include": ["giving legal advice about consumer court", {"phrase": "as an AI"}, {"phrase": "I don't know"}],
    "format": {"output": "plain", "max_length_chars": 800},
    "refusal_policy": {
        "behavior": "redirect-to-human",
        "trigger_hints": ["consumer court", "sue"],
        "message": "I'm not able to help with that, but I can connect you to our team.",
    },
    "examples": [
        {
            "id": "EX-1",
            "intent": "return_policy",
            "user": "kya main 40 din baad return kar sakta hoon?",
            "ideal_response": "I understand the concern. Our return window is 30 days from delivery, so this order is not eligible. However, if the item is damaged, warranty claims are still open — would you like me to check?",
            "why": "Polite refusal beyond window + cites exact policy + offers alternative.",
        }
    ],
    "intent_overrides": [],
}


def seed_demo(db) -> str:
    from sqlalchemy import select

    from ..db import Project, ResponseSpec, SeedRecord, id as new_id
    from .ingest import parse_upload

    existing = db.scalar(select(Project).where(Project.name == "Demo — Hinglish E-commerce Support"))
    if existing:
        return existing.id

    import json as _json

    pid = new_id("proj")
    project = Project(id=pid, name="Demo — Hinglish E-commerce Support",
                      settings={"default_cmd": 0.35, "preset": "moderate"})
    db.add(project)
    lines = "\n".join(_json.dumps({"text": t}) for t in DEMO_TEXTS)
    records, _ = parse_upload("demo.jsonl", lines.encode())
    for i, r in enumerate(records):
        db.add(SeedRecord(id=new_id("seed"), project_id=pid, session_id=f"demo-{i}",
                          content_hash=r["content_hash"], text=r["text"], meta=r["meta"]))
    db.add(ResponseSpec(id=new_id("spec"), project_id=pid, name="E-commerce support spec",
                        version=1, doc=DEMO_SPEC, is_active=True))
    db.commit()
    # pre-compute analysis so a fresh install can generate immediately
    from ..jobs import run_analysis
    run_analysis(db, pid)
    return pid
