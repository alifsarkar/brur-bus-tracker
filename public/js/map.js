// ============================================
// BRUR Bus Tracker — Student Map Logic
// ============================================

// --- Initialize the map centered on BRUR campus ---
const map = L.map('map', {
  zoomControl: true,
  attributionControl: true,
}).setView([25.7439, 89.2752], 14); // BRUR coordinates

// Load OpenStreetMap tiles (completely free)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

// Add a marker for BRUR campus itself
const campusIcon = L.divIcon({
  html: `<div style="background:#1a237e;color:white;padding:5px 10px;border-radius:8px;font-size:0.75rem;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🏫 BRUR Campus</div>`,
  className: '',
  iconAnchor: [50, 15],
});
L.marker([25.7439, 89.2752], { icon: campusIcon }).addTo(map);

// ============================================
// STATE — track everything in these objects
// ============================================
let busMarkers = {};    // { busId: leafletMarker }
let busData = {};       // { busId: { name, route, color, lat, lng, speed } }
let selectedBusId = null;

// ============================================
// SOCKET CONNECTION
// ============================================
const socket = io();

// When connected, ask server for current active buses immediately
socket.on('connect', () => {
  console.log('Connected to server');
  socket.emit('student:getActiveBuses');
});

// A new bus came online
socket.on('bus:activated', ({ busId, name, route, color }) => {
  busData[busId] = { name, route, color, lat: null, lng: null, speed: 0 };
  renderBusList();
});

// A bus went offline
socket.on('bus:deactivated', ({ busId }) => {
  if (busMarkers[busId]) {
    map.removeLayer(busMarkers[busId]);
    delete busMarkers[busId];
  }
  if (busData[busId]) {
    busData[busId].lat = null;
    busData[busId].lng = null;
  }
  renderBusList();

  // If the deactivated bus was selected, close the detail panel
  if (selectedBusId === busId) closeDetail();
});

// Live location update from a bus
socket.on('bus:location', ({ busId, lat, lng, speed, heading }) => {
  if (!busData[busId]) return;

  // Update our local state
  busData[busId].lat = lat;
  busData[busId].lng = lng;
  busData[busId].speed = speed;

  // Create or move the marker on the map
  updateBusMarker(busId, lat, lng, heading);

  // If this bus is selected, update the detail panel
  if (selectedBusId === busId) {
    updateDetailPanel(busId);
  }
});

// ============================================
// MAP MARKER — Create or update a bus icon
// ============================================
function createBusIcon(color, name, heading) {
  // Rotate the bus emoji based on heading direction
  const rotation = heading || 0;
  return L.divIcon({
    html: `
      <div style="position:relative; text-align:center;">
        <div style="
          font-size: 1.8rem;
          transform: rotate(${rotation}deg);
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
          line-height:1;
        ">🚌</div>
        <div style="
          background: ${color};
          color: white;
          font-size: 0.65rem;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 6px;
          white-space: nowrap;
          margin-top: 2px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        ">${name}</div>
      </div>`,
    className: '',
    iconAnchor: [20, 20],
  });
}

function updateBusMarker(busId, lat, lng, heading) {
  const bus = busData[busId];
  const icon = createBusIcon(bus.color, bus.name, heading);

  if (busMarkers[busId]) {
    // Move existing marker smoothly
    busMarkers[busId].setLatLng([lat, lng]);
    busMarkers[busId].setIcon(icon);
  } else {
    // Create new marker
    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .on('click', () => selectBus(busId));
    busMarkers[busId] = marker;
  }
}

// ============================================
// BUS LIST — Render cards in bottom panel
// ============================================
function renderBusList() {
  const container = document.getElementById('bus-list');

  // Load all buses from server (includes offline ones)
  fetch('/api/buses')
    .then(r => r.json())
    .then(allBuses => {
      if (allBuses.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No buses registered yet.</p>';
        return;
      }

      container.innerHTML = allBuses.map(bus => {
        const isLive = busData[bus.id] && busData[bus.id].lat !== null;
        const isSelected = selectedBusId === bus.id;
        return `
          <div class="bus-card ${isSelected ? 'selected' : ''} ${!isLive ? 'offline' : ''}"
               onclick="selectBus('${bus.id}')" id="card-${bus.id}">
            <div class="bus-card-dot ${isLive ? 'pulse' : ''}"
                 style="background:${bus.color}"></div>
            <div class="bus-card-info">
              <div class="bus-card-name">${bus.name}</div>
              <div class="bus-card-route">${bus.route}</div>
            </div>
            <span class="bus-card-status ${isLive ? 'status-live' : 'status-offline'}">
              ${isLive ? '● LIVE' : '○ Offline'}
            </span>
          </div>`;
      }).join('');
    });
}

// Load bus list on startup
renderBusList();

// ============================================
// BUS SELECTION
// ============================================
function selectBus(busId) {
  const bus = busData[busId];

  // If same bus clicked again, deselect
  if (selectedBusId === busId) {
    closeDetail();
    return;
  }

  selectedBusId = busId;
  renderBusList(); // re-render to show selected state

  // Show detail panel
  if (bus) {
    updateDetailPanel(busId);
    document.getElementById('bus-detail').classList.remove('hidden');

    // If bus has location, fly to it
    if (bus.lat && bus.lng) {
      map.flyTo([bus.lat, bus.lng], 15, { duration: 1.2 });
    }
  }
}

function updateDetailPanel(busId) {
  const bus = busData[busId];
  if (!bus) return;

  document.getElementById('bus-detail-color-bar').style.background = bus.color;
  document.getElementById('bus-detail-name').textContent = bus.name;
  document.getElementById('bus-detail-route').textContent = '📍 ' + bus.route;
  document.getElementById('bus-detail-speed').textContent =
    bus.speed ? `🚀 Speed: ${Math.round(bus.speed)} km/h` : '📡 Waiting for GPS signal...';
}

function closeDetail() {
  selectedBusId = null;
  document.getElementById('bus-detail').classList.add('hidden');
  renderBusList();
}

document.getElementById('bus-detail-close').addEventListener('click', closeDetail);

document.getElementById('bus-detail-track').addEventListener('click', () => {
  if (selectedBusId && busData[selectedBusId]?.lat) {
    map.flyTo([busData[selectedBusId].lat, busData[selectedBusId].lng], 16, { duration: 1 });
  }
});

// ============================================
// SEARCH
// ============================================
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchResults.style.display = 'none'; return; }

  fetch('/api/buses')
    .then(r => r.json())
    .then(allBuses => {
      const matches = allBuses.filter(b =>
        b.name.toLowerCase().includes(q) || b.route.toLowerCase().includes(q)
      );

      if (matches.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-name">No results found</div></div>';
      } else {
        searchResults.innerHTML = matches.map(b => `
          <div class="search-result-item" onclick="searchSelect('${b.id}')">
            <div class="search-result-name">${b.name}</div>
            <div class="search-result-route">${b.route}</div>
            <span class="search-result-badge" style="background:${b.color}">
              ${busData[b.id]?.lat ? '● LIVE' : '○ Offline'}
            </span>
          </div>`).join('');
      }
      searchResults.style.display = 'block';
    });
});

function searchSelect(busId) {
  searchInput.value = '';
  searchResults.style.display = 'none';
  selectBus(busId);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-wrapper')) {
    searchResults.style.display = 'none';
  }
});

// ============================================
// TABS
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ============================================
// SIDE MENU
// ============================================
const menuBtn = document.getElementById('menu-btn');
const sideMenu = document.getElementById('side-menu');
const menuOverlay = document.getElementById('menu-overlay');

function openMenu() {
  sideMenu.classList.add('open');
  menuOverlay.classList.add('open');
}
function closeMenu() {
  sideMenu.classList.remove('open');
  menuOverlay.classList.remove('open');
}

menuBtn.addEventListener('click', openMenu);
menuOverlay.addEventListener('click', closeMenu);
document.getElementById('menu-close').addEventListener('click', closeMenu);

// ============================================
// MODALS
// ============================================
document.getElementById('apply-driver-link').addEventListener('click', (e) => {
  e.preventDefault();
  closeMenu();
  document.getElementById('modal-overlay').classList.remove('hidden');
});

document.getElementById('about-link').addEventListener('click', (e) => {
  e.preventDefault();
  closeMenu();
  document.getElementById('about-overlay').classList.remove('hidden');
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('about-overlay').classList.add('hidden');
  });
});

document.getElementById('apply-form').addEventListener('submit', (e) => {
  e.preventDefault();
  alert('✅ Application submitted! The admin will contact you soon.');
  document.getElementById('modal-overlay').classList.add('hidden');
  e.target.reset();
});