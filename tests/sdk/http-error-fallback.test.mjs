import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

const source = await readFile(new URL("../../packages/sdk/src/index.ts", import.meta.url), "utf8");
const js = stripTypeScriptTypes(source)
  .replace(/^export default BotWallet;$/m, "")
  .replace(/^export /gm, "");
const loadSdk = compileFunction(`${js}\nreturn { BotWallet, BotWalletError };`, ["fetch"]);

function fixture(response) {
  const calls = [];
  const { BotWallet, BotWalletError } = loadSdk(async (url, options) => {
    calls.push({ url, options });
    assert.equal(calls.length, 1, "SDK must not retry");
    return response;
  });
  const wallet = new BotWallet({ apiKey: "fixture-key", baseUrl: "https://example.invalid" });
  return { wallet, BotWalletError, calls };
}

for (const { label, body, status, contentType } of [
  { label: "HTML 503", body: "<html><body>Proxy unavailable</body></html>", status: 503, contentType: "text/html" },
  { label: "empty 502", body: "", status: 502, contentType: "application/json" },
]) {
  test(`${label} preserves the HTTP status with a safe fallback`, async () => {
    const { wallet, BotWalletError, calls } = fixture(new Response(body, {
      status,
      headers: { "Content-Type": contentType },
    }));
    await assert.rejects(wallet.balance(), (error) => {
      assert.ok(error instanceof BotWalletError);
      assert.equal(error.name, "BotWalletError");
      assert.equal(error.status, status);
      assert.equal(error.code, "UNKNOWN");
      assert.equal(error.message, `Request failed with ${status}`);
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

test("structured JSON errors preserve their code and message", async () => {
  const { wallet, BotWalletError, calls } = fixture(Response.json({
    code: "RATE_LIMITED",
    message: "Too many requests",
  }, { status: 429 }));
  await assert.rejects(wallet.balance(), (error) => {
    assert.ok(error instanceof BotWalletError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.message, "Too many requests");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("successful balance JSON is returned unchanged", async () => {
  const balance = {
    agent: "fixture-agent",
    available_cents: 1200,
    available: "12.00",
    held_cents: 300,
    held: "3.00",
    total_cents: 1500,
    currency: "USD",
  };
  const { wallet, calls } = fixture(Response.json(balance));
  assert.deepEqual(await wallet.balance(), balance);
  assert.deepEqual(calls, [{
    url: "https://example.invalid/api/v1/balance",
    options: {
      headers: {
        Authorization: "Bearer fixture-key",
        "Content-Type": "application/json",
      },
    },
  }]);
});

test("malformed successful JSON still rejects with a parse error", async () => {
  const { wallet, BotWalletError, calls } = fixture(new Response('{"agent":', {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(wallet.balance(), (error) => {
    assert.ok(error instanceof SyntaxError);
    assert.ok(!(error instanceof BotWalletError));
    return true;
  });
  assert.equal(calls.length, 1);
});
