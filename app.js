// Service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              alert('New version available. Please reload.');
            }
          });
        }
      });
    });
  });
}

// Request persistent storage so the notes database is less likely to be
// cleared by the browser under storage pressure.
if (navigator.storage && navigator.storage.persist) {
  window.addEventListener('load', () => {
    navigator.storage.persist().then(granted => {
      console.log(`Persistent storage ${granted ? 'granted' : 'denied'}`);
    });
  });
}

// IndexedDB wrapper
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('notes-db', 1);
  request.onupgradeneeded = event => {
    const db = event.target.result;
    db.createObjectStore('notes', { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function transactionPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function addNote(note) {
  const db = await dbPromise;
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put(note);
  return transactionPromise(tx);
}

async function getAllNotes() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const req = tx.objectStore('notes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function distance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function getNotesByRadius(lat, lon, radius) {
  const notes = await getAllNotes();
  return notes.filter(n => distance(lat, lon, n.lat, n.lon) <= radius);
}

async function deleteNote(id) {
  const db = await dbPromise;
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').delete(id);
  return transactionPromise(tx);
}

async function searchNotes({ text, lat, lon, radius = 100 } = {}) {
  const notes = await getAllNotes();
  const lower = text ? text.toLowerCase() : null;
  return notes.filter(n => {
    const textMatch = !lower ||
      (n.title && n.title.toLowerCase().includes(lower)) ||
      (n.body && n.body.toLowerCase().includes(lower));
    const locMatch = (typeof lat !== 'number' || typeof lon !== 'number')
      ? true
      : distance(lat, lon, n.lat, n.lon) <= radius;
    return textMatch && locMatch;
  });
}
window.searchNotes = searchNotes;

// UI and geolocation
/**
 * Singleton store tracking user location.
 *
 * "current" holds the last geolocation retrieved from the device.
 * "selected" holds the coordinates where a new note will be saved,
 * which may come from the current position or a remote place search.
 * Searching only updates "selected" while the geolocation button sets
 * both values to the device's location.
 */
const locationStore = (() => {
  let currentPosition;
  let selectedPosition;
  return {
    getCurrent: () => currentPosition,
    setCurrent: pos => { currentPosition = pos; },
    getSelected: () => selectedPosition,
    setSelected: pos => { selectedPosition = pos; }
  };
})();
// Expose for tests to inspect or mock current/selected coordinates.
// Production code should not read or modify this global directly.
window.locationStore = locationStore;
const locBtn = document.getElementById('locBtn');
const notesList = document.getElementById('notesList');
const addNoteBtn = document.getElementById('addNoteBtn');
const noteForm = document.getElementById('noteForm');
const cancelNoteBtn = document.getElementById('cancelNoteBtn');
const searchForm = document.getElementById('searchForm');
const searchQuery = document.getElementById('searchQuery');
const searchResult = document.getElementById('searchResult');
const noteSearchForm = document.getElementById('noteSearchForm');
const noteSearchQuery = document.getElementById('noteSearchQuery');
let lastSearchTime = 0;

function fetchLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation not supported');
    return;
  }
  const originalText = locBtn.textContent;
  locBtn.disabled = true;
  locBtn.textContent = 'Getting location...';

  notesList.innerHTML = '';
  const li = document.createElement('li');
  li.textContent = 'Getting location...';
  notesList.appendChild(li);

  navigator.geolocation.getCurrentPosition(
    pos => {
      // Geolocation updates both current and selected positions to the
      // device's coordinates.
      locationStore.setCurrent(pos);
      locationStore.setSelected(pos);

      logPosition(pos);
      locBtn.disabled = false;
      locBtn.textContent = originalText;
    },
    () => {
      alert('Unable to retrieve location');
      locBtn.disabled = false;
      locBtn.textContent = originalText;
      notesList.innerHTML = '';
      const li = document.createElement('li');
      li.textContent = 'Unable to retrieve location';
      notesList.appendChild(li);
    }
  );
}

addNoteBtn.addEventListener('click', () => {
  const isOpen = noteForm.style.display === 'block';
  noteForm.style.display = isOpen ? 'none' : 'block';
  if (isOpen) {
    // Closing the form clears any previous search details.
    searchResult.textContent = '';
  } else if (!locationStore.getCurrent()) {
    fetchLocation();
  }
});

cancelNoteBtn.addEventListener('click', () => {
  noteForm.reset();
  noteForm.style.display = 'none';
  searchResult.textContent = '';
});

/**
 * Handle remote place lookups. A successful search stores the returned
 * coordinates as the "selected" location so a note can be created for
 * that place even if the user is elsewhere.
 */
searchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const query = searchQuery.value.trim();
  if (!query) {
    return;
  }
  const now = Date.now();
  if (now - lastSearchTime < 1000) {
    alert('Please wait before searching again.');
    return;
  }
  lastSearchTime = now;
  searchResult.textContent = 'Searching...';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PlaceNotes/1.0 (contact@example.com)'
      }
    });
    const data = await res.json();
    if (!data.length) {
      searchResult.textContent = 'No results';
      return;
    }
    const place = data[0];
    // Save remote coordinates as the selected location for note creation.
    locationStore.setSelected({
      coords: {
        latitude: parseFloat(place.lat),
        longitude: parseFloat(place.lon)
      }
    });
    searchResult.textContent = place.display_name;
    noteForm.style.display = 'block';
  } catch (err) {
    console.error(err);
    searchResult.textContent = 'Search failed';
  }
});

noteSearchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const query = noteSearchQuery.value.trim();
  if (!query) {
    return;
  }
  let notes = await searchNotes({ text: query });
  if (notes.length > 0) {
    renderNotes(notes);
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PlaceNotes/1.0 (contact@example.com)'
      }
    });
    const data = await res.json();
    if (!data.length) {
      renderNotes([]);
      return;
    }
    const place = data[0];
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    notes = await searchNotes({ lat, lon, radius: 100 });
    renderNotes(notes, lat, lon);
  } catch (err) {
    console.error(err);
    renderNotes([]);
  }
});

function logPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const timestamp = pos.timestamp;
  console.log('Position:', { lat: latitude, lon: longitude, accuracy, timestamp });
  displayNotes();
}

// Fetch the device location and treat it as the currently selected spot.
// This lets users save notes for where they are without performing a search.
locBtn.addEventListener('click', fetchLocation);
function renderNotes(notes, baseLat, baseLon) {
  notesList.innerHTML = '';
  if (notes.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No matching notes';
    notesList.appendChild(li);
    return;
  }
  notes.forEach(n => {
    const li = document.createElement('li');
    let distText = '';
    if (typeof baseLat === 'number' && typeof baseLon === 'number') {
      const dist = Math.round(distance(baseLat, baseLon, n.lat, n.lon));
      distText = `${dist} m`;
    }

    const title = document.createElement('span');
    title.textContent = n.title;
    title.className = 'note-title';

    const meta = document.createElement('span');
    const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString() : '';
    meta.textContent = ` - ${distText}${distText && date ? ' - ' : ''}${date}`;
    meta.className = 'note-meta';

    const body = document.createElement('div');
    body.textContent = n.body;
    body.className = 'note-body';

    title.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'note-delete';
    del.addEventListener('click', async () => {
      await deleteNote(n.id);
      const remaining = notes.filter(m => m.id !== n.id);
      renderNotes(remaining, baseLat, baseLon);
    });

    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(del);
    li.appendChild(body);
    notesList.appendChild(li);
  });
}

// Nearby notes are displayed relative to the device's current position.
async function displayNotes() {
  const currentPosition = locationStore.getCurrent();
  if (!currentPosition) {
    notesList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Get location to view nearby notes';
    notesList.appendChild(li);
    return;
  }

  const { latitude, longitude } = currentPosition.coords;
  const notes = await getNotesByRadius(latitude, longitude, 100);
  renderNotes(notes, latitude, longitude);
}

/**
 * Create a note at the currently selected coordinates. The selected
 * position may come from geolocation or a remote search, allowing notes
 * for places other than the device's present location.
 */
noteForm.addEventListener('submit', async e => {
  e.preventDefault();
  const selectedPosition = locationStore.getSelected();

  if (!selectedPosition) {
    alert('Select a location first');
    return;
  }
  const title = document.getElementById('title').value;
  const body = document.getElementById('body').value;
  const { latitude: lat, longitude: lon } = selectedPosition.coords;
  const note = {
    id: Date.now(),
    title,
    body,
    lat,
    lon,
    createdAt: new Date().toISOString()
  };
  try {
    await addNote(note);
    e.target.reset();
    noteForm.style.display = 'none';
    displayNotes();
  } catch (err) {
    console.error(err);
    alert('Failed to save note');
  } finally {
    // Clear search info so stale results aren't shown after adding or failing
    // to add a note.
    searchResult.textContent = '';
  }
});

window.addEventListener('load', displayNotes);
