#!/usr/bin/env node
/**
 * Push BotWall3t schema to Supabase.
 * Tries multiple approaches to execute SQL without direct DB password.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://ainrnvzalcrgdifripwt.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpbnJudnphbGNyZ2RpZnJpcHd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTc5NjE1MywiZXhwIjoyMDg3MzcyMTUzfQ.ghuZFC5tEQ8ST5rB4mF6rysgwq6oipMta2C__2NCBYI';

const schemaSql = readFileSync(join(__dirname, '..', 'sql', '001_schema.sql'), 'utf-8');
const rpcSql = readFileSync(join(__dirname, '..', 'sql', '002_rpc_functions.sql'), 'utf-8');

async function trySqlEndpoints(sql, label) {
  console.log(`\n🔄 ${label}...`);
  
  // Approach 1: Supabase /pg/query endpoint (undocumented but exists on some versions)
  for (const endpoint of ['/pg/query', '/rest/v1/rpc/exec_sql']) {
    try {
      const r = await fetch(`${SUPABASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify(endpoint.includes('rpc') ? { sql } : { query: sql }),
      });
      console.log(`  ${endpoint}: ${r.status} ${r.statusText}`);
      if (r.ok) {
        const text = await r.text();
        console.log(`  ✅ Success: ${text.slice(0, 200)}`);
        return true;
      }
      const errText = await r.text();
      console.log(`  Response: ${errText.slice(0, 200)}`);
    } catch (e) {
      console.log(`  ${endpoint}: Error — ${e.message}`);
    }
  }
  return false;
}

async function verifySchema() {
  console.log('\n🔍 Verifying schema...');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id&limit=1`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Accept-Profile': 'botwallet',
    },
  });
  console.log(`  Status: ${r.status}`);
  const text = await r.text();
  console.log(`  Response: ${text.slice(0, 200)}`);
  return r.ok;
}

async function main() {
  console.log('🏦 BotWall3t Schema Push');
  console.log(`📡 Target: ${SUPABASE_URL}`);
  
  const ok1 = await trySqlEndpoints(schemaSql, '001_schema.sql');
  if (ok1) {
    await trySqlEndpoints(rpcSql, '002_rpc_functions.sql');
  }
  
  const verified = await verifySchema();
  
  if (!verified) {
    console.log('\n⚠️  Could not push schema programmatically.');
    console.log('   You need to run the SQL files manually in Supabase SQL Editor:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/ainrnvzalcrgdifripwt/sql/new');
    console.log('   2. Paste contents of sql/001_schema.sql and run');
    console.log('   3. Paste contents of sql/002_rpc_functions.sql and run');
    console.log('\n   Or provide the DB password and I can push via psql.');
  }
}

main().catch(console.error);
