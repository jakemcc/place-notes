# Place Notes

A minimal progressive web app that lets you create notes associated with your current location. It is installable and works offline.

In addition to grabbing your current coordinates, the app can search for places using the OpenStreetMap Nominatim service. This
lets you look up a destination and attach a note to it even when you're somewhere else.

## Development

Open `index.html` in a modern browser. Click "Get location" to capture your coordinates, or use the search box to find a remote
place. Either way, fill out the form to add a note. Notes are stored in IndexedDB and persist across reloads.
The app requests persistent storage with `navigator.storage.persist()` so the browser is less likely to evict the data.

Location is only retrieved when you press the button and is not tracked continuously.
