const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SYSTEM_PROMPT = `You are Sarah from the alientime.sg chat support team.

For each user turn, first classify intent into exactly one of:
- General
- Technical
- Special

Definitions:
- Technical: technical aspects/performance/spec details that require expert confirmation (weight, movement, servicing, accuracy, water resistance, parts, measurements, listing-specific factual specs you cannot verify now).
- Special: only these two topics:
  1) best-price topic (asks best/lowest price to buy)
  2) duty-free meaning / import tax / tariff meaning
- General: everything else (normal conversation, unrelated questions, broad watch opinions, greetings, casual chat).

Then respond by rule:
1) Technical -> reply exactly:
I will check with team and revert

2) Special -> decide if user's latest message is a question or an answer:
- If Special + question about best price -> reply exactly:
Maybe you can send here your desired price for the piece?
I'll forward it to the team for review and will revert

- If Special + question about duty free -> reply exactly:
Depending on the states, we would be able to work out an arrangement which we would absorb the duty and tariff for you- esentially what you see here is what you would net pay
The team also shared that we can have the insured priority label ready to go for you.
Follow up also with:
As a Singapore registered business, we don't have the same statutory taxes as the US. Our international clients often benefit from this when purchasing from us.
Which state are you based in now?

- If Special + answer (e.g. gives desired price, state, or short follow-up answer) -> acknowledge briefly and say you'll pass it to team. Keep to 1 sentence.

3) General -> respond like a normal friendly chat support member in 1-3 short sentences and directly answer the user.

Personal-use follow-up rule (high priority):
- If the user indicates they want this for personal use (for me, for myself, personal use, I will wear it, for my wrist, for daily use, for my collection), reply exactly:
Ah lovely, what specifically attracted you to this ?
I personally like it for its colour

Identity policy:
- Never say you are a chatbot, bot, robot, AI, or automated system.
- If asked, present yourself as Sarah from the chat support team.

Important:
- Output ONLY the final customer-facing answer text.
- Never output labels such as General, Technical, Special.
- Classify using ONLY latest user message text.
- Do not let words inside listing titles (for example DUTY FREE in a product name) force Special unless the user is actually asking about duty meaning/tax.
- Do NOT add any greeting prefix yourself. Greeting is handled outside this model.
- Never include meta text like model training cutoff.`;

const memoryBySession = new Map();
const firstReplyDayBySession = new Map();

function getWeekdayUtc() {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[new Date().getUTCDay()];
}

function dayKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeInboundMessage(raw) {
  const input = String(raw || "").trim();
  if (!input) {
    return "";
  }
  const lines = input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (/^\d{1,2}:\d{2}$/.test(s)) return false;
      if (/^-{3,}$/.test(s)) return false;
      if (/^you are trained on data up to/i.test(s)) return false;
      return true;
    });

  const translatedMarkerIdx = lines.map((s) => s.toLowerCase()).lastIndexOf("(translate)");
  if (translatedMarkerIdx >= 0 && lines[translatedMarkerIdx + 1]) {
    return lines[translatedMarkerIdx + 1];
  }
  return lines.length ? lines[lines.length - 1] : input;
}

function stripClassificationPrefix(reply) {
  return String(reply || "")
    .replace(/^(general|technical|special)\s*[—:\-]?\s*/i, "")
    .replace(/^classification\s*[—:\-]?\s*(general|technical|special)\s*[—:\-]?\s*/i, "")
    .trim();
}

function addGreetingAndSignoff(sessionId, replyText) {
  const sid = String(sessionId || "anon");
  const today = dayKeyUtc();
  const wasLastDay = firstReplyDayBySession.get(sid);
  const shouldPrefixToday = wasLastDay !== today;
  firstReplyDayBySession.set(sid, today);

  const signoff = "Sarah\nalientime.sg";
  let cleaned = stripClassificationPrefix(replyText);
  if (!cleaned) {
    cleaned = "I will check with team and revert";
  }

  if (shouldPrefixToday) {
    cleaned = `Hey buddy\nHappy ${getWeekdayUtc()}!\n\n${cleaned}`;
  }
  if (!cleaned.toLowerCase().endsWith(signoff.toLowerCase())) {
    cleaned = `${cleaned}\n${signoff}`;
  }
  return cleaned;
}

function getSessionMessages(sessionId) {
  const sid = String(sessionId || "anon");
  const existing = memoryBySession.get(sid);
  if (existing) {
    return existing;
  }
  const initial = [];
  memoryBySession.set(sid, initial);
  return initial;
}

async function askOpenAi(sessionId, userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const sessionMessages = getSessionMessages(sessionId);
  const historyLimit = Number(process.env.MEMORY_TURNS || 20);
  const boundedHistory = sessionMessages.slice(-historyLimit * 2);
  const messages = [
    { role: "system", content: process.env.CHRONO24_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT },
    ...boundedHistory,
    { role: "user", content: userMessage },
  ];

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid OpenAI response payload");
  }

  const modelReply = parsed?.choices?.[0]?.message?.content;
  const replyText = String(modelReply || "").trim();
  if (!replyText) {
    throw new Error("OpenAI returned empty content");
  }

  sessionMessages.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: replyText }
  );
  if (sessionMessages.length > historyLimit * 4) {
    sessionMessages.splice(0, sessionMessages.length - historyLimit * 4);
  }
  return replyText;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const incomingMessage = normalizeInboundMessage(req.body?.message);
    const sessionId = String(req.body?.sessionId || req.body?.communicationId || "anon");
    if (!incomingMessage) {
      return res.status(400).json({ error: "message is required" });
    }

    const aiReply = await askOpenAi(sessionId, incomingMessage);
    const finalReply = addGreetingAndSignoff(sessionId, aiReply);
    return res.status(200).json({ reply: finalReply });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
}
