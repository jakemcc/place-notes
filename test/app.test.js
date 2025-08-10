const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function setup({ fetch: fetchImpl, alert: alertImpl } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
  const { window } = dom;

  window.navigator.serviceWorker = { register: () => Promise.resolve() };
  window.navigator.storage = { persist: () => Promise.resolve(true) };
  window.alert = alertImpl || (() => {});

  window.indexedDB = {
    open() {
      const request = {};
      setTimeout(() => {
        const db = {
          createObjectStore() {},
          transaction() {
            return {
              objectStore() {
                return {
                  put() {},
                  getAll() { return { onsuccess: null }; },
                  delete() {}
                };
              },
              oncomplete: null,
              onerror: null
            };
          }
        };
        request.result = db;
        request.onupgradeneeded && request.onupgradeneeded({ target: { result: db } });
        request.onsuccess && request.onsuccess({ target: { result: db } });
      }, 0);
      return request;
    }
  };

  window.fetch = fetchImpl || (() => Promise.resolve({ json: () => [] }));

  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  window.eval(appJs);
  window.dispatchEvent(new window.Event('load'));

  return window;
}

test('search sets selected coordinates', async () => {
  const fetchStub = () => Promise.resolve({ json: () => [{ lat: '1', lon: '2', display_name: 'Foo' }] });
  const win = setup({ fetch: fetchStub });
  win.document.getElementById('searchQuery').value = 'foo';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.searchResult.textContent, 'Foo');
  assert.deepEqual(win.locationStore.getSelected().coords, { latitude: 1, longitude: 2 });
});

test('adding note after remote search uses coordinates', async () => {
  const fetchStub = () => Promise.resolve({ json: () => [{ lat: '3', lon: '4', display_name: 'Bar' }] });
  const notes = [];
  const win = setup({ fetch: fetchStub });
  win.addNote = async note => { notes.push(note); };

  win.document.getElementById('searchQuery').value = 'bar';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  win.document.getElementById('title').value = 't';
  win.document.getElementById('body').value = 'b';
  win.document.getElementById('noteForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(notes.length, 1);
  assert.equal(notes[0].lat, 3);
  assert.equal(notes[0].lon, 4);
  assert.equal(win.searchResult.textContent, '');
});

test('closing note form clears search result', async () => {
  const fetchStub = () => Promise.resolve({ json: () => [{ lat: '7', lon: '8', display_name: 'Baz' }] });
  const win = setup({ fetch: fetchStub });
  win.document.getElementById('searchQuery').value = 'baz';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.searchResult.textContent, 'Baz');
  win.document.getElementById('addNoteBtn').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(win.searchResult.textContent, '');
});

test('search result cleared after failed note save', async () => {
  const fetchStub = () => Promise.resolve({ json: () => [{ lat: '9', lon: '10', display_name: 'Qux' }] });
  let alertMsg = '';
  const win = setup({ fetch: fetchStub, alert: msg => { alertMsg = msg; } });
  win.addNote = async () => { throw new Error('fail'); };

  win.document.getElementById('searchQuery').value = 'qux';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  win.document.getElementById('title').value = 't';
  win.document.getElementById('body').value = 'b';
  win.document.getElementById('noteForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(win.searchResult.textContent, '');
  assert.equal(alertMsg, 'Failed to save note');
});

test('rate limit shows message and prevents fetch', async () => {
  let calls = 0;
  const fetchStub = () => { calls++; return Promise.resolve({ json: () => [{ lat: '1', lon: '2', display_name: 'Foo' }] }); };
  let alertMsg = '';
  const win = setup({ fetch: fetchStub, alert: msg => { alertMsg = msg; } });
  let now = 1000;
  win.Date.now = () => now;

  win.document.getElementById('searchQuery').value = 'a';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  win.document.getElementById('searchQuery').value = 'b';
  // keep now the same so rate limit triggers
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls, 1);
  assert.equal(alertMsg, 'Please wait before searching again.');
});

test('empty result shows message', async () => {
  const fetchStub = () => Promise.resolve({ json: () => [] });
  const win = setup({ fetch: fetchStub });
  win.document.getElementById('searchQuery').value = 'none';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.searchResult.textContent, 'No results');
});

test('search error shows message', async () => {
  const fetchStub = () => Promise.reject(new Error('fail'));
  const win = setup({ fetch: fetchStub });
  win.document.getElementById('searchQuery').value = 'err';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.searchResult.textContent, 'Search failed');
});

test('multiple searches update coordinates', async () => {
  let call = 0;
  const fetchStub = () => {
    call++;
    if (call === 1) {
      return Promise.resolve({ json: () => [{ lat: '1', lon: '2', display_name: 'First' }] });
    }
    return Promise.resolve({ json: () => [{ lat: '5', lon: '6', display_name: 'Second' }] });
  };
  const win = setup({ fetch: fetchStub });
  let now = 1000;
  win.Date.now = () => now;

  win.document.getElementById('searchQuery').value = 'first';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  now = 2500;
  win.document.getElementById('searchQuery').value = 'second';
  win.document.getElementById('searchForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(win.locationStore.getSelected().coords, { latitude: 5, longitude: 6 });
  assert.equal(win.searchResult.textContent, 'Second');
});

