const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '../deploy-ready');
const checkout = readFileSync(path.join(appRoot, 'delivery/Customer Order/customer-order.js'), 'utf8');

function extract(source, name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, name);
  return match[0];
}

test('the quote uses motorcycle routing and bills the full route distance', async t => {
  const { POST } = await import('../deploy-ready/api/delivery-quote.mjs');
  const distances = [4000, 4001, 4435, 5001];
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.origin, 'https://api.geoapify.com');
    assert.equal(url.searchParams.get('waypoints'), '5.3722219,95.9585189|5.35,95.94');
    assert.equal(url.searchParams.get('mode'), 'motorcycle');
    assert.equal(url.searchParams.get('type'), 'balanced');
    return Response.json({features: [{properties: {distance: distances.shift()}}]});
  });

  for (const [distanceMeters, fee] of [[4000, 10000], [4001, 10000], [4435, 11000], [5001, 12500]]) {
    const response = await POST(quoteRequest({latitude: 5.35, longitude: 95.94}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {distanceMeters, fee});
  }
});

// Recorded provider responses for the two customer pins. These distinguish the
// scooter detour from the motorcycle route without calling a live API in tests.
const reportedRoutes = [
  { latitude: 5.2925177, longitude: 95.9625845, scooterMeters: 11093, motorcycleMeters: 9983, fee: 25000 },
  { latitude: 5.3536838, longitude: 95.9250859, scooterMeters: 6123, motorcycleMeters: 5631, fee: 14000 }
];

for (const file of ['../api/delivery-quote.mjs', '../deploy-ready/api/delivery-quote.mjs']) {
  test(`${file}: two-decimal kilometer pricing rounds to the nearest Rp500 with a Rp10,000 minimum`, async t => {
    const { POST } = await import(existsSync(path.resolve(__dirname, file)) ? file : '../deploy-ready/api/delivery-quote.mjs');
    let distanceMeters;
    t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [{ properties: { distance: distanceMeters } }] }));
    const cases = [
      [0, 10000], [1000, 10000], [3500, 10000], [3999, 10000], [4000, 10000],
      [4001, 10000], [4080, 10000], [4094, 10000], [4095, 10500], [4099, 10500], [4100, 10500], [4101, 10500],
      [4120, 10500], [4200, 10500], [4299, 11000], [4300, 11000], [4400, 11000],
      [4435, 11000], [5001, 12500], [5299, 13500], [5300, 13500], [5631, 14000],
      [6100, 15500], [6123, 15500], [9983, 25000], [11093, 27500], [11100, 28000]
    ];
    for (const [meters, fee] of cases) {
      distanceMeters = meters;
      const response = await POST(quoteRequest({ latitude: 5.35, longitude: 95.94 }));
      assert.equal(response.status, 200);
      const quote = await response.json();
      assert.deepEqual(quote, { distanceMeters: meters, fee }, `${meters}m must preserve its original distance and bill at two decimals`);
      if (meters >= 4000) assert.ok(Math.abs(quote.fee - Math.round(meters / 10) * 25) <= 250);
    }
  });

  for (const route of reportedRoutes) {
    test(`${file}: ${route.latitude},${route.longitude} uses the motorcycle distance and fee`, async t => {
      const { POST } = await import(existsSync(path.resolve(__dirname, file)) ? file : '../deploy-ready/api/delivery-quote.mjs');
      t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(url.searchParams.get('waypoints'), `5.3722219,95.9585189|${route.latitude},${route.longitude}`);
        const distance = url.searchParams.get('mode') === 'motorcycle' ? route.motorcycleMeters : route.scooterMeters;
        return Response.json({ features: [{ properties: { distance } }] });
      });
      const response = await POST(quoteRequest({ latitude: route.latitude, longitude: route.longitude }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { distanceMeters: route.motorcycleMeters, fee: route.fee });
    });
  }
}

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
  requests[0].resolve(Response.json({distanceMeters: 4435, fee: 11000}));
  await oldRequest;
  assert.equal(context.homeDeliveryQuote(), null);

  current.locationStatus = 'ready';
  const failedRequest = context.homeEnsureDeliveryRoute();
  requests[1].resolve(new Response(null, {status: 503}));
  await failedRequest;
  await context.homeEnsureDeliveryRoute();
  assert.equal(requests.length, 2);
  const retry = context.homeEnsureDeliveryRoute(true);
  requests[2].resolve(Response.json({distanceMeters: 5120, fee: 13000}));
  await retry;
  assert.equal(context.homeDeliveryQuote().distanceKm, 5.12);
  assert.equal(context.homeDeliveryQuote().fee, 13000);
});

test('the driver shows the saved route, and older orders can still show straight-line distance', () => {
  const driver = readFileSync(path.join(appRoot, 'driver/Driver Order/driver-order.js'), 'utf8');
  const context = vm.createContext({
    firstCoordinates: () => ({latitude: 5.3545743, longitude: 95.9371538}),
    config: {storeLatitude: 5.3722219, storeLongitude: 95.9585189}
  });
  vm.runInContext(['numberValue', 'distanceKm', 'distanceLabel'].map(name => extract(driver, name)).join('\n'), context);
  for (const [meters, label] of [[4435, '4,4 km'], [5299, '5,3 km'], [5631, '5,6 km'], [9983, '10,0 km']]) {
    assert.equal(context.distanceLabel({delivery_distance_meters: meters}), label);
    assert.equal(context.distanceKm({delivery_distance_meters: meters}), meters / 1000, 'Display rounding must preserve the raw distance');
  }
  assert.equal(context.distanceLabel({delivery_distance_meters: null}), '3,1 km');
});

function quoteRequest(body) {
  return new Request('https://www.fresin.id/api/delivery-quote/', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
}
