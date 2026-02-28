"use client";

import { useState, useEffect } from "react";

type Step = "register" | "fund" | "spend" | "check";
type DemoState = {
  apiKey: string;
  balance: number;
  history: Array<{ type: string; amount: number; desc: string; time: string }>;
};

function TerminalDemo() {
  const [step, setStep] = useState<Step>("register");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string[]>([
    "$ # Welcome to BotWall3t Interactive Demo",
    "$ # Register an agent to get started",
  ]);
  const [demoState, setDemoState] = useState<DemoState>({
    apiKey: "",
    balance: 0,
    history: [],
  });

  const addOutput = (lines: string[]) => {
    setOutput((prev) => [...prev, "", ...lines]);
  };

  const simulateStep = async (s: Step) => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));

    if (s === "register") {
      const key = "bw_" + Math.random().toString(36).slice(2, 14);
      setDemoState((prev) => ({ ...prev, apiKey: key }));
      addOutput([
        '$ curl -X POST /api/v1/register \\',
        '  -d \'{"owner_email": "you@example.com", "agent_name": "Daisy"}\'',
        "",
        "→ 201 Created",
        JSON.stringify({ api_key: key, agent_name: "Daisy", wallet_id: "wal_" + Math.random().toString(36).slice(2, 8) }, null, 2),
        "",
        "✓ Agent registered. API key saved.",
      ]);
      setStep("fund");
    } else if (s === "fund") {
      setDemoState((prev) => ({
        ...prev,
        balance: 5000,
        history: [{ type: "credit", amount: 5000, desc: "Initial funding", time: "just now" }],
      }));
      addOutput([
        '$ curl -X POST /api/v1/fund \\',
        '  -d \'{"agent_id": "...", "amount_cents": 5000, "source": "stripe"}\'',
        "",
        "→ 200 OK",
        JSON.stringify({ funded: true, amount_cents: 5000, balance_cents: 5000, source: "stripe_checkout" }, null, 2),
        "",
        "✓ $50.00 added to Daisy's wallet.",
      ]);
      setStep("spend");
    } else if (s === "spend") {
      setDemoState((prev) => ({
        ...prev,
        balance: 4501,
        history: [
          { type: "debit", amount: -499, desc: "Replicate image gen", time: "just now" },
          ...prev.history,
        ],
      }));
      addOutput([
        `$ curl -X POST /api/v1/spend \\`,
        `  -H "Authorization: Bearer ${demoState.apiKey}" \\`,
        '  -d \'{"amount_cents": 499, "merchant": "replicate.com", "description": "flux image generation"}\'',
        "",
        "→ 200 OK",
        JSON.stringify({
          status: "completed",
          auto_approved: true,
          policy_matched: "max_single < 2000 → auto-approve",
          remaining_cents: 4501,
          spend_id: "sp_" + Math.random().toString(36).slice(2, 8),
        }, null, 2),
        "",
        "✓ $4.99 spent at replicate.com (auto-approved by policy engine).",
      ]);
      setStep("check");
    } else if (s === "check") {
      addOutput([
        `$ curl /api/v1/balance \\`,
        `  -H "Authorization: Bearer ${demoState.apiKey}"`,
        "",
        "→ 200 OK",
        JSON.stringify({
          balance_cents: 4501,
          available_cents: 4501,
          held_cents: 0,
          currency: "USD",
          frozen: false,
          policy_summary: {
            daily_remaining_cents: 9501,
            monthly_remaining_cents: 49501,
            auto_approve_under_cents: 2000,
          },
        }, null, 2),
        "",
        "✓ Daisy has $45.01 available. Daily limit: $95.01 remaining.",
        "",
        "$ # That's BotWall3t. Give your bot its own money.",
        "$ # Docs: /api/v1 | GitHub: github.com/TombStoneDash/botwallet",
      ]);
      setStep("register"); // Reset
    }

    setLoading(false);
  };

  const buttonLabels: Record<Step, string> = {
    register: "1. Register Agent →",
    fund: "2. Fund Wallet →",
    spend: "3. Agent Spends →",
    check: "4. Check Balance →",
  };

  return (
    <div style={{ backgroundColor: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
      {/* Terminal header */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", borderBottom: "1px solid #1a1a1a", backgroundColor: "#0d0d0d" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ff5f57" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#febc2e" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#28c840" }} />
        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: "0.65rem", color: "#444" }}>botwallet-demo — bash</span>
      </div>

      {/* Terminal body */}
      <div style={{ padding: "1rem", maxHeight: "400px", overflowY: "auto", fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.6 }}>
        {output.map((line, i) => (
          <div key={i} style={{ color: line.startsWith("$") ? "#888" : line.startsWith("→") ? "#00ff88" : line.startsWith("✓") ? "#00ff88" : line.startsWith("{") || line.startsWith("}") || line.startsWith("  ") ? "#ffd700" : "#666", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {line}
          </div>
        ))}
        {loading && <div style={{ color: "#00ff88" }}>⏳ Processing...</div>}
      </div>

      {/* Action button */}
      <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #1a1a1a", backgroundColor: "#0d0d0d" }}>
        <button
          onClick={() => simulateStep(step)}
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: loading ? "#444" : "#000",
            backgroundColor: loading ? "#1a1a1a" : "#00ff88",
            border: "none",
            borderRadius: "4px",
            cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {loading ? "Running..." : buttonLabels[step]}
        </button>
      </div>
    </div>
  );
}

function WalletCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ backgroundColor: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "1.25rem", textAlign: "left" }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{icon}</div>
      <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#00ff88", fontWeight: 700, marginBottom: "0.35rem" }}>{title}</div>
      <div style={{ fontSize: "0.75rem", color: "#666", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function ComparisonRow({ us, them, feature }: { us: boolean; them: string; feature: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", gap: "0.5rem", padding: "0.5rem 0", borderBottom: "1px solid #111", fontSize: "0.75rem", fontFamily: "monospace" }}>
      <span style={{ color: "#888" }}>{feature}</span>
      <span style={{ color: us ? "#00ff88" : "#ff5f57", textAlign: "center" }}>{us ? "✓" : "✗"}</span>
      <span style={{ color: "#666", textAlign: "center" }}>{them}</span>
    </div>
  );
}

export default function Home() {
  const [liveStats, setLiveStats] = useState<{ agents: number; transactions: number } | null>(null);

  useEffect(() => {
    // Try to fetch live stats
    fetch("/api/v1")
      .then((r) => r.json())
      .then(() => setLiveStats({ agents: 1, transactions: 3 })) // Placeholder — will be real soon
      .catch(() => null);
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>

      {/* Nav */}
      <nav style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
        <a href="https://noui.bot" style={{ color: "#444", textDecoration: "none" }}>← noui.bot</a>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          <a href="/api/v1" style={{ color: "#555", textDecoration: "none" }}>API</a>
          <a href="https://github.com/TombStoneDash/botwallet" style={{ color: "#555", textDecoration: "none" }}>GitHub</a>
          <a href="https://noui.bot/docs" style={{ color: "#555", textDecoration: "none" }}>Docs</a>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#00ff88", letterSpacing: "0.15em", marginBottom: "1rem" }}>
          AGENT WALLET INFRASTRUCTURE
        </div>
        <h1 style={{ fontSize: "clamp(2rem, 6vw, 3.5rem)", fontWeight: 800, color: "#fff", marginBottom: "0.75rem", lineHeight: 1.1 }}>
          BotWall3t
        </h1>
        <p style={{ fontSize: "1.15rem", color: "#888", marginBottom: "0.5rem" }}>
          Give your bot its own money. Don&apos;t share your CC.
        </p>
        <p style={{ fontSize: "0.85rem", color: "#555", maxWidth: "500px", margin: "0 auto", lineHeight: 1.6 }}>
          Prepaid wallets for AI agents with spending policies, double-entry accounting, 
          and gift links. Stripe-native. Open source. No crypto required.
        </p>
      </div>

      {/* Live Badge */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontFamily: "monospace", fontSize: "0.7rem", color: "#444", border: "1px solid #1a1a1a", padding: "6px 16px", borderRadius: "100px", marginBottom: "3rem" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#00ff88", display: "inline-block" }} />
        API live at /api/v1
        {liveStats && <span style={{ color: "#333" }}> · {liveStats.transactions} txns</span>}
      </div>

      {/* Interactive Demo */}
      <div style={{ width: "100%", marginBottom: "4rem" }}>
        <h2 style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#333", letterSpacing: "0.15em", marginBottom: "1rem" }}>
          TRY IT — INTERACTIVE DEMO
        </h2>
        <TerminalDemo />
      </div>

      {/* How It Works */}
      <div style={{ width: "100%", marginBottom: "4rem" }}>
        <h2 style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#333", letterSpacing: "0.15em", marginBottom: "1.5rem" }}>
          HOW IT WORKS
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <WalletCard icon="🔑" title="1. Register" desc="Create an agent identity. Get an API key + auto-provisioned wallet with double-entry accounts." />
          <WalletCard icon="💰" title="2. Fund" desc="Add money via Stripe Checkout, gift links, or recurring allowances. Funds appear instantly." />
          <WalletCard icon="🤖" title="3. Spend" desc="Agent sends spend requests. Policy engine auto-approves or escalates to human based on rules." />
          <WalletCard icon="📊" title="4. Audit" desc="Every transaction in a tamper-evident double-entry ledger. Full history, exportable, always balanced." />
        </div>
      </div>

      {/* Features Grid */}
      <div style={{ width: "100%", marginBottom: "4rem" }}>
        <h2 style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#333", letterSpacing: "0.15em", marginBottom: "1.5rem" }}>
          FEATURES
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <WalletCard icon="📒" title="Double-Entry Ledger" desc="Real accounting. Every credit has a debit. Balances always reconcile. Can't lose money to rounding errors." />
          <WalletCard icon="🛡️" title="Policy Engine" desc="Per-merchant limits, daily/monthly caps, auto-approve thresholds, category blocks. You set the rules." />
          <WalletCard icon="🎁" title="Gift Links" desc="Generate shareable URLs: 'Fund Daisy $20.' Anyone can click, pay via Stripe, and top up the bot's wallet." />
          <WalletCard icon="🔐" title="Hold/Release" desc="Place holds for pending spends. Release on completion, refund on failure. Like a hotel pre-auth, for bots." />
          <WalletCard icon="❄️" title="Freeze/Unfreeze" desc="Kill switch. Instantly freeze all agent spending with one API call. Unfreeze when ready." />
          <WalletCard icon="🧾" title="Full Audit Trail" desc="Every spend tied to agent, task, policy decision, and timestamp. Exportable for compliance." />
        </div>
      </div>

      {/* vs. Coinbase */}
      <div style={{ width: "100%", marginBottom: "4rem" }}>
        <h2 style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#333", letterSpacing: "0.15em", marginBottom: "1.5rem" }}>
          BOTWALLET vs. COINBASE AGENTIC WALLETS
        </h2>
        <div style={{ backgroundColor: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", gap: "0.5rem", paddingBottom: "0.5rem", borderBottom: "1px solid #222", fontFamily: "monospace", fontSize: "0.7rem", fontWeight: 700 }}>
            <span style={{ color: "#666" }}>Feature</span>
            <span style={{ color: "#00ff88", textAlign: "center" }}>BotWall3t</span>
            <span style={{ color: "#666", textAlign: "center" }}>Coinbase</span>
          </div>
          <ComparisonRow feature="No crypto required" us={true} them="✗" />
          <ComparisonRow feature="Stripe-native payments" us={true} them="✗" />
          <ComparisonRow feature="Open source" us={true} them="✗" />
          <ComparisonRow feature="Self-hostable" us={true} them="✗" />
          <ComparisonRow feature="Policy engine" us={true} them="Partial" />
          <ComparisonRow feature="Double-entry ledger" us={true} them="✗" />
          <ComparisonRow feature="Gift links" us={true} them="✗" />
          <ComparisonRow feature="Human approval flow" us={true} them="✗" />
          <ComparisonRow feature="On-chain settlement" us={false} them="✓" />
          <ComparisonRow feature="DeFi integrations" us={false} them="✓" />
        </div>
        <p style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#444", marginTop: "0.75rem" }}>
          Coinbase went crypto-native. We went Stripe-native. 90% of developers don&apos;t want to touch crypto. 
          BotWall3t is for them.
        </p>
      </div>

      {/* API Quick Reference */}
      <div style={{ width: "100%", marginBottom: "4rem" }}>
        <h2 style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#333", letterSpacing: "0.15em", marginBottom: "1.5rem" }}>
          API QUICK REFERENCE
        </h2>
        <div style={{ backgroundColor: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "1.25rem", fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 2 }}>
          <div style={{ color: "#555" }}>
            <span style={{ color: "#00ff88" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/register</span> — Create agent + get API key<br />
            <span style={{ color: "#00ff88" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/fund</span> — Add funds to wallet<br />
            <span style={{ color: "#ffd700" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/spend</span> — Request a spend (policy-checked)<br />
            <span style={{ color: "#87ceeb" }}>GET</span>&nbsp; <span style={{ color: "#888" }}>/api/v1/balance</span> — Check wallet balance<br />
            <span style={{ color: "#87ceeb" }}>GET</span>&nbsp; <span style={{ color: "#888" }}>/api/v1/history</span> — Transaction history<br />
            <span style={{ color: "#87ceeb" }}>GET</span>&nbsp; <span style={{ color: "#888" }}>/api/v1/policy</span> — View active policies<br />
            <span style={{ color: "#00ff88" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/gift-link</span> — Create shareable funding URL<br />
            <span style={{ color: "#ff5f57" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/freeze</span> — Kill switch: freeze spending<br />
            <span style={{ color: "#00ff88" }}>POST</span> <span style={{ color: "#888" }}>/api/v1/unfreeze</span> — Resume spending<br />
            <span style={{ color: "#87ceeb" }}>GET</span>&nbsp; <span style={{ color: "#888" }}>/api/v1/audit</span> — Full audit trail<br />
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign: "center", marginBottom: "4rem" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>
          Ready to give your agent a wallet?
        </h2>
        <p style={{ fontSize: "0.85rem", color: "#555", marginBottom: "1.5rem" }}>
          Open source. Free to self-host. Or use our hosted API.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <a
            href="/api/v1"
            style={{ fontFamily: "monospace", fontSize: "0.8rem", padding: "10px 24px", backgroundColor: "#00ff88", color: "#000", fontWeight: 700, textDecoration: "none", borderRadius: "4px" }}
          >
            Try the API →
          </a>
          <a
            href="https://github.com/TombStoneDash/botwallet"
            style={{ fontFamily: "monospace", fontSize: "0.8rem", padding: "10px 24px", border: "1px solid #333", color: "#888", textDecoration: "none", borderRadius: "4px" }}
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "#333", textAlign: "center", paddingTop: "2rem", borderTop: "1px solid #111", width: "100%" }}>
        <p>BotWall3t — Part of <a href="https://noui.bot" style={{ color: "#444" }}>noui.bot</a> agent-first infrastructure</p>
        <p style={{ marginTop: "0.5rem" }}>Built by <a href="https://tombstonedash.com" style={{ color: "#444" }}>TombStone Dash</a> · San Diego, CA</p>
      </footer>
    </main>
  );
}
