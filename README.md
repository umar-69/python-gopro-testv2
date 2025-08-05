# 🎥 GoPro Web Controller

A modern web-based interface for controlling your GoPro camera remotely via Bluetooth and WiFi.

## ✨ Features

- **🔗 Wireless Connection**: Connect to your GoPro via Bluetooth Low Energy (BLE)
- **📹 Recording Control**: Start/stop video recording with one click
- **⚙️ Camera Settings**: Configure video quality (4K, 30fps, Wide lens, High bitrate)
- **⬇️ Automatic Download**: Download recorded videos directly to your computer
- **📊 Real-time Status**: Live updates on connection, recording status, and camera info
- **📱 Responsive Design**: Works on desktop and mobile devices

## 🏗️ Architecture

- **Backend**: FastAPI with WebSocket support for real-time communication
- **Frontend**: Svelte with modern, responsive UI
- **Camera Communication**: Open GoPro Python SDK for BLE/WiFi integration

## 📋 Prerequisites

- **GoPro Camera**: HERO9 Black or newer (supports Open GoPro API v2.0)
- **Python**: 3.11+ with Open GoPro SDK installed
- **Node.js**: For building the frontend
- **Bluetooth**: Enabled on your computer

## 🚀 Quick Start

### 1. Start the Backend Server
```bash
cd backend
python main.py
```

### 2. Access the Web Interface
Open your browser and go to: **http://localhost:8000**

### 3. Connect Your GoPro
1. Turn on your GoPro camera
2. Put it in pairing mode: **Preferences → Connections → Connect Device → GoPro App**
3. Click "🔗 Connect to GoPro" in the web interface
4. Wait for connection and automatic configuration

### 4. Start Recording
1. Click "▶️ Start Recording" to begin filming
2. Click "⏹️ Stop Recording" when finished
3. Click "⬇️ Download Latest" to save the video to your Movies folder

## 🎛️ Web Interface Features

### Status Panel
- **Connection Status**: Shows if camera is connected/disconnected/recording
- **Camera Info**: Displays model, serial number, and firmware
- **WiFi Status**: Shows WiFi connection for file downloads

### Control Buttons
- **Connect/Disconnect**: Establish/close connection with GoPro
- **Configure Settings**: Set camera to 4K/30fps/Wide/High bitrate
- **Start/Stop Recording**: Control video recording
- **Download Latest**: Transfer newest video file
- **Refresh Status**: Update camera status

### Activity Log
- Real-time messages showing all operations
- Success/error notifications
- Timestamped activity history

## 🔧 Technical Details

### Backend API Endpoints
- `GET /api/status` - Get current camera status
- `POST /api/connect` - Connect to GoPro
- `POST /api/disconnect` - Disconnect from GoPro
- `POST /api/start-recording` - Start video recording
- `POST /api/stop-recording` - Stop video recording
- `POST /api/download-latest` - Download latest video
- `WebSocket /ws` - Real-time status updates

### File Structure
```
python-gopro-testv2/
├── gopro.py                 # Original CLI script
├── backend/
│   ├── main.py             # FastAPI server
│   └── gopro_controller.py # GoPro integration class
└── frontend/
    ├── src/
    │   ├── App.svelte      # Main UI component
    │   └── main.js         # App entry point
    └── public/
        ├── index.html      # HTML template
        └── build/          # Built assets
```

## 🛠️ Development

### Backend Development
```bash
cd backend
python main.py  # Starts server with auto-reload
```

### Frontend Development
```bash
cd frontend
npm run dev     # Starts development server with hot reload
```

## 📱 Usage Tips

1. **First Connection**: May take longer as the camera pairs
2. **Recording Indicator**: Status shows "Recording" with pulsing animation
3. **WiFi Download**: Automatic download requires WiFi connection
4. **Mobile Friendly**: Interface works on phones and tablets
5. **Real-time Updates**: Status updates automatically via WebSocket

## 🐛 Troubleshooting

- **Connection Issues**: Ensure GoPro is in pairing mode
- **Recording Problems**: Check camera has SD card and battery
- **Download Failures**: Verify WiFi connection between camera and computer
- **Browser Issues**: Try refreshing or use Chrome/Firefox

## 📝 License

MIT License - Feel free to modify and distribute!

---

**Enjoy controlling your GoPro from anywhere with a web browser! 🎬**