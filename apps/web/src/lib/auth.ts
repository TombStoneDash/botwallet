import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { agents } from "@botwallet/db";
import { getDb } from "./db";

/**
 * Authenticate an agent via Bearer token.
 * Returns the agent record or null.
 */
export async function authenticateAgent(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith("bw_")) return null;

  const hash = createHash("sha256").update(apiKey).digest("hex");
  const db = getDb();

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.apiKeyHash, hash))
    .limit(1);

  if (!agent) return null;
  if (agent.frozen) return null;

  return agent;
}

/**
 * Generate a new API key for an agent.
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `bw_${random}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = `bw_${random.slice(0, 8)}...`;
  return { key, hash, prefix };
}
