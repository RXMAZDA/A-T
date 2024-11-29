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

  socket.on('registerRole', (data) => {
    console.log('Registering user:', data);  // Add this line to see incoming user data
    if (data.role === 'Ambulance Driver') {
      if (data.licensePlate) {
        connectedUsers[socket.id] = { ...data, socket };  // Add Ambulance Driver
        console.log(`Ambulance Driver registered: ${data.licensePlate}`);
      } else {
        console.error('Ambulance Driver registration failed: Missing license plate');
      }
    } else if (data.role === 'Traffic Police') {
      connectedUsers[socket.id] = { ...data, socket, lat: data.lat, lon: data.lon };  // Ensure lat/lon are included
      console.log(`Traffic Police registered: ${data.name}`);
    }
  });
  
 // Store ambulance license plate during emergency
 socket.on('emergency', (data) => {
  const { licensePlate, location } = data;

  if (!licensePlate) {
    console.error('Emergency event missing license plate.');
    return;
}

console.log(`Emergency received with license plate: ${licensePlate}`);

// Store the license plate with the user's socket data
  if (connectedUsers[socket.id] && connectedUsers[socket.id].role === 'Ambulance Driver') {
    connectedUsers[socket.id].licensePlate = licensePlate;  // Store license plate with socket
    console.log(`Stored license plate for Ambulance Driver: ${licensePlate}`);
  }

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

  // Client-side (Traffic Police) listening for the emergency alert
socket.on('emergencyAlert', (data) => {
  console.log('Emergency alert received:', data);
  
  // Update UI or handle alert logic, e.g., show notification
  showEmergencyNotification(data);  // Example function to show an alert in the UI
});

// Function to display emergency notification
function showEmergencyNotification(data) {
  alert(`Emergency from Ambulance ${data.licensePlate} at location: ${data.location}`);
}


 // Handle trafficStatus event
 socket.on('trafficStatus', (data) => {
  const { status, ambulanceId } = data;

  if (!ambulanceId) {
      console.error('Missing ambulance license plate in trafficStatus event');
      return;
  }

    // Debugging logs
    console.log('Received trafficStatus event with data:', data);
    console.log('License plate in trafficStatus:', licensePlate);
    
    if (!licensePlate) {
      console.error('Missing ambulance license plate in trafficStatus event');
      return; // Exit if license plate is not available
    }
    
    // Find the socket ID of the ambulance using the stored license plate
  const targetSocketId = Object.keys(connectedUsers).find(
    (socketId) => connectedUsers[socketId].role === 'Ambulance Driver' && 
    connectedUsers[socketId].licensePlate === data.licensePlate  // Use the plate number in the event
  );

  if (targetSocketId) {
    io.to(targetSocketId).emit('trafficStatusUpdate', { status });
    console.log(`Traffic status sent to ambulance with license plate ${data.licensePlate}`);
  } else {
    console.error(`Ambulance Driver with license plate ${data.licensePlate} is not connected.`);
  }
});

  

 // Reset the ambulance license plate after traffic status update
 socket.on('trafficStatusUpdate', () => {
  if (connectedUsers[socket.id] && connectedUsers[socket.id].role === 'Ambulance Driver') {
    delete connectedUsers[socket.id].licensePlate;  // Remove the license plate after status update
    console.log('Ambulance license plate has been reset.');
  }
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
                console.log(`User disconnected: ${connectedUsers[socket.id].role} - ${connectedUsers[socket.id].licensePlate || 'No License Plate'}`);
                delete ambulanceDriverSockets[licensePlate];
            }
        }
    });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
