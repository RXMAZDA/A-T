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
const PORT = process.env.PORT || 3000;

// Setup HTTPS for production or HTTP for local development
let server;
if (process.env.NODE_ENV === 'production') {
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'server-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server-cert.pem')),
  };
  server = require('https').createServer(options, app);
} else {
  server = require('http').createServer(app);
}

// Socket.IO setup
const io = new Server(server);
const cache = new NodeCache({ stdTTL: 300 });
const connectedUsers = {};

mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: ['https://a-t.onrender.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Routes
app.get('/health', (req, res) => res.status(200).send('Server is healthy'));

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
    const user = await User.findOne({
      name: req.body.name,
      phone: req.body.phone,
    });
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
    const route = response.data.routes[0]?.geometry || null;

    if (route) res.status(200).send(route);
    else res.status(404).send({ error: 'No route found' });
  } catch (err) {
    res.status(500).send({ error: 'Error fetching route data' });
  }
});

// Socket.IO events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('registerRole', (data) => {
    connectedUsers[socket.id] = { ...data, socket };
    console.log(`${data.role} registered: ${data.name || data.licensePlate}`);
  });

  socket.on('emergency', (data) => {
    const { licensePlate, location } = data;
    const nearestPolice = Object.values(connectedUsers).find((user) => user.role === 'Traffic Police');

    if (nearestPolice) {
      nearestPolice.socket.emit('emergencyAlert', { licensePlate, location });
      socket.emit('policeLocation', {
        lat: nearestPolice.lat,
        lon: nearestPolice.lon,
      });
    } else {
      console.error('No Traffic Police available to handle the emergency.');
    }
  });

  socket.on('trafficStatus', (data) => {
    const { status, ambulanceId } = data;
    const targetSocket = Object.values(connectedUsers).find(
      (user) => user.role === 'Ambulance Driver' && user.licensePlate === ambulanceId
    );
    if (targetSocket) targetSocket.socket.emit('trafficStatusUpdate', { status });
  });

  socket.on('updateLocation', (data) => {
    const { lat, lon } = data;
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id] = { ...connectedUsers[socket.id], lat, lon };
      socket.broadcast.emit('liveLocationUpdate', {
        id: socket.id,
        lat,
        lon,
        role: connectedUsers[socket.id].role,
      });
    }
  });

  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) console.log(`${user.role} disconnected: ${user.name || user.licensePlate}`);
    delete connectedUsers[socket.id];
  });
});

// Start the server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
