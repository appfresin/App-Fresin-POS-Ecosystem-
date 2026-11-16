const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'deploy-ready/pos/app.js'), 'utf8');
const setting = name => {
  const match = new RegExp(`const ${name} = ["']([^"']+)["']`).exec(runtime);
  assert.ok(match, name);
  return match[1];
};
(async () => {
  const key = setting('SUPABASE_ANON_KEY');
  const url = new URL('/rest/v1/rpc/allocate_customer_order_number', setting('SUPABASE_URL'));
  // Reserves three numbers only. It never creates an order or reserves stock.
  const numbers = await Promise.all(Array.from({length:3}, async () => {
    const response = await fetch(url, {method:'POST',
      headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_prefix:'T'}),signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,'Anonymous checkout must be able to allocate T numbers');
    const number = await response.json();
    assert.match(number,/^T\d{3,18}$/);
    return number;
  }));
  assert.equal(new Set(numbers).size,3,'Concurrent devices must get distinct numbers');
  assert.ok(numbers.every(number=>BigInt(number.slice(1))>1n),'Existing T001 must not be reused');
  fs.mkdirSync(path.join(root,'tests/artifacts'),{recursive:true});
  fs.writeFileSync(path.join(root,'tests/artifacts/takeaway-allocation-production.json'),JSON.stringify({checkedAt:new Date().toISOString(),numbers,unique:true},null,2));
  console.log('PASS: concurrent public checkouts allocate unique T numbers without creating orders.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
