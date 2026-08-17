import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type GitHubClaims = JWTPayload & {
  repository?: string;
  repository_id?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  run_id?: string;
};

type TelegramMessage = {
  message_id?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number; title?: string; type?: string };
  from?: { id?: number; is_bot?: boolean; username?: string; first_name?: string };
};

type TelegramUpdate = { update_id?: number; message?: TelegramMessage; edited_message?: TelegramMessage };

type OutboundRequest = { action?: string; limit?: number };

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const BOT_TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-supabase-runtime";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const AUTONOMOUS_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-autonomous-worker.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const TERMINAL = new Set(["COMPLETE", "BLOCKED", "FAILED"]);
const WEBHOOK_SECRET = await webhookSecret(BOT_TOKEN);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const telegramSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (telegramSecret) {
      if (!constantTimeEqual(telegramSecret, WEBHOOK_SECRET)) return json({ error: "invalid_telegram_secret" }, 401);
      const update = await safeJson<TelegramUpdate>(request);
      return await handleInbound(update);
    }

    const claims = await authenticateGitHub(request);
    const body = await safeJson<OutboundRequest>(request);
    if (body.action !== "deliver_pending") return json({ error: "invalid_action" }, 400);
    const limit = Math.max(1, Math.min(Number(body.limit) || 10, 20));
    const result = await deliverPending(limit, claims);
    return json(result);
  } catch (error) {
    console.error("ai-factory-telegram-hq", safeError(error));
    return json({ error: "telegram_hq_failure", detail: safeError(error) }, 500);
  }
});

async function handleInbound(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;
  if (!message || !Number.isSafeInteger(update.update_id)) return json({ ok: true, ignored: "unsupported_update" });
  if (message.from?.is_bot) return json({ ok: true, ignored: "bot_message" });

  const userId = numberId(message.from?.id, "user_id");
  const chatId = numberId(message.chat?.id, "chat_id");
  const messageId = numberId(message.message_id, "message_id");
  const threadId = Number.isSafeInteger(message.message_thread_id) ? Number(message.message_thread_id) : 1;
  const text = clean(message.text ?? message.caption ?? "", 12000);
  if (!text) return json({ ok: true, ignored: "empty_message" });

  const { data: workspace, error: workspaceError } = await db
    .from("af_telegram_workspaces")
    .select("id,chat_id,owner_user_id,title,enabled")
    .eq("chat_id", chatId)
    .eq("enabled", true)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) return json({ ok: true, ignored: "workspace_not_registered" });
  if (Number(workspace.owner_user_id) !== userId) return json({ ok: true, ignored: "user_not_owner" });

  const { data: topic, error: topicError } = await db
    .from("af_telegram_topics")
    .select("id,topic_key,telegram_thread_id,display_name,route_kind,route_instruction,enabled")
    .eq("workspace_id", workspace.id)
    .eq("telegram_thread_id", threadId)
    .eq("enabled", true)
    .maybeSingle();
  if (topicError) throw topicError;
  if (!topic) {
    await sendTelegram(chatId, threadId, "⚠️ Эта тема пока не подключена к AI Factory.");
    return json({ ok: true, ignored: "topic_not_registered" });
  }

  const raw = JSON.parse(JSON.stringify(update));
  const { error: insertError } = await db.from("af_telegram_messages").insert({
    update_id: update.update_id,
    workspace_id: workspace.id,
    topic_id: topic.id,
    telegram_user_id: userId,
    telegram_chat_id: chatId,
    telegram_message_id: messageId,
    telegram_thread_id: threadId,
    message_text: text,
    status: "RECEIVED",
    raw_update: raw,
  });

  if (insertError) {
    if (String(insertError.code) === "23505") return json({ ok: true, duplicate: true });
    throw insertError;
  }

  const objective = buildObjective({ topic, text, messageId });
  const payload = {
    source: "telegram-hq",
    telegram: {
      update_id: update.update_id,
      chat_id: chatId,
      message_id: messageId,
      thread_id: threadId,
      topic_key: topic.topic_key,
      topic_name: topic.display_name,
      owner_user_id: userId,
    },
    response_contract: {
      output_key: "telegram_posts",
      max_posts: 6,
      post_shape: { agent: "string", text: "string" },
    },
  };

  const { data: runId, error: enqueueError } = await db.rpc("af_enqueue_run", {
    p_objective: objective,
    p_payload: payload,
    p_kind: topic.route_kind,
    p_autonomy_level: "A3",
  });
  if (enqueueError) {
    await db.from("af_telegram_messages").update({ status: "FAILED", delivery_error: { stage: "enqueue", message: enqueueError.message } }).eq("update_id", update.update_id);
    throw enqueueError;
  }

  const { error: linkError } = await db.from("af_telegram_messages")
    .update({ run_id: runId, status: "QUEUED" })
    .eq("update_id", update.update_id);
  if (linkError) throw linkError;

  await sendTelegram(chatId, threadId, `⏳ Принято · ${topic.display_name}\nFactory run: ${String(runId).slice(0, 8)}`);
  return json({ ok: true, queued: true, run_id: runId, topic: topic.topic_key });
}

function buildObjective({ topic, text, messageId }: { topic: any; text: string; messageId: number }) {
  return [
    "You are responding inside the owner's private Telegram AI FACTORY HQ.",
    `ROOM: ${topic.display_name} (${topic.topic_key}).`,
    `ROUTING POLICY: ${topic.route_instruction}`,
    "Use the existing AI Factory executive router, registered agents, skills, evidence rules, memory and bounded autonomy. Activate only the smallest sufficient set of real registered agents/skills; do not stage a fake council.",
    "The owner wants a working-room interaction: agents may disagree, inspect evidence, assign next tasks, propose repairs or product changes, and clearly identify blockers. Preserve Root of Trust and existing autonomy/security gates.",
    "For the Telegram response, put 1-6 concise member contributions in output.telegram_posts. Each item must be {agent:string,text:string}. Only use agents that were actually activated. The final post should state the decision/next action when one exists.",
    `TELEGRAM_MESSAGE_ID: ${messageId}`,
    "USER MESSAGE:",
    text,
  ].join("\n\n");
}

async function deliverPending(limit: number, claims: GitHubClaims) {
  const { data: rows, error } = await db
    .from("af_telegram_messages")
    .select("update_id,telegram_chat_id,telegram_thread_id,telegram_message_id,run_id,status,delivery_attempts,delivered_post_count")
    .eq("status", "QUEUED")
    .not("run_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: any[] = [];
  for (const row of rows ?? []) {
    const { data: run, error: runError } = await db
      .from("af_runs")
      .select("id,status,output,activated_agents,selected_skills,completed_at")
      .eq("id", row.run_id)
      .maybeSingle();
    if (runError) throw runError;
    if (!run || !TERMINAL.has(run.status)) {
      results.push({ update_id: row.update_id, state: "not_terminal" });
      continue;
    }

    const posts = formatPosts(run).slice(0, 6);
    const startAt = Math.max(0, Math.min(Number(row.delivered_post_count) || 0, posts.length));
    const attempts = (Number(row.delivery_attempts) || 0) + 1;
    await db.from("af_telegram_messages").update({ delivery_attempts: attempts, last_delivery_attempt_at: new Date().toISOString() }).eq("update_id", row.update_id);

    let delivered = startAt;
    try {
      for (let i = startAt; i < posts.length; i++) {
        await sendTelegram(Number(row.telegram_chat_id), Number(row.telegram_thread_id), posts[i]);
        delivered = i + 1;
        await db.from("af_telegram_messages").update({ delivered_post_count: delivered, delivery_error: null }).eq("update_id", row.update_id);
      }

      await db.from("af_telegram_messages").update({
        status: "DELIVERED",
        delivered_at: new Date().toISOString(),
        delivered_post_count: delivered,
        delivery_error: null,
      }).eq("update_id", row.update_id);
      results.push({ update_id: row.update_id, state: "delivered", posts: posts.length, run_status: run.status });
    } catch (sendError) {
      const detail = safeError(sendError);
      const terminalFailure = attempts >= 5;
      await db.from("af_telegram_messages").update({
        status: terminalFailure ? "FAILED" : "QUEUED",
        delivered_post_count: delivered,
        delivery_error: {
          code: "TELEGRAM_DELIVERY_FAILURE",
          message: detail,
          attempt: attempts,
          github_run_id: claims.run_id ?? null,
        },
      }).eq("update_id", row.update_id);
      results.push({ update_id: row.update_id, state: terminalFailure ? "failed" : "retry", delivered, error: detail });
    }
  }

  return { ok: true, scanned: rows?.length ?? 0, results };
}

function formatPosts(run: any): string[] {
  const root = objectOrEmpty(run.output);
  const inner = objectOrEmpty(root.output);
  const provided = Array.isArray(inner.telegram_posts) ? inner.telegram_posts : [];
  const posts = provided
    .filter((x: any) => x && typeof x === "object" && clean(x.text, 6000))
    .slice(0, 6)
    .map((x: any) => `${agentPrefix(clean(x.agent, 80))}\n${clean(x.text, 6000)}`);
  if (posts.length) return posts.flatMap(splitTelegramText);

  const decision = clean(root.decision, 7000);
  const nextAction = clean(root.next_action, 4000);
  const status = clean(run.status, 20);
  const agents = Array.isArray(run.activated_agents) ? run.activated_agents.map((x: unknown) => clean(x, 80)).filter(Boolean) : [];
  const lines = [`🏭 AI Factory · ${status}`];
  if (agents.length) lines.push(`Участники: ${agents.join(", ")}`);
  if (decision) lines.push("", decision);
  if (nextAction) lines.push("", `Следующее действие: ${nextAction}`);
  return splitTelegramText(lines.join("\n"));
}

function agentPrefix(agent: string) {
  const a = agent || "AI Factory";
  const lower = a.toLowerCase();
  let emoji = "🤖";
  if (lower.includes("ceo") || lower.includes("executive")) emoji = "🧠";
  else if (lower.includes("research")) emoji = "🔬";
  else if (lower.includes("engineer") || lower.includes("cio") || lower.includes("architect")) emoji = "💻";
  else if (lower.includes("review")) emoji = "🔍";
  else if (lower.includes("sre") || lower.includes("mechanic") || lower.includes("maintenance")) emoji = "🔧";
  else if (lower.includes("memory")) emoji = "📚";
  else if (lower.includes("incident") || lower.includes("risk")) emoji = "🚨";
  else if (lower.includes("cfo")) emoji = "💰";
  else if (lower.includes("product")) emoji = "📦";
  return `${emoji} ${a}`;
}

async function sendTelegram(chatId: number, threadId: number, text: string) {
  const parts = splitTelegramText(text);
  for (const part of parts) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: true,
    };
    if (threadId > 1) payload.message_thread_id = threadId;
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Telegram sendMessage ${response.status}: ${body.slice(0, 800)}`);
  }
}

function splitTelegramText(value: string): string[] {
  const text = clean(value, 24000);
  if (!text) return [];
  const max = 3900;
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < Math.floor(max * 0.6)) cut = rest.lastIndexOf(" ", max);
    if (cut < Math.floor(max * 0.6)) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function authenticateGitHub(request: Request): Promise<GitHubClaims> {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("authorization_required");
  const { payload } = await jwtVerify(match[1], JWKS, { issuer: ISSUER, audience: AUDIENCE });
  const claims = payload as GitHubClaims;
  if (claims.repository !== EXPECTED_REPOSITORY || claims.repository_id !== EXPECTED_REPOSITORY_ID) throw new Error("repository_not_allowed");
  if (claims.ref !== EXPECTED_REF) throw new Error("ref_not_allowed");
  const workflow = claims.job_workflow_ref || claims.workflow_ref;
  if (workflow !== AUTONOMOUS_WORKFLOW) throw new Error("workflow_not_allowed");
  if (!new Set(["schedule", "workflow_dispatch", "push"]).has(String(claims.event_name || ""))) throw new Error("event_not_allowed");
  return claims;
}

async function webhookSecret(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = Array.from(new Uint8Array(digest));
  const binary = bytes.map((b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function adminKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern);
      if (keys?.default) return String(keys.default);
    } catch {}
  }
  return mustEnv("SUPABASE_SERVICE_ROLE_KEY");
}

async function safeJson<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new Error("invalid_json"); }
}

function objectOrEmpty(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function numberId(value: unknown, name: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`${name}_required`);
  return n;
}

function clean(value: unknown, max = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "unknown_error");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
