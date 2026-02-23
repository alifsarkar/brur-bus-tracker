// ============================================
// BRUR Bus Tracker - Main Server
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// --- App Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve all files in the /public folder to the browser
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ============================================
// BUS DATA — Edit this to match real BRUR buses
// ============================================
const buses = {
  'BUS-01': { name: 'Bus 1', route: 'BRUR → Modern More → Station', color: '#e74c3c', driverToken: 'TOKEN-BUS01-SECRET' },
  'BUS-02': { name: 'Bus 2', route: 'BRUR → Medical → Shapla Chattar', color: '#3498db', driverToken: 'TOKEN-BUS02-SECRET' },
  'BUS-03': { name: 'Bus 3', route: 'BRUR → Lalbagh → Dhap', color: '#2ecc71', driverToken: 'TOKEN-BUS03-SECRET' },
  'BUS-04': { name: 'Bus 4', route: 'BRUR → Cantonment → Mahiganj', color: '#f39c12', driverToken: 'TOKEN-BUS04-SECRET' },
  'BUS-05': { name: 'Bus 5', route: 'BRUR → Cadet College Road', color: '#9b59b6', driverToken: 'TOKEN-BUS05-SECRET' },
};

// This object stores the live location of each active bus in memory
// { busId: { lat, lng, speed, heading, lastSeen, driverConnected } }
let activeBuses = {};

// ============================================
// TOKEN CHECK — Driver login via secret token
// ============================================
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;

  // Search all buses for a matching token
  const match = Object.entries(buses).find(([id, bus]) => bus.driverToken === token);

  if (match) {
    const [busId, busInfo] = match;
    res.json({ success: true, busId, name: busInfo.name, route: busInfo.route });
  } else {
    res.json({ success: false, message: 'Invalid token. Please check with admin.' });
  }
});

// Send bus list to frontend (without tokens — never expose tokens!)
app.get('/api/buses', (req, res) => {
  const safeBusList = Object.entries(buses).map(([id, bus]) => ({
    id,
    name: bus.name,
    route: bus.route,
    color: bus.color,
    isActive: !!activeBuses[id],
  }));
  res.json(safeBusList);
});

// ============================================
// SOCKET.IO — Real-time communication
// ============================================
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // --- DRIVER connects and starts sharing location ---
  socket.on('driver:start', ({ busId, token }) => {
    const bus = buses[busId];

    // Verify the token before allowing tracking
    if (!bus || bus.driverToken !== token) {
      socket.emit('driver:error', 'Invalid token or bus ID.');
      return;
    }

    // Register this driver as active
    socket.busId = busId;
    socket.role = 'driver';
    socket.join(`bus:${busId}`);

    activeBuses[busId] = {
      lat: null,
      lng: null,
      speed: 0,
      heading: 0,
      lastSeen: null,
      driverConnected: true,
    };

    console.log(`🚌 Driver connected for ${bus.name}`);

    // Tell all students this bus is now active
    io.emit('bus:activated', { busId, name: bus.name, route: bus.route, color: bus.color });
    socket.emit('driver:confirmed', { busId, name: bus.name });
  });

  // --- DRIVER sends a location update ---
  socket.on('driver:location', ({ busId, token, lat, lng, speed, heading }) => {
    const bus = buses[busId];
    if (!bus || bus.driverToken !== token) return; // silent reject if invalid

    // Update our in-memory store
    activeBuses[busId] = {
      lat, lng, speed, heading,
      lastSeen: new Date().toISOString(),
      driverConnected: true,
    };

    // Broadcast to ALL connected students instantly
    io.emit('bus:location', { busId, lat, lng, speed, heading });
  });

  // --- STUDENT requests current snapshot of all active buses ---
  socket.on('student:getActiveBuses', () => {
    Object.entries(activeBuses).forEach(([busId, data]) => {
      if (data.lat && buses[busId]) {
        socket.emit('bus:location', {
          busId,
          lat: data.lat,
          lng: data.lng,
          speed: data.speed,
          heading: data.heading,
        });
        socket.emit('bus:activated', {
          busId,
          name: buses[busId].name,
          route: buses[busId].route,
          color: buses[busId].color,
        });
      }
    });
  });

  // --- Handle disconnection ---
  socket.on('disconnect', () => {
    if (socket.role === 'driver' && socket.busId) {
      const busId = socket.busId;
      delete activeBuses[busId];
      console.log(`🔴 Driver disconnected: ${busId}`);

      // Tell all students this bus went offline
      io.emit('bus:deactivated', { busId });
    }
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ BRUR Bus Tracker running at http://localhost:${PORT}`);
});