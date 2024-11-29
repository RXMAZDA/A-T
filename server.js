const express = require('express');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');
const ambulanceDriverSockets = {};

// Import the User model
const User = require('./models/User');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;  // Use Render's assigned PORT or 3000 for local testing

// Check environment and decide between HTTP or HTTPS
let server;
if (process.env.NODE_ENV === 'production') {
  // Production environment (use HTTPS)
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'server-key.pem')), // Path to your server key
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server-cert.pem')), // Path to your server cert
  };
  server = require('https').createServer(options, app); // Create HTTPS server
} else {
  // Local development environment (use HTTP)
  server = require('http').createServer(app); // Use HTTP server for local testing
}

// Socket.IO setup
const io = new Server(server);
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// Health Check Endpoint for Render to use
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
    origin: [
      'https://a-t.onrender.com', // Render app's URL
      'http://localhost:3000', // Local development URL
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Routes

// Route to register a user
app.post('/register', async (req, res) => {
  try {
    const user = new User(req.body);  // Create a new user instance from the request body
    await user.save();  // Save the user to MongoDB
    res.status(201).send({ message: 'Registration successful!' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Route to login a user
app.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({
      name: req.body.name,
      phone: req.body.phone,
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found!' });
    }

    res.status(200).send(user);  // Send the user data back if login is successful
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Route to fetch hospitals near a location
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

    cache.set(cacheKey, hospitals);  // Cache the hospital data
    res.status(200).send(hospitals);
  } catch (err) {
    res.status(500).send({ error: 'Error fetching hospitals data' });
  }
});

// Route to get directions (via OSRM)
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
let connectedUsers = {};  // Store connected users

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register ambulance driver
  socket.on('registerRole', (data) => {
      if (data.role === 'Ambulance Driver') {
          ambulanceDriverSockets[data.licensePlate] = socket.id; // Map license plate to socket.id
          console.log(`Ambulance Driver registered: ${data.licensePlate}`);
      }
  });

  // Handle emergency alerts from Ambulance Drivers
  socket.on('emergency', (data) => {
    const { licensePlate, location } = data;
    const nearestPolice = Object.values(connectedUsers).find(
      (user) => user.role === 'Traffic Police'
    );

    if (nearestPolice) {
      nearestPolice.socket.emit('emergencyAlert', { licensePlate, location });

      // Notify the Ambulance Driver of the nearest Traffic Police location
      socket.emit('policeLocation', {
        lat: nearestPolice.lat,
        lon: nearestPolice.lon,
      });
    } else {
      console.error('No Traffic Police available to handle the emergency.');
    }
  });

  // Handle traffic status updates
  s  // Receive traffic status from Traffic Police and forward to the ambulance driver
  socket.on('trafficStatus', (data) => {
      const targetSocketId = ambulanceDriverSockets[data.ambulanceLicensePlate];
      if (targetSocketId) {
          io.to(targetSocketId).emit('trafficStatusUpdate', { status: data.status });
          console.log(`Traffic status sent to ambulance ${data.ambulanceLicensePlate}`);
      } else {
          console.error(`Ambulance Driver with license plate ${data.ambulanceLicensePlate} is not connected.`);
      }
  });

// Function to display the traffic status
function displayTrafficStatus(status) {
  const statusElement = document.getElementById('traffic-status');
  if (statusElement) {
      statusElement.textContent = `Traffic Status: ${status}`;
  } else {
      console.error('Traffic status element not found.');
  }
}
// Ensure the socket instance is initialized
socket.on('trafficStatusUpdate', (data) => {
  console.log('Received Traffic Status Update:', data); // Debugging
  displayTrafficStatus(data.status); // Call function to update the UI
});

  // Update live location for all connected users
  socket.on('updateLocation', (data) => {
    const { lat, lon } = data;
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].lat = lat;
      connectedUsers[socket.id].lon = lon;

      // Broadcast updated location to all other users
      socket.broadcast.emit('liveLocationUpdate', {
        id: socket.id,
        lat,
        lon,
        role: connectedUsers[socket.id].role,
      });
    }
  });

     // Handle driver disconnection
    socket.on('disconnect', () => {
        for (const [licensePlate, id] of Object.entries(ambulanceDriverSockets)) {
            if (id === socket.id) {
                console.log(`Ambulance Driver disconnected: ${licensePlate}`);
                delete ambulanceDriverSockets[licensePlate];
            }
        }
    });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
