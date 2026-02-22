'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface GiftData {
  title: string;
  agent_name: string;
  message: string;
  goal_cents: number | null;
  raised_cents: number;
  active: boolean;
}

export default function GiftPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [gift, setGift] = useState<GiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('10');

  useEffect(() => {
    fetch(`/api/v1/gift-link/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setGift(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <main style={styles.container}>
        <p style={{ color: '#555' }}>Loading...</p>
      </main>
    );
  }

  if (!gift) {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Gift Not Found</h1>
        <p style={{ color: '#666' }}>This gift link doesn&apos;t exist or has expired.</p>
      </main>
    );
  }

  const progress = gift.goal_cents
    ? Math.min(100, Math.round((gift.raised_cents / gift.goal_cents) * 100))
    : null;

  return (
    <main style={styles.container}>
      <div style={{ maxWidth: '500px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>💰</div>
          <h1 style={styles.title}>
            {gift.title || `Fund ${gift.agent_name}`}
          </h1>
          <p style={{ color: '#888', fontSize: '0.9rem' }}>
            {gift.message || `Help ${gift.agent_name} do more.`}
          </p>
        </div>

        {progress !== null && (
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem' }}>
              <span>${(gift.raised_cents / 100).toFixed(2)} raised</span>
              <span>${((gift.goal_cents || 0) / 100).toFixed(2)} goal</span>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#00ff88', width: `${progress}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
            <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#444', marginTop: '0.25rem' }}>
              {progress}% funded
            </div>
          </div>
        )}

        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '1.5rem' }}>
          <label style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginBottom: '0.5rem' }}>
            Amount (USD)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {['5', '10', '20', '50'].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  background: amount === v ? '#00ff88' : '#1a1a1a',
                  color: amount === v ? '#000' : '#888',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: amount === v ? 700 : 400,
                }}
              >
                ${v}
              </button>
            ))}
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            step="0.01"
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#0a0a0a',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#fff',
              fontFamily: 'inherit',
              fontSize: '1.2rem',
              textAlign: 'center',
              marginBottom: '1rem',
              boxSizing: 'border-box',
            }}
          />
          <button
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#00ff88',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: '1rem',
            }}
            onClick={() => {
              // TODO: Stripe Checkout integration
              alert(`Stripe Checkout coming soon! Would fund $${amount} to ${gift.agent_name}.`);
            }}
          >
            Fund ${amount} →
          </button>
          <p style={{ fontSize: '0.65rem', color: '#444', textAlign: 'center', marginTop: '0.75rem' }}>
            Powered by Stripe. Secure checkout.
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.7rem', color: '#333' }}>
          <a href="/" style={{ color: '#444' }}>BotWall3t</a>
          {' · '}
          <a href="https://noui.bot" style={{ color: '#444' }}>noui.bot</a>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 0.5rem 0',
  },
};
