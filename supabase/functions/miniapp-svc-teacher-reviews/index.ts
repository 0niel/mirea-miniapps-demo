import { createClient } from "@supabase/supabase-js";
import { object } from "./domain.ts";
import { createHandler } from "./handler.ts";

const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const client = url && key
  ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;
Deno.serve(
  createHandler(key, async (userId, action, payload = {}, sessionId) => {
    if (!client) throw new Error("Service unavailable");
    const { data, error } = await client.rpc(
      sessionId
        ? "miniapp_teacher_reviews_session_dispatch"
        : "miniapp_teacher_reviews_dispatch",
      {
        p_user_id: userId,
        p_action: action,
        p_payload: payload,
        ...(sessionId ? { p_session_id: sessionId } : {}),
      },
    );
    if (error) throw error;
    return object(data);
  }),
);
