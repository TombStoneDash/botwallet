export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
      <div style={{ maxWidth: "600px" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>
          BotWall3t
        </h1>
        <p style={{ fontSize: "1.1rem", color: "#888", marginBottom: "2rem" }}>
          Give your bot its own money. Don&apos;t share your CC.
        </p>

        <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: "8px", padding: "1.5rem", textAlign: "left", marginBottom: "2rem" }}>
          <pre style={{ fontSize: "0.8rem", color: "#00ff88", overflow: "auto", margin: 0, lineHeight: 1.6 }}>
{`// Register your agent
POST /api/v1/register
{ "owner_email": "you@example.com",
  "agent_name": "Daisy" }
→ { "api_key": "bw_abc123..." }

// Fund the wallet
POST /api/v1/fund
{ "agent_id": "...", "amount": 20.00 }
→ { "funded": true, "amount": "$20.00" }

// Agent spends (policy-checked)
POST /api/v1/spend
Authorization: Bearer bw_abc123...
{ "amount": 5.00,
  "merchant": "openai.com",
  "description": "GPT-4o API call" }
→ { "status": "completed",
    "remaining": "$15.00" }`}
          </pre>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
          <Feature title="Double-Entry Ledger" desc="Real accounting. Every transaction balances to zero." />
          <Feature title="Policy Engine" desc="Merchant allowlists, spending caps, auto-approve thresholds." />
          <Feature title="Gift Links" desc="'Fund Daisy $20' — shareable URLs for agent funding." />
          <Feature title="Full Audit Trail" desc="Every spend tied to agent, task, and policy decision." />
        </div>

        <div style={{ fontSize: "0.7rem", color: "#444", marginTop: "2rem" }}>
          <p>Part of <a href="https://noui.bot" style={{ color: "#555" }}>noui.bot</a> — agent-first infrastructure</p>
          <p style={{ marginTop: "0.5rem" }}>
            <a href="/api/v1" style={{ color: "#555" }}>API Index</a>
            {" · "}
            <a href="https://github.com/TombStoneDash/botwallet" style={{ color: "#555" }}>GitHub</a>
            {" · "}
            <a href="https://noui.bot/docs" style={{ color: "#555" }}>Docs</a>
          </p>
        </div>
      </div>
    </main>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ backgroundColor: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "1rem", textAlign: "left" }}>
      <div style={{ fontSize: "0.75rem", color: "#00ff88", fontWeight: 700, marginBottom: "0.25rem" }}>{title}</div>
      <div style={{ fontSize: "0.7rem", color: "#666" }}>{desc}</div>
    </div>
  );
}
