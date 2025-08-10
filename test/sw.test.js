const test = require('node:test');
const assert = require('node:assert');

test('service worker calls skipWaiting and clients.claim', async t => {
  const events = {};
  let skipWaitingCalled = false;
  let claimCalled = false;

  const cachesMock = {
    open: () => Promise.resolve({ addAll: () => Promise.resolve() }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
    match: () => Promise.resolve(null)
  };

  global.self = {
    skipWaiting() { skipWaitingCalled = true; return Promise.resolve(); },
    clients: { claim() { claimCalled = true; return Promise.resolve(); } },
    addEventListener: (type, handler) => { events[type] = handler; },
    caches: cachesMock
  };
  global.caches = cachesMock;

  t.after(() => {
    delete global.self;
    delete global.caches;
  });

  require('../sw.js');

  let installWait;
  await events['install']({ waitUntil: p => { installWait = p; } });
  await installWait;
  let activateWait;
  await events['activate']({ waitUntil: p => { activateWait = p; } });
  await activateWait;
  assert.ok(skipWaitingCalled);
  assert.ok(claimCalled);
});
