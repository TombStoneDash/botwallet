import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BotWall3t — Agent Wallet & Spend Control",
  description: "Give your bot its own money. Don't share your CC. Fund wallets, set policies, full audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, backgroundColor: "#0a0a0a", color: "#e0e0e0", fontFamily: '"JetBrains Mono", monospace' }}>
        {children}
      </body>
    </html>
  );
}
