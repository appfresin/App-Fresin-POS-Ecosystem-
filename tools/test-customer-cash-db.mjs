import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Install @electric-sql/pglite in a temporary QA directory, never in production.
const runtime = process.env.FRESIN_PGLITE || path.join(process.env.TEMP, 'fresin-cash-sql-qa/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const db = new PGlite();
const migration = fs.readFileSync(new URL('../supabase/migrations/20261112053635_customer_cash_at_outlet.sql', import.meta.url), 'utf8');
try {
  await db.exec(`
    create schema vault; create schema net;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    insert into vault.decrypted_secrets values ('kasirin_push_internal_secret','fixture-only');
    create table public.requests(body jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
    returns bigint language plpgsql as $$begin insert into public.requests values(body); return 1; end;$$;
    create table public.orders(id text primary key, order_number text, source text default 'Self Order',
      customer_name text, type text, status text default 'Pesanan Baru', payment_provider text,
      customer_order_type text, customer_order_status text, payment_status text default 'Belum dibayar',
      driver_id text, confirmed_at timestamptz, subtotal numeric default 25000,
      grand_total numeric default 35000, delivery_fee numeric default 10000, notification_categories text[]);
    create view public.report_sales_records as select o.id,coalesce(o.grand_total,0)::numeric(14,2) as total from orders o;
    create view public.report_total_fixture as select sum(total) as total from report_sales_records;
    create function public.kasirin_notify_order_push() returns trigger language plpgsql as $$
begin
      insert into public.requests values ('{"legacy":true}'); return new;
    end; $$;
    create trigger legacy_push after insert or update on public.orders for each row execute function public.kasirin_notify_order_push();
  `);
  await db.exec(migration);
  await db.exec(migration); // Must be safe to rerun.
  await db.exec(`insert into orders(id,order_number,payment_provider,customer_order_type,customer_order_status)
    values ('pickup','P999','cash_at_outlet','PICKUP_PREORDER','WAITING_ACCEPTANCE');`);
  let calls = (await db.query('select body from requests')).rows;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.target, 'kasir');
  await db.exec("update orders set confirmed_at=now() where id='pickup'");
  calls = (await db.query('select body from requests')).rows;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.target, 'all');
  await db.exec(`insert into orders(id,order_number,payment_provider,customer_order_type,customer_order_status)
    values ('delivery','D999','courier_cash','DELIVERY','SEARCHING_DRIVER');`);
  assert.equal((await db.query('select * from requests')).rows.length, 2);
  await db.exec("update orders set driver_id='driver',customer_order_status='DRIVER_ASSIGNED' where id='delivery'");
  calls = (await db.query('select body from requests')).rows;
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.target, 'kasir');
  await assert.rejects(db.exec("update orders set customer_order_status='DELIVERING' where id='delivery'"), /Kasir harus mencatat/);
  assert.equal((await db.query("select customer_order_status from orders where id='delivery'")).rows[0].customer_order_status, 'DRIVER_ASSIGNED');
  for (const id of ['pickup', 'delivery']) await assert.rejects(db.exec(`update orders set customer_order_status='PAYMENT_EXPIRED' where id='${id}'`), /tidak memiliki batas/);
  await db.exec("update orders set payment_status='Lunas' where id='delivery'");
  await db.exec("update orders set customer_order_status='DELIVERING' where id='delivery'");
  assert.equal((await db.query("select customer_order_status from orders where id='delivery'")).rows[0].customer_order_status, 'DELIVERING');
  assert.equal(Number((await db.query("select total from report_sales_records where id='delivery'")).rows[0].total), 25000);
  assert.equal(Number((await db.query("select grand_total from orders where id='delivery'")).rows[0].grand_total), 35000);
  assert.equal(Number((await db.query("select total from report_sales_records where id='pickup'")).rows[0].total), 35000);
  assert.equal(Number((await db.query("select total from report_total_fixture")).rows[0].total), 60000);
  await db.exec("insert into orders(id,order_number,payment_provider) values ('legacy','P998','duitku')");
  calls = (await db.query('select body from requests')).rows;
  assert.equal(calls.at(-1).body.legacy, true);
  console.log('PASS SQL: idempotent migration, cashier-first push, accepted kitchen push, legacy preserved, unpaid delivery and online expiry blocked. No production connections.');
} catch (error) {
  console.error('SQL QA failed:', error.message);
  process.exitCode = 1;
} finally { await db.close(); }
