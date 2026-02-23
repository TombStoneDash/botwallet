import { createHash } from "crypto";
import { getClient, T } from "@botwallet/db";

export async function authenticateAgent(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith("bw_")) return null;

  const hash = createHash("sha256").update(apiKey).digest("hex");
  const client = getClient();

  const { data, error } = await client
    .from(T.agents)
    .select("*")
    .eq("api_key_hash", hash)
    .limit(1)
    .single();

  if (error || !data) return null;
  if (data.frozen) return null;

  return data;
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `bw_${random}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = `bw_${random.slice(0, 8)}...`;
  return { key, hash, prefix };
}
