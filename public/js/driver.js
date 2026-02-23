// ============================================
// BRUR Bus Tracker — Driver GPS Logic
// ============================================

let myBusId = null;
let myToken = null;
let myBusName = null;
let myBusRoute = null;
let watchId = null;
let socket = null;
let wakeLock = null;

// ============================================
// ON PAGE LOAD — Check if token already saved
// ============================================
window.addEventListener('load', () => {
  const savedToken = localStorage.getItem('brur_driver_token');
  const savedName  = localStorage.getItem('brur_driver_name');
  const savedRoute = localStorage.getItem('brur_driver_route');
  const savedBusId = localStorage.getItem('brur_driver_busid');

  if (savedToken && savedName) {
    // Driver has logged in before — skip token screen entirely
    myToken    = savedToken;
    myBusName  = savedName;
    myBusRoute = savedRoute;
    myBusId    = savedBusId;
    showReadyScreen();
  } else {
    // First time — show token input
    showLoginScreen();
  }
});

// ============================================
// SCREEN MANAGEMENT
// ============================================
function showLoginScreen() {
  document.getElementById('login-screen').style.display  = 'block';
  document.getElementById('ready-screen').style.display  = 'none';
  document.getElementById('tracking-screen').style.display = 'none';
}

function showReadyScreen() {
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('ready-screen').style.display  = 'block';
  document.getElementById('tracking-screen').style.display = 'none';

  document.getElementById('ready-bus-name').textContent  = myBusName;
  document.getElementById('ready-bus-route').textContent = myBusRoute;
}

function showTrackingScreen() {
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('ready-screen').style.display  = 'none';
  document.getElementById('tracking-screen').style.display = 'block';

  document.getElementById('info-bus').textContent   = myBusName;
  document.getElementById('info-route').textContent = myBusRoute;
}

// ============================================
// TOKEN VERIFICATION (first time only)
// ============================================
function showLoginScreen_explicit() {
  localStorage.clear();
  myToken = myBusId = myBusName = myBusRoute = null;
  showLoginScreen();
}

const verifyBtn  = document.getElementById('verify-btn');
const tokenInput = document.getElementById('token-input');
const tokenError = document.getElementById('token-error');

verifyBtn.addEventListener('click', verifyToken);
tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyToken(); });

async function verifyToken() {
  const token = tokenInput.value.trim();
  if (!token) return;

  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Checking...';
  tokenError.style.display = 'none';

  try {
    const res  = await fetch('/api/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();

    if (data.success) {
      // Save everything so driver never needs to type token again
      localStorage.setItem('brur_driver_token', token);
      localStorage.setItem('brur_driver_name',  data.name);
      localStorage.setItem('brur_driver_route', data.route);
      localStorage.setItem('brur_driver_busid', data.busId);

      myToken    = token;
      myBusName  = data.name;
      myBusRoute = data.route;
      myBusId    = data.busId;

      showReadyScreen();
    } else {
      tokenError.textContent    = '❌ ' + data.message;
      tokenError.style.display  = 'block';
      verifyBtn.disabled        = false;
      verifyBtn.textContent     = 'Verify & Start Tracking';
    }
  } catch (err) {
    tokenError.textContent   = '❌ Could not reach server. Check connection.';
    tokenError.style.display = 'block';
    verifyBtn.disabled       = false;
    verifyBtn.textContent    = 'Verify & Start Tracking';
  }
}

// ============================================
// START JOURNEY BUTTON
// ============================================
document.getElementById('start-journey-btn').addEventListener('click', () => {
  showTrackingScreen();
  connectAndTrack();
});

// ============================================
// SOCKET + GPS
// ============================================
function connectAndTrack() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('driver:start', { busId: myBusId, token: myToken });
    startGPS();
  });

  socket.on('driver:confirmed', () => {
    setStatus('active', '✅', 'Sharing Live Location', 'Students can see your bus on the map');
  });

  socket.on('driver:error', msg => {
    setStatus('error', '❌', 'Error', msg);
    stopGPS();
  });

  socket.on('disconnect', () => {
    setStatus('waiting', '📡', 'Reconnecting...', 'Connection lost, trying again...');
  });

  socket.on('reconnect', () => {
    socket.emit('driver:start', { busId: myBusId, token: myToken });
  });
}

function startGPS() {
  if (!navigator.geolocation) {
    setStatus('error', '❌', 'GPS Not Supported', 'Your browser does not support GPS.');
    return;
  }

  setStatus('waiting', '📡', 'Getting GPS Signal', 'Please wait...');

  watchId = navigator.geolocation.watchPosition(
    onLocationUpdate,
    onLocationError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  acquireWakeLock();
}

function stopGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  releaseWakeLock();
}

function onLocationUpdate(position) {
  const { latitude, longitude, speed, heading, accuracy } = position.coords;
  const speedKmh = speed ? Math.round(speed * 3.6) : 0;

  socket.emit('driver:location', {
    busId: myBusId, token: myToken,
    lat: latitude, lng: longitude,
    speed: speedKmh, heading: heading || 0,
  });

  document.getElementById('info-coords').textContent =
    `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  document.getElementById('info-speed').textContent =
    speedKmh > 0 ? `${speedKmh} km/h` : 'Stationary';
  document.getElementById('info-time').textContent =
    new Date().toLocaleTimeString();

  setStatus('active', '✅', 'Sharing Live Location', `Accuracy: ±${Math.round(accuracy)}m`);
}

function onLocationError(err) {
  let msg = 'Could not get GPS signal.';
  if (err.code === 1) msg = 'Location permission denied. Please allow location access in browser settings.';
  if (err.code === 2) msg = 'GPS unavailable. Try moving outdoors.';
  if (err.code === 3) msg = 'GPS timed out. Retrying...';
  setStatus('error', '❌', 'GPS Error', msg);
}

// ============================================
// STOP BUTTON
// ============================================
document.getElementById('stop-btn').addEventListener('click', () => {
  if (confirm('Stop sharing your location?')) {
    stopGPS();
    if (socket) socket.disconnect();
    setStatus('waiting', '🛑', 'Stopped', 'You have stopped sharing.');
    document.getElementById('stop-btn').disabled = true;

    // Go back to ready screen after 2 seconds
    setTimeout(() => {
      document.getElementById('stop-btn').disabled = false;
      showReadyScreen();
      socket = null;
    }, 2000);
  }
});

// ============================================
// CHANGE DRIVER (clear saved token)
// ============================================
document.getElementById('change-driver-btn').addEventListener('click', () => {
  if (confirm('This will remove the saved token and ask for a new one.')) {
    showLoginScreen_explicit();
  }
});

// ============================================
// WAKE LOCK — Keep screen on while tracking
// ============================================
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    console.log('Wake lock acquired — screen will stay on');

    // If user switches tab and comes back, re-acquire it
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && watchId !== null) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch {}
      }
    });
  } catch (err) {
    console.log('Wake lock not available:', err);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}

// ============================================
// HELPER
// ============================================
function setStatus(type, icon, title, msg) {
  const circle = document.getElementById('status-circle');
  circle.className  = 'status-circle ' + type;
  circle.textContent = icon;
  document.getElementById('status-title').textContent = title;
  document.getElementById('status-msg').textContent   = msg;
}