// API layer: typed client with HTTP + demo (mock) implementations.
// At startup we probe the API; if unreachable we swap in the mock client
// (demo mode) so the SPA works standalone.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export type Role = "admin" | "user";

export interface Project {
  id: string;
  name: string;
}

export interface Seed {
  id: string;
  name: string;
  kind: "csv" | "jsonl" | "text" | "connector";
  count: number;
  pii_status: "scanned" | "anonymized" | "pending";
}

export interface LexiconTerm {
  term: string;
  variants: string[];
  count: number;
}

export interface Intent {
  id: string;
  name: string;
  count: number;
  sample_utterances: string[];
}

export interface FlowStep {
  key: string;
  label: string;
}

export interface ResponseSpec {
  schema_version: 1;
  spec_id: string;
  version: number;
  tone: { preset: string; description: string; banned_styles: string[] };
  structure: { flow: string[]; max_sentences: number };
  must_include: string[];
  must_not_include: { topics: string[]; phrases: string[] };
  format: { output: "plain" | "markdown"; max_length_chars: number };
  refusal_policy: { behavior: string; trigger_hints: string[]; message: string };
  examples: {
    id: string;
    intent: string;
    user: string;
    ideal_response: string;
    why: string;
  }[];
}

export interface Assertion {
  scorer: "regex" | "llm_judge";
  pattern?: string;
  negate?: boolean;
  criterion?: string;
  source?: string;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** corruption ops applied to user turns (review inspection) */
  ops?: string[];
  clean?: string;
}

export interface TestCase {
  id: string;
  intent: string;
  persona: { name: string; register: string };
  cmd: number;
  turns: Turn[];
  expected: {
    response: string;
    assertions: Assertion[];
    spec_version: number;
  };
  status: "pending" | "approved" | "rejected";
  testset_id?: string;
}

export interface Testset {
  id: string;
  name: string;
  created_at: string;
  spec_version: number;
  counts: { total: number; approved: number; rejected: number; pending: number };
}

export interface Job {
  id: string;
  kind: "generation" | "anonymize" | "lexicon";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: { done: number; total: number };
  error?: string;
  result?: Record<string, unknown>;
}

export interface GenerationConfig {
  name: string;
  mode: "single_turn" | "multi_turn";
  count: number;
  messiness: "mild" | "moderate" | "heavy";
  cmd: number;
  register: string;
  seed?: number;
}

export interface ApiClient {
  role: () => Role;
  setRole: (r: Role) => void;
  getProject: () => Promise<Project>;
  listSeeds: () => Promise<Seed[]>;
  addSeed: (file: File) => Promise<Seed>;
  listLexicon: () => Promise<LexiconTerm[]>;
  listIntents: () => Promise<Intent[]>;
  getSpec: () => Promise<ResponseSpec>;
  saveSpec: (spec: ResponseSpec) => Promise<ResponseSpec>;
  createGenerationJob: (cfg: GenerationConfig) => Promise<{ id: string; status: string }>;
  getJob: (id: string) => Promise<Job>;
  listCases: () => Promise<TestCase[]>;
  reviewCase: (
    id: string,
    decision: "approve" | "reject" | "edit",
    edits?: { userText?: string; expectedResponse?: string },
  ) => Promise<TestCase>;
  listTestsets: () => Promise<Testset[]>;
}

/* ------------------------------------------------------------------ */
/* HTTP client                                                         */
/* ------------------------------------------------------------------ */

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/v1${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

class HttpApi implements ApiClient {
  roleValue: Role = (localStorage.getItem("role") as Role) || "admin";
  private pid: string | null = null;

  role() {
    return this.roleValue;
  }
  setRole(r: Role) {
    localStorage.setItem("role", r);
    this.roleValue = r;
  }

  /** Resolve (and cache) the current project id — first project in the list. */
  private async project(): Promise<string> {
    if (!this.pid) {
      const ps = await req<Project[]>("/projects");
      if (!ps.length) throw new Error("no projects");
      this.pid = ps[0].id;
    }
    return this.pid;
  }

  async getProject() {
    const ps = await req<Project[]>("/projects");
    if (!ps.length) throw new Error("no projects");
    this.pid = ps[0].id;
    return ps[0];
  }

  async listSeeds() {
    const pid = await this.project();
    const rows = await req<{ id: string; text: string; anon_text: string | null; pii_spans: unknown[] }[]>(
      `/projects/${pid}/seeds`,
    );
    return rows.map(
      (r): Seed => ({
        id: r.id,
        name: r.text.length > 48 ? r.text.slice(0, 48) + "…" : r.text,
        kind: "text",
        count: 1,
        pii_status: r.anon_text ? "anonymized" : (r.pii_spans?.length ?? 0) > 0 ? "scanned" : "pending",
      }),
    );
  }

  async addSeed(file: File) {
    const pid = await this.project();
    const fd = new FormData();
    fd.append("file", file, file.name);
    const res = await fetch(`${BASE}/v1/projects/${pid}/seeds`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const out = (await res.json()) as { ingested: number };
    return {
      id: `batch_${Date.now()}`,
      name: file.name,
      kind: (file.name.endsWith(".csv") ? "csv" : file.name.endsWith(".jsonl") ? "jsonl" : "text") as Seed["kind"],
      count: out.ingested,
      pii_status: "pending" as const,
    };
  }

  async listLexicon() {
    const pid = await this.project();
    const rows = await req<{ term: string; freq: number; variants: string[]; typo_forms: string[] }[]>(
      `/projects/${pid}/lexicon`,
    );
    return rows.map((t) => ({ term: t.term, variants: [...t.variants, ...t.typo_forms], count: t.freq }));
  }

  async listIntents() {
    const pid = await this.project();
    const [rows, seeds] = await Promise.all([
      req<{ id: string; label: string; size: number; exemplar_ids: string[] }[]>(`/projects/${pid}/intents`),
      req<{ id: string; text: string }[]>(`/projects/${pid}/seeds`),
    ]);
    const textOf = new Map(seeds.map((s) => [s.id, s.text]));
    return rows.map((c) => ({
      id: c.id,
      name: c.label,
      count: c.size,
      sample_utterances: c.exemplar_ids.map((id) => textOf.get(id) ?? "").filter(Boolean),
    }));
  }

  async getSpec() {
    const pid = await this.project();
    const rows = await req<{ doc: Record<string, unknown>; version: number; is_active: boolean }[]>(
      `/projects/${pid}/response-specs`,
    );
    const s = rows.find((r) => r.is_active) ?? rows[rows.length - 1];
    if (!s) throw new Error("no response spec yet");
    return fromBackendSpec(s.doc);
  }

  async saveSpec(spec: ResponseSpec) {
    const pid = await this.project();
    const out = await req<{ version: number }>(`/projects/${pid}/response-specs`, {
      method: "POST",
      body: JSON.stringify({ name: spec.spec_id, doc: toBackendSpec(spec) }),
    });
    return { ...spec, version: out.version };
  }

  async createGenerationJob(cfg: GenerationConfig) {
    const pid = await this.project();
    return req<{ id: string; status: string }>(`/projects/${pid}/generation-jobs`, {
      method: "POST",
      body: JSON.stringify({
        mode: cfg.mode,
        count: cfg.count,
        messiness: cfg.messiness,
        cmd: cfg.cmd,
        register: cfg.register,
        seed: cfg.seed ?? 42,
      }),
    });
  }

  async getJob(id: string) {
    const j = await req<{ id: string; type: string; status: Job["status"]; progress: { done: number; total: number }; error: string | null }>(
      `/jobs/${id}`,
    );
    return { ...j, kind: (j.type === "generate" ? "generation" : j.type) as Job["kind"], error: j.error ?? undefined };
  }

  async listCases() {
    const pid = await this.project();
    const rows = await req<BackendCase[]>(`/projects/${pid}/test-cases`);
    return rows.map(fromBackendCase);
  }

  async reviewCase(
    id: string,
    decision: "approve" | "reject" | "edit",
    edits?: { userText?: string; expectedResponse?: string },
  ) {
    const pid = await this.project();
    const body: Record<string, unknown> = { decision };
    if (edits?.userText) body.edits = { user_turns: [{ turn: 1, text: edits.userText }] };
    if (edits?.expectedResponse) body.edits = { ...(body.edits as Record<string, unknown>), expected_response: edits.expectedResponse };
    const c = await req<BackendCase>(`/projects/${pid}/test-cases/${id}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return fromBackendCase(c);
  }

  async listTestsets() {
    const pid = await this.project();
    const rows = await req<{ id: string; name: string; description: string; case_ids: string[] }[]>(
      `/projects/${pid}/testsets`,
    );
    return rows.map(
      (t): Testset => ({
        id: t.id,
        name: t.name,
        created_at: "",
        spec_version: 0,
        counts: { total: t.case_ids.length, approved: 0, rejected: 0, pending: 0 },
      }),
    );
  }
}

/* ---- backend -> UI mappers ---- */

/* eslint-disable @typescript-eslint/no-explicit-any */
type BackendCase = any;

function fromBackendSpec(doc: any): ResponseSpec {
  const topics: string[] = [];
  const phrases: string[] = [];
  for (const m of doc.must_not_include ?? []) {
    if (typeof m === "string") topics.push(m);
    else if (m?.phrase) phrases.push(...(Array.isArray(m.phrase) ? m.phrase : [m.phrase]));
  }
  return {
    schema_version: 1,
    spec_id: doc.spec_id ?? "spec",
    version: doc.version ?? 1,
    tone: {
      preset: doc.tone?.preset ?? "friendly-professional",
      description: doc.tone?.description ?? "",
      banned_styles: doc.tone?.banned_styles ?? [],
    },
    structure: {
      flow: doc.structure?.flow ?? ["acknowledge", "answer", "next_step"],
      max_sentences: doc.structure?.max_sentences ?? 5,
    },
    must_include: doc.must_include ?? [],
    must_not_include: { topics, phrases },
    format: {
      output: doc.format?.output === "markdown" ? "markdown" : "plain",
      max_length_chars: doc.format?.max_length_chars ?? 800,
    },
    refusal_policy: {
      behavior: doc.refusal_policy?.behavior ?? "redirect-to-human",
      trigger_hints: doc.refusal_policy?.trigger_hints ?? [],
      message: doc.refusal_policy?.message ?? "",
    },
    examples: (doc.examples ?? []).map((e: any) => ({
      id: e.id,
      intent: e.intent ?? "",
      user: e.user,
      ideal_response: e.ideal_response,
      why: e.why,
    })),
  };
}

function toBackendSpec(s: ResponseSpec) {
  return {
    schema_version: 1,
    spec_id: s.spec_id,
    tone: s.tone,
    structure: s.structure,
    must_include: s.must_include,
    must_not_include: [
      ...s.must_not_include.topics,
      ...s.must_not_include.phrases.map((p) => ({ phrase: [p] })),
    ],
    format: s.format,
    refusal_policy: s.refusal_policy,
    examples: s.examples,
  };
}

function fromBackendCase(c: BackendCase): TestCase {
  const ops: string[] = (c.transform_trace ?? [])
    .map((t: any) => t.op)
    .filter(Boolean);
  return {
    id: c.id,
    intent: c.intent ?? c.intent_cluster_id ?? "",
    persona: { name: c.persona?.name ?? "user", register: c.persona?.style ?? "chat" },
    cmd: c.cmd ?? 0,
    turns: (c.turns ?? []).map((t: any) => ({
      role: t.role as Turn["role"],
      text: t.text,
      ops,
      clean: t.clean,
    })),
    expected: {
      response: c.expected?.response ?? "",
      assertions: c.expected?.assertions ?? [],
      spec_version: c.expected?.spec_version ?? 0,
    },
    status:
      c.review_state === "approved" || c.review_state === "human_revised"
        ? "approved"
        : c.review_state === "rejected"
          ? "rejected"
          : "pending",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Demo client (in-memory, realistic Hinglish e-commerce data)         */
/* ------------------------------------------------------------------ */

export const DEMO_PROJECT: Project = {
  id: "proj_demo01",
  name: "E-commerce Support Bot",
};

const DEMO_SEEDS: Seed[] = [
  { id: "seed_01", name: "whatsapp_support_logs_jan.csv", kind: "csv", count: 4821, pii_status: "anonymized" },
  { id: "seed_02", name: "zendesk_tickets_q4.jsonl", kind: "jsonl", count: 1932, pii_status: "anonymized" },
  { id: "seed_03", name: "freshdesk_chat_export.txt", kind: "text", count: 640, pii_status: "anonymized" },
  { id: "seed_04", name: "shopify_order_notes.csv", kind: "csv", count: 2210, pii_status: "scanned" },
  { id: "seed_05", name: "agent_handover_notes.txt", kind: "text", count: 118, pii_status: "pending" },
];

const DEMO_LEXICON: LexiconTerm[] = [
  { term: "return", variants: ["return kar sakti hoon", "wapas karna", "give back", "return karna hai"], count: 412 },
  { term: "refund", variants: ["paisa wapas", "refund kab milega", "money back", "refund processing"], count: 387 },
  { term: "delivery", variants: ["deliveri", "delivered nahi hua", "parcel", "shipment"], count: 356 },
  { term: "COD", variants: ["cash on delivery", "cod order", "cash dene wala"], count: 203 },
  { term: "warranty", variants: ["warranti", "guarantee", "warranty claim", "damaged piece"], count: 164 },
  { term: "order ID", variants: ["order number", "orderid", "order id bhejo", "ORD-"], count: 512 },
  { term: "tracking", variants: ["track karo", "kahan hai parcel", "tracking link", "awb"], count: 298 },
  { term: "cancel", variants: ["cancel kar do", "order cancel", "cancled"], count: 189 },
  { term: "exchange", variants: ["replace", "exchange karna hai", "size change"], count: 141 },
  { term: "coupon", variants: ["cupon", "discount code", "promo", "offer valid"], count: 97 },
];

const DEMO_INTENTS: Intent[] = [
  {
    id: "int_return",
    name: "return_policy",
    count: 388,
    sample_utterances: [
      "arre yaar 40 din ho gaye delivery ko, return kar sakti hoon kya??",
      "bhai order 35 din purana hai abhi bhi return ho sakta hai?",
      "i want to return this kurti, size issue hai",
    ],
  },
  {
    id: "int_refund",
    name: "refund_status",
    count: 301,
    sample_utterances: [
      "refund abhi tak nahi aaya, 2 week ho gaye!!",
      "paisa wapas kab milega bhai?? cod tha order",
      "where is my refund??? order cancelled 10 din pehle",
    ],
  },
  {
    id: "int_track",
    name: "track_order",
    count: 264,
    sample_utterances: [
      "order kahan hai?? 5 din se out for delivery dikha raha hai",
      "tracking link kaam nahi kar raha",
      "courier ne kaha delivered but mila nahi",
    ],
  },
  {
    id: "int_warranty",
    name: "warranty_claim",
    count: 97,
    sample_utterances: [
      "headphone ka left side dead ho gaya, warranty mein replace hoga?",
      "1 month mein hi screen crack, warranty cover karta hai kya",
    ],
  },
  {
    id: "int_cancel",
    name: "cancel_order",
    count: 118,
    sample_utterances: [
      "order cancel kar do plz, galti se order ho gaya",
      "cancel karna hai abhi, address galat tha",
    ],
  },
  {
    id: "int_chitchat",
    name: "greet_chitchat",
    count: 52,
    sample_utterances: ["hello kaise ho", "kya haal hai bot ji"],
  },
];

const DEMO_SPEC: ResponseSpec = {
  schema_version: 1,
  spec_id: "ecommerce-support-bot",
  version: 3,
  tone: {
    preset: "friendly-professional",
    description:
      "Warm, patient, never robotic. Use 'aap' for Hindi words. Keep replies short and reassuring.",
    banned_styles: ["sarcastic", "condescending"],
  },
  structure: { flow: ["acknowledge", "answer", "next_step"], max_sentences: 5 },
  must_include: [
    "return window is 30 days from delivery",
    "refund goes to original payment method within 5-7 business days",
  ],
  must_not_include: {
    topics: ["giving legal advice about consumer court"],
    phrases: ["as an AI", "I don't know"],
  },
  format: { output: "markdown", max_length_chars: 800 },
  refusal_policy: {
    behavior: "redirect-to-human",
    trigger_hints: ["consumer court", "sue"],
    message: "I'm not able to help with that, but I can connect you to our team.",
  },
  examples: [
    {
      id: "EX-1",
      intent: "return_policy",
      user: "kya main 40 din baad return kar sakta hoon?",
      ideal_response:
        "I understand the concern. Unfortunately, our return window is 30 days from delivery, so this order is not eligible. However, if the item is damaged, warranty claims are still open — would you like me to check?",
      why: "Polite refusal beyond window + cites exact policy + offers alternative.",
    },
  ],
};

const DEMO_CASES: TestCase[] = [
  {
    id: "tc_0192",
    intent: "return_policy",
    persona: { name: "Riya", register: "whatsapp-casual" },
    cmd: 0.35,
    turns: [
      {
        role: "user",
        text: "arre yaar 40 din ho gaye delivery ko, return kar sakti hoon kya??",
        clean: "It has been 40 days since delivery. Can I still return the item?",
        ops: ["code-mix: hi-en", "filler: arre yaar", "punctuation: ??", "informal verb"],
      },
    ],
    expected: {
      response:
        "I understand the concern. Our return window is 30 days from delivery, so this order isn't eligible. If the item is damaged, warranty is still open — want me to check?",
      assertions: [
        { scorer: "regex", pattern: "(30|thirty)\\s+days?", source: "must_include[0]" },
        { scorer: "regex", pattern: "as an AI|I don't know", negate: true },
        { scorer: "llm_judge", criterion: "tone: friendly-professional, never robotic" },
        { scorer: "llm_judge", criterion: "structure: acknowledge → answer → next_step" },
      ],
      spec_version: 3,
    },
    status: "pending",
  },
  {
    id: "tc_0193",
    intent: "refund_status",
    persona: { name: "Aman", register: "sms-terse" },
    cmd: 0.6,
    turns: [
      {
        role: "user",
        text: "bhai refund abhi tak nahi aya... 2 week ho gaye!! paisa wapas kab milega",
        clean: "The refund has not arrived yet. It has been two weeks. When will I get my money back?",
        ops: ["code-mix: hi-en", "typo: aya", "run-on", "casing"],
      },
    ],
    expected: {
      response:
        "Sorry for the wait — refunds go back to the original payment method within 5-7 business days of cancellation. Yours is past that window, so I've escalated it. You'll get an update within 24 hours.",
      assertions: [
        { scorer: "regex", pattern: "5-7 business days", source: "must_include[1]" },
        { scorer: "regex", pattern: "as an AI", negate: true },
        { scorer: "llm_judge", criterion: "tone: friendly-professional, never robotic" },
      ],
      spec_version: 3,
    },
    status: "approved",
  },
  {
    id: "tc_0194",
    intent: "track_order",
    persona: { name: "Priya", register: "email-formal" },
    cmd: 0.2,
    turns: [
      {
        role: "user",
        text: "The tracking link is not working. Order says out for delivery since 5 days, where is my parcel?",
        clean: "The tracking link is not working. The order has said out for delivery for five days. Where is my parcel?",
        ops: ["grammar: dropped auxiliary", "casing"],
      },
    ],
    expected: {
      response:
        "That delay is unusual, sorry about that. I've re-checked the shipment with the courier — it's marked for re-delivery tomorrow. I'm also sending you a fresh tracking link now.",
      assertions: [
        { scorer: "regex", pattern: "as an AI|I don't know", negate: true },
        { scorer: "llm_judge", criterion: "structure: acknowledge → answer → next_step" },
      ],
      spec_version: 3,
    },
    status: "pending",
  },
  {
    id: "tc_0195",
    intent: "warranty_claim",
    persona: { name: "Karan", register: "whatsapp-casual" },
    cmd: 0.75,
    turns: [
      {
        role: "user",
        text: "headphone ka left side bilkul dead ho gaya 1 month mein hi... warranti mein replace hoga kya bhai",
        clean: "The left side of the headphones stopped working within one month. Will it be replaced under warranty?",
        ops: ["code-mix: hi-en", "typo: warranti", "informal: bhai", "run-on"],
      },
    ],
    expected: {
      response:
        "That shouldn't happen so early — sorry! This is covered under the 1-year warranty. I've started a replacement request; you'll get a pickup slot within 48 hours. No repair charges apply.",
      assertions: [
        { scorer: "llm_judge", criterion: "tone: friendly-professional, never robotic" },
        { scorer: "regex", pattern: "as an AI", negate: true },
      ],
      spec_version: 3,
    },
    status: "rejected",
  },
  {
    id: "tc_0196",
    intent: "return_policy",
    persona: { name: "Sana", register: "whatsapp-casual" },
    cmd: 0.5,
    turns: [
      { role: "user", text: "hi, kurti received but size is small... exchange kar sakte hain? M bhej dena", clean: "Hi, I received the kurti but the size is small. Can we exchange it? Please send size M.", ops: ["code-mix: hi-en", "informal shorthand"] },
      { role: "assistant", text: "Sure, exchanges are free within the return window. I've opened an exchange for size M — pickup is scheduled for Thursday.", },
      { role: "user", text: "ok thanks! delivery guy se wahi utha lega?? ya mujhe drop karna padega", clean: "Okay thanks! Will the delivery person pick it up, or do I need to drop it off?", ops: ["code-mix: hi-en", "punctuation: ??"] },
    ],
    expected: {
      response:
        "The courier will pick it up from your address — no drop-off needed. Keep the kurti in its original packaging with the tag on.",
      assertions: [{ scorer: "llm_judge", criterion: "tone: friendly-professional, never robotic" }],
      spec_version: 3,
    },
    status: "pending",
  },
  {
    id: "tc_0197",
    intent: "cancel_order",
    persona: { name: "Vikram", register: "sms-terse" },
    cmd: 0.45,
    turns: [
      {
        role: "user",
        text: "order cancel kar do plz galti se 2 order ho gaye... ek rakhunga bas",
        clean: "Please cancel the order. I placed two orders by mistake. I will keep only one.",
        ops: ["code-mix: hi-en", "ellipsis", "missing punctuation"],
      },
    ],
    expected: {
      response:
        "Done — the duplicate order is cancelled and any payment will be refunded to the original payment method within 5-7 business days. The other order ships as scheduled.",
      assertions: [
        { scorer: "regex", pattern: "5-7 business days", source: "must_include[1]" },
        { scorer: "regex", pattern: "I don't know", negate: true },
      ],
      spec_version: 3,
    },
    status: "pending",
  },
];

const DEMO_TESTSETS: Testset[] = [
  {
    id: "ts_01",
    name: "support-core-v1",
    created_at: "2026-11-18T09:30:00Z",
    spec_version: 3,
    counts: { total: 42, approved: 30, rejected: 6, pending: 6 },
  },
  {
    id: "ts_02",
    name: "refund-heavy-v2",
    created_at: "2026-11-24T14:05:00Z",
    spec_version: 3,
    counts: { total: 18, approved: 11, rejected: 2, pending: 5 },
  },
];

/* Demo store with mutable state for mutations. */
const store = {
  seeds: [...DEMO_SEEDS],
  spec: { ...DEMO_SPEC },
  cases: [...DEMO_CASES],
  testsets: [...DEMO_TESTSETS],
  jobs: new Map<string, Job>(),
  nextJob: 1,
  nextCase: 200,
};

/* Noise generators so newly generated demo cases look plausible. */
const NOISY_TEMPLATES = [
  "arre yaar {days} din ho gaye {topic} ko, {action} kya??",
  "bhai {topic} mein problem hai, {action} ho sakta hai kya... jaldi batao",
  "hi, mujhe {action} karna hai — {topic} wala order, possible hai?",
  "{topic} ka issue hai bhai, {action} nahi hua abhi tak!! help karo",
  "ek min... {topic} order galat aaya, {action} karna padega kya?",
];

const INTENT_TEMPLATES: Record<string, { topic: string; action: string; days: number; response: string; assertion: Assertion[] }> = {
  return_policy: {
    topic: "delivery", action: "return", days: 40,
    response: "I understand. Our return window is 30 days from delivery, so please check your order date. If the item is damaged, warranty is still open — want me to check?",
    assertion: [{ scorer: "regex", pattern: "(30|thirty)\\s+days?", source: "must_include[0]" }],
  },
  refund_status: {
    topic: "refund", action: "escalate", days: 14,
    response: "Sorry for the wait. Refunds go to the original payment method within 5-7 business days. Yours is past that window, so I've escalated it — update within 24 hours.",
    assertion: [{ scorer: "regex", pattern: "5-7 business days", source: "must_include[1]" }],
  },
  track_order: {
    topic: "parcel", action: "track", days: 5,
    response: "Let me check that for you. The shipment is with the courier and marked for re-delivery tomorrow. I'm sending a fresh tracking link now.",
    assertion: [],
  },
  warranty_claim: {
    topic: "product", action: "claim", days: 30,
    response: "That's covered under warranty. I've started a claim — pickup within 48 hours, no charges apply.",
    assertion: [],
  },
  cancel_order: {
    topic: "order", action: "cancel", days: 2,
    response: "Cancelled. Any payment will be refunded to the original payment method within 5-7 business days.",
    assertion: [{ scorer: "regex", pattern: "5-7 business days", source: "must_include[1]" }],
  },
  greet_chitchat: {
    topic: "order", action: "help", days: 1,
    response: "Hi! How can I help you with your order today?",
    assertion: [],
  },
};

const PERSONAS = [
  { name: "Riya", register: "whatsapp-casual" },
  { name: "Aman", register: "sms-terse" },
  { name: "Priya", register: "email-formal" },
  { name: "Karan", register: "whatsapp-casual" },
];

const MESSINESS_OPS: Record<GenerationConfig["messiness"], string[]> = {
  mild: ["casing", "punctuation"],
  moderate: ["casing", "punctuation", "typo", "filler"],
  heavy: ["casing", "punctuation", "typo", "filler", "run-on", "aggressive code-mix", "missing words"],
};

function fill(template: string, topic: string, action: string, days: number): string {
  return template.replace("{topic}", topic).replace("{action}", action).replace("{days}", String(days));
}

function noiseByLevel(base: string, messiness: GenerationConfig["messiness"], cmd: number): string {
  let s = base;
  if (messiness !== "mild") {
    s = s.replace(/[.] /g, Math.random() < 0.5 ? "... " : " ")
         .replace("Can I", Math.random() < 0.7 ? "kar sakti hoon kya" : "Can I")
         .replace("I want to", "mujhe")
         .replace("please", "plz");
  }
  if (messiness === "heavy") {
    s = s.replace("problem", Math.random() < 0.5 ? "problm" : "dikkat")
         .replace("help", Math.random() < 0.5 ? "help yaar" : "help");
    if (cmd > 0.5) s = s.replace("Where is", "kahan hai").replace("When will", "kab");
  }
  return s;
}

class DemoApi implements ApiClient {
  roleValue: Role = "admin";
  role() {
    return this.roleValue;
  }
  setRole(r: Role) {
    this.roleValue = r;
  }
  async getProject() {
    return DEMO_PROJECT;
  }
  async listSeeds() {
    return store.seeds;
  }
  async addSeed(file: File) {
    const name = file.name;
    const kind: Seed["kind"] = name.endsWith(".csv") ? "csv" : name.endsWith(".jsonl") ? "jsonl" : "text";
    const rows = Math.floor(50 + Math.random() * 2000);
    const s: Seed = { id: `seed_${String(store.seeds.length + 1).padStart(2, "0")}`, name, kind, count: rows, pii_status: "pending" };
    store.seeds = [s, ...store.seeds];
    return s;
  }
  async listLexicon() {
    return DEMO_LEXICON;
  }
  async listIntents() {
    return DEMO_INTENTS;
  }
  async getSpec() {
    return store.spec;
  }
  async saveSpec(spec: ResponseSpec) {
    store.spec = { ...spec, version: spec.version + 1 };
    return store.spec;
  }
  async createGenerationJob(cfg: GenerationConfig) {
    const id = `job_${String(store.nextJob++).padStart(3, "0")}`;
    store.jobs.set(id, {
      id,
      kind: "generation",
      status: "running",
      progress: { done: 0, total: cfg.count },
      result: { ...cfg },
    });
    return { id, status: "queued" };
  }
  async getJob(id: string) {
    const job = store.jobs.get(id);
    if (!job) throw new Error("job not found");
    const cfg = job.result as unknown as GenerationConfig;
    // ~5s total for the demo job
    const j = job as Job & { _t0?: number };
    const elapsed = Date.now() - (j._t0 ?? (j._t0 = Date.now()));
    const done = Math.min(cfg.count, Math.floor((elapsed / 5000) * cfg.count));
    job.progress = { done, total: cfg.count };
    if (done >= cfg.count && job.status === "running") {
      job.status = "succeeded";
      this.generateCases(cfg);
    }
    return job;
  }
  generateCases(cfg: GenerationConfig) {
    const intents = DEMO_INTENTS.filter((i) => i.name !== "greet_chitchat");
    const newCases: TestCase[] = [];
    for (let i = 0; i < Math.min(cfg.count, 8); i++) {
      const intent = intents[i % intents.length];
      const t = INTENT_TEMPLATES[intent.name];
      const template = NOISY_TEMPLATES[(store.nextCase + i) % NOISY_TEMPLATES.length];
      const persona = PERSONAS[(store.nextCase + i) % PERSONAS.length];
      const noisy = noiseByLevel(fill(template, t.topic, t.action, t.days), cfg.messiness, cfg.cmd);
      const clean = `Regarding ${t.topic} — I want to ${t.action} the order. It has been ${t.days} days.`;
      const ops = MESSINESS_OPS[cfg.messiness].concat(cfg.cmd > 0.5 ? ["code-mix: hi-en"] : []);
      newCases.push({
        id: `tc_0${store.nextCase + i}`,
        intent: intent.name,
        persona: { name: persona.name, register: cfg.register || persona.register },
        cmd: cfg.cmd,
        turns: [{ role: "user", text: noisy, clean, ops }],
        expected: {
          response: t.response,
          assertions: [
            ...t.assertion,
            { scorer: "regex", pattern: "as an AI", negate: true },
            { scorer: "llm_judge", criterion: `tone: ${store.spec.tone.preset}` },
          ],
          spec_version: store.spec.version,
        },
        status: "pending",
      });
    }
    store.cases = [...newCases, ...store.cases];
  }
  async listCases() {
    return store.cases;
  }
  async reviewCase(id: string, decision: "approve" | "reject" | "edit", edits?: { userText?: string; expectedResponse?: string }) {
    store.cases = store.cases.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c };
      if (decision === "approve") next.status = "approved";
      if (decision === "reject") next.status = "rejected";
      if (decision === "edit") {
        if (edits?.userText) next.turns = next.turns.map((t, i) => (i === 0 && t.role === "user" ? { ...t, text: edits.userText! } : t));
        if (edits?.expectedResponse) next.expected = { ...next.expected, response: edits.expectedResponse };
        next.status = "approved";
      }
      return next;
    });
    return store.cases.find((c) => c.id === id)!;
  }
  async listTestsets() {
    return store.testsets;
  }
}


/* ------------------------------------------------------------------ */
/* Client selection                                                    */
/* ------------------------------------------------------------------ */

export const httpClient: ApiClient = new HttpApi();
export const demoClient: ApiClient = new DemoApi();
export let api: ApiClient = demoClient;
export const demoMode = { value: false };

/** Probe the API at startup; fall back to demo mode if unreachable. */
export async function initApi(): Promise<{ demo: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${BASE}/v1/projects`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      api = httpClient;
      demoMode.value = false;
      return { demo: false };
    }
  } catch {
    /* fall through to demo */
  }
  clearTimeout(timer);
  api = demoClient;
  demoMode.value = true;
  return { demo: true };
}

export { BASE, store };
