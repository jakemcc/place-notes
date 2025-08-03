// Service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
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

// UI and geolocation
let currentPosition;
const locBtn = document.getElementById('locBtn');
const notesList = document.getElementById('notesList');
const addNoteBtn = document.getElementById('addNoteBtn');
const noteForm = document.getElementById('noteForm');

addNoteBtn.addEventListener('click', () => {
  noteForm.style.display = noteForm.style.display === 'block' ? 'none' : 'block';
});

function logPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const timestamp = pos.timestamp;
  console.log('Position:', { lat: latitude, lon: longitude, accuracy, timestamp });
  displayNotes();
}

locBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Geolocation not supported');
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    currentPosition = pos;
    logPosition(pos);
  });
});

async function displayNotes() {
  if (!currentPosition) {
    notesList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Get location to view nearby notes';
    notesList.appendChild(li);
    return;
  }

  const { latitude, longitude } = currentPosition.coords;
  const notes = await getNotesByRadius(latitude, longitude, 100);
  // Clear existing notes after fetching to avoid duplicates when multiple
  // geolocation callbacks run concurrently.
  notesList.innerHTML = '';
  if (notes.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No nearby notes';
    notesList.appendChild(li);
    return;
  }
  notes.forEach(n => {
    const li = document.createElement('li');
    const dist = Math.round(distance(latitude, longitude, n.lat, n.lon));

    const title = document.createElement('span');
    title.textContent = `${n.title} - ${dist} m`;
    title.className = 'note-title';

    const body = document.createElement('div');
    body.textContent = n.body;
    body.className = 'note-body';

    title.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await deleteNote(n.id);
      displayNotes();
    });

    li.appendChild(title);
    li.appendChild(del);
    li.appendChild(body);
    notesList.appendChild(li);
  });
}

noteForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentPosition) {
    alert('Get location first');
    return;
  }
  const title = document.getElementById('title').value;
  const body = document.getElementById('body').value;
  const { latitude: lat, longitude: lon } = currentPosition.coords;
  const note = {
    id: Date.now(),
    title,
    body,
    lat,
    lon,
    createdAt: new Date().toISOString()
  };
  await addNote(note);
  e.target.reset();
  noteForm.style.display = 'none';
  displayNotes();
});

window.addEventListener('load', displayNotes);
