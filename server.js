const express = require('express');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');

// Import the User model
const User = require('./models/User');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000; // Use Render's assigned PORT or 3000 for local testing

// Check environment and decide between HTTP or HTTPS
let server;
if (process.env.NODE_ENV === 'production') {
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'server-key.pem')), // Path to your server key
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server-cert.pem')), // Path to your server cert
  };
  server = require('https').createServer(options, app); // Create HTTPS server
} else {
  server = require('http').createServer(app); // Use HTTP server for local testing
}

// Socket.IO setup
const io = new Server(server);
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// Health Check Endpoint
app.get('/health', (req, res) => res.status(200).send('Server is healthy'));

// MongoDB connection setup
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Middleware for CORS and JSON parsing
app.use(express.json());
app.use(
  cors({
    origin: ['https://a-t.onrender.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Routes
app.post('/register', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.status(201).send({ message: 'Registration successful!' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ name: req.body.name, phone: req.body.phone });
    if (!user) return res.status(404).send({ error: 'User not found!' });
    res.status(200).send(user);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

app.get('/hospitals', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const cacheKey = `hospitals_${lat}_${lon}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) return res.status(200).send(cachedData);

    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[out:json];node(around:5000,${lat},${lon})[amenity=hospital];out;`;
    const response = await axios.get(overpassUrl, { timeout: 10000 });

    const hospitals = response.data.elements.map((el) => ({
      name: el.tags.name || 'Unknown',
      lat: el.lat,
      lon: el.lon,
    }));

    cache.set(cacheKey, hospitals);
    res.status(200).send(hospitals);
  } catch (err) {
    res.status(500).send({ error: 'Error fetching hospitals data' });
  }
});

app.get('/route', async (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon } = req.query;
    const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

    const response = await axios.get(osrmUrl, { timeout: 10000 });
    if (response.data.routes.length > 0) {
      res.status(200).send(response.data.routes[0].geometry);
    } else {
      res.status(404).send({ error: 'No route found' });
    }
  } catch (err) {
    res.status(500).send({ error: 'Error fetching route data' });
  }
});

// Socket.IO Events
let connectedUsers = {};
let activeEmergencies = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('registerRole', (data) => {
    connectedUsers[socket.id] = { ...data, socket };
    console.log(`${data.role} registered: ${data.name}`);
  });

  socket.on('emergency', (data) => {
    const { licensePlate, location } = data;
    const nearestPolice = Object.values(connectedUsers).find(
      (user) => user.role === 'Traffic Police'
    );

    if (nearestPolice) {
      activeEmergencies[socket.id] = nearestPolice.socket.id;
      nearestPolice.socket.emit('emergencyAlert', { licensePlate, location });
      socket.emit('policeAssigned', {
        policeLocation: {
          lat: nearestPolice.lat,
          lon: nearestPolice.lon,
        },
      });
    } else {
      socket.emit('noPoliceAvailable');
    }
  });

  socket.on('updateLocation', (data) => {
    const { lat, lon } = data;
    connectedUsers[socket.id].lat = lat;
    connectedUsers[socket.id].lon = lon;

    const pairedSocketId = activeEmergencies[socket.id];
    if (pairedSocketId && connectedUsers[pairedSocketId]) {
      connectedUsers[pairedSocketId].socket.emit('liveLocationUpdate', { lat, lon });
    }
  });

  socket.on('trafficStatus', (data) => {
    const { status } = data;
    const ambulanceSocketId = Object.keys(activeEmergencies).find(
      (key) => activeEmergencies[key] === socket.id
    );

    if (ambulanceSocketId) {
      connectedUsers[ambulanceSocketId].socket.emit('trafficStatusUpdate', { status });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete connectedUsers[socket.id];
    delete activeEmergencies[socket.id];
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
