const express = require('express');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');

// Initialize constants and configurations
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const connectedUsers = {}; // Store connected users

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
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// Middleware for CORS and JSON parsing
app.use(express.json());
app.use(
  cors({
    origin: [
      'https://a-t.onrender.com',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Health check endpoint
app.get('/health', (req, res) => res.status(200).send('Server is healthy'));

// Socket.IO Events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register user role
  socket.on('registerRole', (data) => {
    console.log('Registering user:', data);

    if (data.role === 'Ambulance Driver' && data.licensePlate) {
      connectedUsers[socket.id] = { ...data, socket };
      console.log(`Ambulance Driver registered: ${data.licensePlate}`);
    } else if (data.role === 'Traffic Police') {
      connectedUsers[socket.id] = { ...data, socket, lat: data.lat, lon: data.lon };
      console.log(`Traffic Police registered: ${data.name}`);
    } else {
      console.error('Invalid role or missing license plate');
    }
  });

  // Emergency event from Ambulance Driver
  socket.on('emergency', (data) => {
    const { licensePlate, location } = data;

    if (!licensePlate) {
      console.error('Emergency event missing license plate');
      return;
    }

    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].licensePlate = licensePlate;
      console.log(`Stored license plate for Ambulance Driver: ${licensePlate}`);
    }

    const nearestPolice = Object.values(connectedUsers).find(
      (user) => user.role === 'Traffic Police'
    );

    if (nearestPolice) {
      nearestPolice.socket.emit('emergencyAlert', { licensePlate, location });
      console.log(`Emergency alert sent to Traffic Police: ${nearestPolice.name}`);
    } else {
      console.error('No Traffic Police available to handle the emergency.');
    }
  });

  // Traffic status update from Traffic Police
  socket.on('trafficStatus', (data) => {
    const { status, ambulanceId } = data;

    const licensePlate =
      ambulanceId || (connectedUsers[socket.id]?.licensePlate);

    if (!licensePlate) {
      console.error('Missing ambulance license plate in trafficStatus event');
      console.log('Connected users:', connectedUsers);
      return;
    }

    const targetSocketId = Object.keys(connectedUsers).find(
      (id) =>
        connectedUsers[id].role === 'Ambulance Driver' &&
        connectedUsers[id].licensePlate === licensePlate
    );

    if (targetSocketId) {
      io.to(targetSocketId).emit('trafficStatusUpdate', { status });
      console.log(`Traffic status sent to ambulance with license plate: ${licensePlate}`);
    } else {
      console.error(`Ambulance Driver with license plate ${licensePlate} is not connected.`);
    }
  });

  // Update live location for users
  socket.on('updateLocation', (data) => {
    const { lat, lon } = data;

    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].lat = lat;
      connectedUsers[socket.id].lon = lon;
      socket.broadcast.emit('liveLocationUpdate', {
        id: socket.id,
        lat,
        lon,
        role: connectedUsers[socket.id].role,
      });
    }
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    if (connectedUsers[socket.id]) {
      console.log(`User disconnected: ${connectedUsers[socket.id].role}`);
      delete connectedUsers[socket.id];
    }
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
