const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setup(file) {
  const local = path.join(__dirname, '..', file);
  const source = readFileSync(existsSync(local) ? local : path.join(__dirname, '../deploy-ready', file), 'utf8');
  const init = source.match(/^  function homeInitMapLibreLocationMap\([\s\S]*?^  }/m)[0];
  const events = new Map();
  const timers = new Map();
  let loader = true;
  let attached = true;
  let fallback = 0;
  const element = {
    dataset: {},
    querySelector: selector => selector === '.customer-home-map-loading' && loader
      ? { remove() { loader = false; } } : null,
    setAttribute() {}, removeAttribute() {}
  };
  class MapFixture {
    constructor() {
      this.dragPan = this.touchZoomRotate = this.doubleClickZoom = this.boxZoom = {
        enable() {}, disableRotation() {}
      };
      this.tilesLoaded = false;
    }
    addControl() {}
    on(name, callback) { events.set(name, [...(events.get(name) || []), callback]); }
    once(name, callback) { this.on(name, callback); }
    off(name, callback) { events.set(name, (events.get(name) || []).filter(fn => fn !== callback)); }
    loaded() { return this.tilesLoaded; }
    areTilesLoaded() { return this.tilesLoaded; }
    getContainer() { return element; }
    resize() {}
  }
  class MarkerFixture {
    constructor(options) { this.element = options.element; }
    setLngLat() { return this; }
    addTo() { return this; }
    on() {}
  }
  const context = vm.createContext({
    console: { warn() {} },
    document: {
      getElementById: () => element,
      body: { contains: () => attached },
      createElement: () => ({ style: {}, hidden: false })
    },
    window: {
      setTimeout(fn, ms) { timers.set(ms, fn); return ms; },
      clearTimeout(id) { timers.delete(id); }
    },
    setTimeout() {},
    homeCheckout: () => ({ latitude: 5.37, longitude: 95.95 }),
    homeCoordinate: Number,
    homeGeoapifyStyleUrl: () => 'fixture-style',
    homeRenderMapLoading: () => '',
    homeLocationMapZoom: () => 15,
    homeLoadMapLibre: async () => ({ Map: MapFixture, Marker: MarkerFixture, NavigationControl: class {} }),
    homeShowStaticLocationMapFallback() { fallback++; },
    homeMapLibreMap: null,
    homeMapLibreMarker: null
  });
  vm.runInContext(init, context);
  return {
    context, element, timers,
    get loader() { return loader; },
    get fallback() { return fallback; },
    detach() { attached = false; },
    emit(name, event = {}) { for (const callback of [...(events.get(name) || [])]) callback(event); },
    async start() { context.homeInitMapLibreLocationMap(); await Promise.resolve(); }
  };
}

for (const file of ['delivery/Customer Order/customer-order.js', 'deploy-ready/delivery/Customer Order/customer-order.js']) {
  test(`${file}: pin stays hidden until the viewport finishes drawing`, async () => {
    const ui = setup(file);
    await ui.start();
    assert.equal(ui.loader, true);
    assert.equal(ui.context.homeMapLibreMarker.element.hidden, true);
    ui.emit('load');
    ui.emit('idle');
    assert.equal(ui.loader, true, 'Early load/idle must not expose a blank map');
    ui.context.homeMapLibreMap.tilesLoaded = true;
    ui.emit('idle');
    assert.equal(ui.loader, false);
    assert.equal(ui.element.dataset.ready, '1');
    assert.equal(ui.context.homeMapLibreMarker.element.hidden, false);
    assert.equal(ui.timers.has(12000), false);
  });

  test(`${file}: failed map tiles never expose the pin`, async () => {
    const ui = setup(file);
    await ui.start();
    ui.emit('error', { error: new Error('Weak connection') });
    ui.context.homeMapLibreMap.tilesLoaded = true;
    ui.emit('load');
    ui.emit('idle');
    assert.equal(ui.loader, true);
    assert.equal(ui.context.homeMapLibreMarker.element.hidden, true);
    ui.timers.get(12000)();
    assert.equal(ui.fallback, 1);
    ui.emit('idle');
    assert.equal(ui.loader, true, 'A late map event must not dismiss the fallback loader');
  });

  test(`${file}: leaving checkout ignores late map readiness`, async () => {
    const ui = setup(file);
    await ui.start();
    ui.detach();
    ui.context.homeMapLibreMap.tilesLoaded = true;
    ui.emit('load');
    ui.emit('idle');
    assert.equal(ui.loader, true);
    assert.equal(ui.context.homeMapLibreMarker.element.hidden, true);
  });

  test(`${file}: checkout refreshes keep the same pending map`, async () => {
    const ui = setup(file);
    await ui.start();
    const map = ui.context.homeMapLibreMap;
    await ui.start();
    assert.equal(ui.context.homeMapLibreMap, map);
    assert.equal(ui.loader, true);
    ui.emit('remove');
    assert.equal(ui.timers.has(12000), false, 'Leaving checkout must cancel its fallback timer');
  });
}
