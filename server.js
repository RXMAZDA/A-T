import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart'; // We are keeping this as you are using flutter_map, not Google Maps
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:permission_handler/permission_handler.dart';

const String baseUrl = 'https://a-t.onrender.com'; // Ensure this is correct

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await requestPermissions();
  await testDNS();

  // Set up to ignore SSL certificate errors temporarily for debugging
  HttpOverrides.global = MyHttpOverrides();

  runApp(MyApp());
}

class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (X509Certificate cert, String host, int port) {
        // Allow all certificates, this is for testing only.
        return true;
      };
  }
}

Future<void> requestPermissions() async {
  await [
    Permission.location,
    Permission.notification,
  ].request();
}

Future<void> testDNS() async {
  try {
    final result = await InternetAddress.lookup('a-t.onrender.com');
    if (result.isNotEmpty && result[0].rawAddress.isNotEmpty) {
      print('DNS resolved: ${result[0].address}');
    }
  } catch (e) {
    print('DNS resolution failed: $e');
  }
}

// Main entry point for the app
class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Emergency Services',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: HomePage(),
    );
  }
}

// HomePage widget, where users can register or log in
class HomePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency Services')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ElevatedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => RegistrationPage()),
              ),
              child: const Text('Register'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => LoginPage()),
              ),
              child: const Text('Login'),
            ),
          ],
        ),
      ),
    );
  }
}

// Registration page for users (Ambulance or Traffic Police)
class RegistrationPage extends StatefulWidget {
  @override
  _RegistrationPageState createState() => _RegistrationPageState();
}

class _RegistrationPageState extends State<RegistrationPage> {
  final TextEditingController nameController = TextEditingController();
  final TextEditingController phoneController = TextEditingController();
  final TextEditingController licenseController = TextEditingController();
  String? role;

  Future<void> registerUser() async {
    if (nameController.text.isEmpty ||
        phoneController.text.isEmpty ||
        role == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all required fields.')),
      );
      return;
    }

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/register'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'name': nameController.text,
              'role': role,
              'licensePlate':
                  role == 'Ambulance Driver' ? licenseController.text : null,
              'phone': phoneController.text,
            }),
          )
          .timeout(const Duration(seconds: 25));

      if (response.statusCode == 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Registration successful!')),
        );
        Navigator.pop(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Registration failed: ${response.body}')),
        );
      }
    } catch (e) {
      print('Error: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Connection failed: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: SingleChildScrollView(
          child: Column(
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              TextField(
                controller: phoneController,
                decoration: const InputDecoration(labelText: 'Phone'),
                keyboardType: TextInputType.phone,
              ),
              DropdownButton<String>(
                value: role,
                hint: const Text('Select Role'),
                items: ['Ambulance Driver', 'Traffic Police']
                    .map((role) => DropdownMenuItem(
                          value: role,
                          child: Text(role),
                        ))
                    .toList(),
                onChanged: (value) => setState(() => role = value),
              ),
              if (role == 'Ambulance Driver')
                TextField(
                  controller: licenseController,
                  decoration: const InputDecoration(labelText: 'License Plate'),
                ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: registerUser,
                child: const Text('Register'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Login Page widget
class LoginPage extends StatefulWidget {
  @override
  _LoginPageState createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final TextEditingController nameController = TextEditingController();
  final TextEditingController phoneController = TextEditingController();

  Future<void> loginUser() async {
    if (nameController.text.isEmpty || phoneController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all fields.')),
      );
      return;
    }

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'name': nameController.text,
              'phone': phoneController.text,
            }),
          )
          .timeout(const Duration(seconds: 25));

      if (response.statusCode == 200) {
        final user = jsonDecode(response.body);

        if (user['role'] == 'Ambulance Driver') {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => AmbulanceDriverPage(user),
            ),
          );
        } else {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => TrafficPolicePage(user),
            ),
          );
        }
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Login failed: ${response.body}')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Connection failed: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Login')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            TextField(
              controller: phoneController,
              decoration: const InputDecoration(labelText: 'Phone'),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: loginUser,
              child: const Text('Login'),
            ),
          ],
        ),
      ),
    );
  }
}

// Ambulance Driver Page Widget
class AmbulanceDriverPage extends StatefulWidget {
  final Map<String, dynamic> user;

  AmbulanceDriverPage(this.user);

  @override
  _AmbulanceDriverPageState createState() => _AmbulanceDriverPageState();
}

class _AmbulanceDriverPageState extends State<AmbulanceDriverPage> {
  late IO.Socket socket;
  Position? currentPosition;
  List<Map<String, dynamic>> hospitals = [];
  Map<String, dynamic>? selectedHospital;
  List<LatLng> routeCoordinates = [];
  bool isLoading = false;
  String trafficStatus = ''; // Added to store traffic status

  @override
  void initState() {
    super.initState();
    _initializeSocket();
    _startLocationTracking();

    // Listen for traffic status updates
    socket.on('trafficStatusUpdate', (data) {
      print('Traffic status update received: $data'); // Log incoming data
      setState(() {
        trafficStatus = 'Traffic status: ${data['status']}';
      });

      // Notify the user
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Traffic Status: ${data['status']}')),
      );
    });
  }

  void _initializeSocket() {
    socket = IO.io(baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'secure': true,
      'rejectUnauthorized': false,
    });

    socket.onConnect((_) {
      print('Connected to server as ambulance driver');
      socket.emit('registerRole', {
        'name': widget.user['name'],
        'role': 'Ambulance Driver',
        'licensePlate': widget.user['licensePlate'],
        'phone': widget.user['phone'],
      });
    });
    socket.on('receiveNotification', (data) {
      print('Notification received: ${data['message']}');
      setState(() {
        trafficStatus =
            data['message']; // Update trafficStatus for display if needed.
      });

      // Display the notification as a popup
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(data['message'])),
      );
    });
  }

  // Start tracking the ambulance driver's location
  void _startLocationTracking() async {
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.deniedForever ||
        permission == LocationPermission.denied) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Location permissions are required.")),
      );
      return;
    }

    // Use high accuracy settings
    Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.best, // Use the most accurate setting
        distanceFilter: 5, // Update every 5 meters
      ),
    ).listen((Position position) {
      setState(() {
        currentPosition = position;
      });
      _fetchNearbyHospitals(); // Refresh hospital data
    });
  }

  // Fetch nearby hospitals from the backend
  Future<void> _fetchNearbyHospitals() async {
    if (currentPosition == null) return;

    try {
      final response = await http.get(Uri.parse(
          '$baseUrl/hospitals?lat=${currentPosition!.latitude}&lon=${currentPosition!.longitude}'));

      if (response.statusCode == 200) {
        final fetchedHospitals =
            List<Map<String, dynamic>>.from(jsonDecode(response.body));

        if (fetchedHospitals.isNotEmpty) {
          final nearest = fetchedHospitals.reduce((current, next) {
            final currentDistance = Geolocator.distanceBetween(
              currentPosition!.latitude,
              currentPosition!.longitude,
              current['lat'],
              current['lon'],
            );
            final nextDistance = Geolocator.distanceBetween(
              currentPosition!.latitude,
              currentPosition!.longitude,
              next['lat'],
              next['lon'],
            );
            return currentDistance < nextDistance ? current : next;
          });

          setState(() {
            hospitals = fetchedHospitals;
            selectedHospital = nearest;
          });

          _fetchRouteToHospital();
        }
      } else {
        throw Exception('Failed to fetch hospitals');
      }
    } catch (e) {
      print('Error fetching hospitals: $e');
    }
  }

  List<List<LatLng>> alternateRoutes = []; // List of alternate routes
  int currentRouteIndex = 0; // Keeps track of the active route

  Future<void> _fetchRouteToHospital() async {
    if (currentPosition == null || selectedHospital == null) return;

    try {
      final response = await http.get(Uri.parse(
          '$baseUrl/route?startLat=${currentPosition!.latitude}&startLon=${currentPosition!.longitude}&endLat=${selectedHospital!['lat']}&endLon=${selectedHospital!['lon']}'));

      if (response.statusCode == 200) {
        final routeGeoJson = jsonDecode(response.body);

        setState(() {
          // Set main route
          routeCoordinates = (routeGeoJson['mainRoute']['coordinates'] as List)
              .map((point) => LatLng(point[1], point[0]))
              .toList();

          // Set alternative routes
          alternateRoutes =
              (routeGeoJson['alternateRoutes'] as List).map((route) {
            return (route['coordinates'] as List)
                .map((point) => LatLng(point[1], point[0]))
                .toList();
          }).toList();
          currentRouteIndex = 0; // Reset the route index
        });
      } else {
        throw Exception('Failed to fetch routes');
      }
    } catch (e) {
      print('Error fetching routes: $e');
    }
  }

  void _switchRoute() {
    if (alternateRoutes.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No alternate routes available')),
      );
      return;
    }

    // Cycle through alternate routes
    setState(() {
      currentRouteIndex = (currentRouteIndex + 1) % alternateRoutes.length;
      routeCoordinates = alternateRoutes[currentRouteIndex];
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Switched to an alternate route')),
    );
  }

  // Implement switch next nearest hospital functionality
  // Switch Next Nearest Hospital Logic
  void _switchNextNearestHospital() async {
    if (hospitals.isEmpty || currentPosition == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('No alternative hospitals or routes available')),
      );
      return;
    }

    // Remove the currently selected hospital from the list of hospitals
    hospitals.removeWhere((hospital) =>
        hospital['lat'] == selectedHospital?['lat'] &&
        hospital['lon'] == selectedHospital?['lon']);

    if (hospitals.isNotEmpty) {
      // Select the next nearest hospital
      final nextHospital = hospitals.reduce((current, next) {
        final currentDistance = Geolocator.distanceBetween(
          currentPosition!.latitude,
          currentPosition!.longitude,
          current['lat'],
          current['lon'],
        );
        final nextDistance = Geolocator.distanceBetween(
          currentPosition!.latitude,
          currentPosition!.longitude,
          next['lat'],
          next['lon'],
        );
        return nextDistance < currentDistance ? next : current;
      });

      setState(() {
        selectedHospital = nextHospital;
      });

      // Fetch the route to the new hospital
      await _fetchRouteToHospital();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'Switched to the next nearest hospital: ${nextHospital['name']}')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No alternative hospitals available')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ambulance Driver')),
      body: currentPosition == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (trafficStatus.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(8.0),
                    child: Container(
                      padding: EdgeInsets.all(10),
                      color: Colors.orangeAccent,
                      child: Text(
                        trafficStatus != null
                            ? trafficStatus
                            : 'No traffic status available',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                Expanded(
                  flex: 3,
                  child: FlutterMap(
                    options: MapOptions(
                      center: LatLng(
                          currentPosition!.latitude,
                          currentPosition!
                              .longitude), // Corrected from "Center" to "center"
                      zoom: 15.0,
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        subdomains: ['a', 'b', 'c'],
                      ),
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: LatLng(currentPosition!.latitude,
                                currentPosition!.longitude),
                            width: 40, // Specify width
                            height: 40, // Specify height
                            builder: (ctx) => const Icon(
                              Icons.location_pin,
                              color: Colors.red,
                              size: 40,
                            ),
                          ),
                          if (selectedHospital != null)
                            Marker(
                              point: LatLng(selectedHospital!['lat'],
                                  selectedHospital!['lon']),
                              width: 40, // Specify width
                              height: 40, // Specify height
                              builder: (ctx) => const Icon(
                                Icons.local_hospital,
                                color: Colors.blue,
                                size: 40,
                              ),
                            ),
                        ],
                      ),
                      PolylineLayer(
                        polylines: [
                          Polyline(
                            points: routeCoordinates,
                            strokeWidth: 4.0,
                            color: Colors.blue,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    ElevatedButton(
                      onPressed: _switchRoute,
                      child: const Text('Switch Route'),
                    ),
                    ElevatedButton(
                      onPressed: _switchNextNearestHospital,
                      child: const Text('Switch Next Nearest Hospital'),
                    ),
                  ],
                ),
                ElevatedButton(
                  onPressed: _sendEmergencyAlert,
                  child: const Text('Send Emergency Alert'),
                ),
              ],
            ),
    );
  }

  void _sendEmergencyAlert() {
    if (currentPosition != null && selectedHospital != null) {
      socket.emit('emergency', {
        'licensePlate': widget.user['licensePlate'],
        'location': {
          'lat': currentPosition!.latitude,
          'lon': currentPosition!.longitude,
        },
        'hospital': selectedHospital,
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Emergency alert sent!')),
      );
    }
  }
}

class TrafficPolicePage extends StatefulWidget {
  final Map<String, dynamic> user;

  TrafficPolicePage(this.user);

  @override
  _TrafficPolicePageState createState() => _TrafficPolicePageState();
}

class _TrafficPolicePageState extends State<TrafficPolicePage> {
  late IO.Socket socket;
  Map<String, dynamic>? emergencyDetails;
  bool isLoading = false;
  LatLng? ambulanceLocation; // Store the ambulance's location

  @override
  void initState() {
    super.initState();
    _initializeSocket();
  }

  void _initializeSocket() {
    socket = IO.io(baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'secure': true,
      'rejectUnauthorized': false,
    });

    socket.onConnect((_) {
      print('Connected to server as traffic police');
      socket.emit('registerRole', {
        'name': widget.user['name'],
        'role': 'Traffic Police',
        'phone': widget.user['phone'],
      });
    });

    socket.on('emergencyAlert', (data) {
      print(
          'Emergency Alert Received: $data'); // Check if licensePlate is present.
      setState(() {
        emergencyDetails = data;
        ambulanceLocation =
            LatLng(data['location']['lat'], data['location']['lon']);
        isLoading = false;
      });
    });

    socket.onDisconnect((_) => print('Disconnected from server'));
  }

  void _sendNotification(String status) {
    if (emergencyDetails != null) {
      socket.emit('sendNotification', {
        'licensePlate':
            emergencyDetails!['licensePlate'], // Specify the target ambulance.
        'phone':
            emergencyDetails!['phone'], // Optionally include the phone number.
        'message': 'Traffic is $status.', // Notification message.
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Notification sent: Traffic is $status.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Traffic Police')),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : emergencyDetails == null
              ? const Center(child: Text('No emergencies reported.'))
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Text(
                        'Ambulance License Plate: ${emergencyDetails?['licensePlate'] ?? 'Unknown'}',
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Text(
                        'Ambulance Location: ${emergencyDetails?['location']?['lat'] ?? 'Unknown'}, '
                        '${emergencyDetails?['location']?['lon'] ?? 'Unknown'}',
                        style: const TextStyle(fontSize: 16),
                      ),
                    ),
                    Expanded(
                      child: FlutterMap(
                        options: MapOptions(
                          center: ambulanceLocation ?? LatLng(0, 0),
                          zoom: 15.0,
                        ),
                        children: [
                          TileLayer(
                            urlTemplate:
                                'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                            subdomains: ['a', 'b', 'c'],
                          ),
                          MarkerLayer(
                            markers: [
                              if (ambulanceLocation != null)
                                Marker(
                                  point: ambulanceLocation!,
                                  width: 40,
                                  height: 40,
                                  builder: (ctx) => const Icon(
                                    Icons.local_hospital,
                                    color: Colors.blue,
                                    size: 40,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    ElevatedButton(
                      onPressed: () => _sendNotification('Clear'),
                      child: const Text('Mark Traffic Clear'),
                    ),
                    ElevatedButton(
                      onPressed: () => _sendNotification('Not Clear'),
                      child: const Text('Mark Traffic Not Clear'),
                    ),
                  ],
                ),
    );
  }
}
