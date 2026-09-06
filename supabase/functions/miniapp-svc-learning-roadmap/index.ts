import { objectOf } from "./domain.ts";
import { createHandler } from "./handler.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
Deno.serve(
  createHandler({
    serviceKey,
    dispatch: async (userId, action, params) => {
      if (!supabaseUrl || !serviceKey) throw { code: "unavailable" };
      const response = await fetch(
        `${supabaseUrl}/rest/v1/rpc/miniapp_learning_roadmap`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify({
            p_user_id: userId,
            p_action: action,
            p_params: params,
          }),
          signal: AbortSignal.timeout(7000),
        },
      );
      const data = objectOf(await response.json());
      if (!response.ok) throw { code: data.code };
      return data;
    },
  }),
);
