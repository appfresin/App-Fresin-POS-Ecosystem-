const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '../deploy-ready');
const checkout = readFileSync(path.join(appRoot, 'delivery/Customer Order/customer-order.js'), 'utf8');

function extract(source, name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, name);
  return match[0];
}

test('the quote uses scooter routing and bills the full route distance', async t => {
  const { POST } = await import('../deploy-ready/api/delivery-quote.mjs');
  const distances = [4000, 4001, 4435, 5001];
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.origin, 'https://api.geoapify.com');
    assert.equal(url.searchParams.get('waypoints'), '5.3722219,95.9585189|5.35,95.94');
    assert.equal(url.searchParams.get('mode'), 'scooter');
    return Response.json({features: [{properties: {distance: distances.shift()}}]});
  });

  for (const [distanceMeters, fee] of [[4000, 10000], [4001, 12500], [4435, 12500], [5001, 15000]]) {
    const response = await POST(quoteRequest({latitude: 5.35, longitude: 95.94}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {distanceMeters, fee});
  }
});

test('invalid pins are rejected before routing and provider errors yield no price', async t => {
  const { POST } = await import('../deploy-ready/api/delivery-quote.mjs');
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 429}));
  const invalid = await POST(quoteRequest({latitude: null, longitude: 95.94}));
  assert.equal(invalid.status, 400);
  assert.equal(fetch.mock.callCount(), 0);

  const unavailable = await POST(quoteRequest({latitude: 5.35, longitude: 95.94}));
  assert.equal(unavailable.status, 503);
  assert.equal(Object.hasOwn(await unavailable.json(), 'fee'), false);
});

test('a quote in flight cannot price an adjusted pin and a failed quote can be retried', async () => {
  const requests = [];
  let current = {method: 'DELIVERY', locationStatus: 'ready', latitude: 5.35, longitude: 95.94};
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout,
    fetch: (_url, options) => new Promise(resolve => requests.push({resolve, options})),
    homeCheckout: () => current,
    homeCoordinate: value => typeof value === 'number' ? value : null,
    homeIsMode: () => true,
    selfOrderStep: () => 'payment',
    render() {},
  });
  const functions = ['homeDeliveryRouteKey', 'homeDeliveryQuote', 'homeEnsureDeliveryRoute'];
  vm.runInContext('let homeDeliveryRoute = null;\n' + functions.map(name => extract(checkout, name)).join('\n'), context);

  const oldRequest = context.homeEnsureDeliveryRoute();
  await context.homeEnsureDeliveryRoute();
  assert.equal(requests.length, 1);
  current = {...current, longitude: 95.93, locationStatus: 'adjusted'};
  await context.homeEnsureDeliveryRoute();
  assert.ok(requests[0].options.signal.aborted);
  requests[0].resolve(Response.json({distanceMeters: 4435, fee: 12500}));
  await oldRequest;
  assert.equal(context.homeDeliveryQuote(), null);

  current.locationStatus = 'ready';
  const failedRequest = context.homeEnsureDeliveryRoute();
  requests[1].resolve(new Response(null, {status: 503}));
  await failedRequest;
  await context.homeEnsureDeliveryRoute();
  assert.equal(requests.length, 2);
  const retry = context.homeEnsureDeliveryRoute(true);
  requests[2].resolve(Response.json({distanceMeters: 5120, fee: 15000}));
  await retry;
  assert.equal(context.homeDeliveryQuote().distanceKm, 5.12);
  assert.equal(context.homeDeliveryQuote().fee, 15000);
});

test('the driver shows the saved route, and older orders can still show straight-line distance', () => {
  const driver = readFileSync(path.join(appRoot, 'driver/Driver Order/driver-order.js'), 'utf8');
  const context = vm.createContext({
    firstCoordinates: () => ({latitude: 5.3545743, longitude: 95.9371538}),
    config: {storeLatitude: 5.3722219, storeLongitude: 95.9585189}
  });
  vm.runInContext(['numberValue', 'distanceKm', 'distanceLabel'].map(name => extract(driver, name)).join('\n'), context);
  assert.equal(context.distanceLabel({delivery_distance_meters: 4435}), '4,4 km');
  assert.equal(context.distanceLabel({delivery_distance_meters: null}), '3,1 km');
});

function quoteRequest(body) {
  return new Request('https://www.fresin.id/api/delivery-quote/', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
}
