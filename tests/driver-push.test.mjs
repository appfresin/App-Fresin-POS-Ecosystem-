import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyDriverOrder } from "../supabase/functions/notify-new-order/driver-push.mjs";
const now = Date.parse("2026-11-14T10:00:00Z"),
  id = "12345678-1234-1234-1234-123456789abc";
function setup(patch = {}) {
  const order = {
      id,
      order_number: "D100",
      customer_order_type: "DELIVERY",
      customer_order_status: "SEARCHING_DRIVER",
      payment_provider: "courier_cash",
      updated_at: new Date(now).toISOString(),
      ...patch,
    },
    sends = [],
    tables = [];
  const admin = {
    from(table) {
      tables.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: order };
        },
        async gt() {
          return {
            data: [
              { id: "one", driver_id: "active", fcm_token: "a" },
              { id: "duplicate", driver_id: "active", fcm_token: "a" },
              { id: "blocked", driver_id: "revoked", fcm_token: "b" },
            ],
          };
        },
      };
    },
    async rpc(name, args) {
      return { data: args.p_driver_id === "active" };
    },
  };
  return {
    order,
    sends,
    tables,
    run: (eventType) =>
      notifyDriverOrder(
        admin,
        { orderId: id, eventType },
        async (...args) => {
          sends.push(args);
          return { ok: true };
        },
        now,
      ),
  };
}
test("pushes a small offer only to eligible driver devices and deduplicates tokens", async () => {
  const s = setup();
  await s.run();
  assert.equal(s.sends.length, 1);
  assert.equal(s.sends[0][1].event_type, "driver_offer");
  assert.equal(s.sends[0][2], 300);
  assert.ok(!JSON.stringify(s.sends).includes("customer_phone"));
  assert.ok(!s.tables.includes("device_push_tokens"));
});
test("delayed delivery after acceptance or cancellation sends a stop event instead of ringing", async () => {
  for (const patch of [
    { driver_id: "assigned" },
    { cancelled_at: "yes" },
    { customer_order_status: "PREPARING" },
    { updated_at: new Date(now - 300001).toISOString() },
    { payment_provider: "duitku", payment_status: "Belum dibayar" },
  ]) {
    const s = setup(patch);
    await s.run();
    assert.equal(s.sends[0][1].event_type, "driver_cancel");
  }
});
test("non-delivery and malformed identifiers cannot dispatch driver pushes", async () => {
  const s = setup({ customer_order_type: "PICKUP_PREORDER" });
  await s.run();
  assert.equal(s.sends.length, 0);
  assert.equal(
    (await notifyDriverOrder({}, { orderId: "bad" }, () => {})).status,
    400,
  );
});

test("kitchen-ready push goes only to the assigned active driver before payment", async () => {
  const s=setup({driver_id:'active',customer_order_status:'PREPARING',status:'Selesai',payment_status:'Belum dibayar'});
  await s.run('driver_ready');
  assert.equal(s.sends.length,1);
  assert.equal(s.sends[0][0],'a');
  assert.equal(s.sends[0][1].event_type,'driver_ready');
  assert.match(s.sends[0][1].body,/selesai disiapkan dapur/);
});
test("payment without kitchen completion never dispatches a ready alert; stale events clear", async () => {
  for(const patch of [{status:'Sedang Disiapkan',payment_status:'Lunas'},
    {status:'Selesai',customer_order_status:'DELIVERING'}, {status:'Selesai',cancelled_at:'now'}]) {
    const s=setup({driver_id:'active',customer_order_status:'PREPARING',...patch});
    await s.run('driver_ready');
    assert.equal(s.sends[0][1].event_type,'driver_ready_clear');
  }
  const s=setup({status:'Selesai'});await s.run('driver_ready');assert.equal(s.sends.length,0);
});
