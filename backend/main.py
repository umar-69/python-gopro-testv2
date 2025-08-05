from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
import asyncio
import logging
from typing import List
from gopro_controller import GoProController
from open_gopro import WirelessGoPro

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GoPro Web Controller", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global GoPro controller instance
gopro_controller = GoProController()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send current status immediately
        status = gopro_controller.get_status()
        await websocket.send_text(json.dumps({"type": "status", "data": status}))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Remove broken connections
                self.active_connections.remove(connection)

manager = ConnectionManager()

# Status change callback for WebSocket updates
async def status_callback(status):
    await manager.broadcast({"type": "status", "data": status})

# Add status callback to controller
gopro_controller.add_status_callback(status_callback)

# No automatic connections - only manual button clicks

# REST API Endpoints
@app.get("/api/status")
async def get_status():
    """Get current GoPro status"""
    return gopro_controller.get_status()

@app.post("/api/connect")
async def connect_gopro():
    """Connect to GoPro camera using WiFi+COHN combined approach"""
    result = await gopro_controller.connect_wifi_cohn_combined()
    if result["success"]:
        # Configure video settings after connection
        config_result = await gopro_controller.configure_video_settings()
        if not config_result["success"]:
            logger.warning(f"Video configuration warning: {config_result['message']}")
    
    await manager.broadcast({"type": "connection", "data": result})
    return result

@app.post("/api/disconnect")
async def disconnect_gopro():
    """Disconnect from GoPro camera"""
    result = await gopro_controller.disconnect()
    await manager.broadcast({"type": "connection", "data": result})
    return result

@app.post("/api/start-recording")
async def start_recording():
    """Start video recording"""
    result = await gopro_controller.start_recording()
    await manager.broadcast({"type": "recording", "data": result})
    return result

@app.post("/api/stop-recording")
async def stop_recording():
    """Stop video recording"""
    result = await gopro_controller.stop_recording()
    await manager.broadcast({"type": "recording", "data": result})
    return result

@app.get("/api/latest-media")
async def get_latest_media():
    """Get information about the latest media file"""
    return await gopro_controller.get_latest_media()

@app.post("/api/download-latest")
async def download_latest():
    """Download the latest video file"""
    result = await gopro_controller.download_latest_video()
    await manager.broadcast({"type": "download", "data": result})
    return result

@app.post("/api/configure-settings")
async def configure_settings():
    """Configure video settings"""
    result = await gopro_controller.configure_video_settings()
    await manager.broadcast({"type": "settings", "data": result})
    return result

@app.post("/api/auto-connect")
async def auto_connect():
    """Try to auto-connect to a previously connected device"""
    result = await gopro_controller.auto_connect_if_known()
    await manager.broadcast({"type": "connection", "data": result})
    return result

@app.post("/api/toggle-auto-reconnect")
async def toggle_auto_reconnect(enabled: bool = True):
    """Enable or disable automatic reconnection"""
    gopro_controller.enable_auto_reconnect(enabled)
    return {"success": True, "message": f"Auto-reconnect {'enabled' if enabled else 'disabled'}"}

@app.get("/api/device-info")
async def get_device_info():
    """Get saved device information with details"""
    return gopro_controller.get_saved_device_info()

@app.post("/api/clear-device")
async def clear_saved_device():
    """Clear saved device information"""
    result = gopro_controller.clear_saved_device()
    await manager.broadcast({"type": "device_cleared", "data": result})
    return result

@app.get("/api/device-status")
async def get_device_status():
    """Get current device connection status and saved device info"""
    current_status = gopro_controller.get_status()
    saved_device = gopro_controller.get_saved_device_info()
    
    return {
        "success": True,
        "current_connection": current_status,
        "saved_device": saved_device.get("device_info") if saved_device["success"] else None,
        "auto_reconnect_enabled": gopro_controller._auto_reconnect_enabled,
        "camera_target": gopro_controller._camera_target,
        "preferred_interfaces": [i.name for i in gopro_controller._preferred_interfaces]
    }

@app.post("/api/force-reconnect")
async def force_reconnect():
    """Force a fresh reconnection (bypasses cached connections)"""
    result = await gopro_controller.force_reconnect()
    await manager.broadcast({"type": "connection", "data": result})
    return result

@app.post("/api/set-interfaces")
async def set_connection_interfaces(interfaces: list[str]):
    """Set preferred connection interfaces"""
    result = gopro_controller.set_connection_interfaces(set(interfaces))
    return result

@app.post("/api/ble-only-connect")
async def ble_only_connect():
    """Connect using BLE only (fastest for reconnection)"""
    # Temporarily set to BLE only
    old_interfaces = gopro_controller._preferred_interfaces
    gopro_controller._preferred_interfaces = {WirelessGoPro.Interface.BLE}
    
    try:
        result = await gopro_controller.connect()
        if result["success"]:
            result["message"] += " (BLE only)"
        await manager.broadcast({"type": "connection", "data": result})
        return result
    finally:
        # Restore original interfaces
        gopro_controller._preferred_interfaces = old_interfaces

@app.post("/api/cohn-only-connect")
async def cohn_only_connect():
    """Connect using COHN only (instant reconnect if provisioned)"""
    result = await gopro_controller.connect_cohn_only()
    await manager.broadcast({"type": "connection", "data": result})
    return result

@app.post("/api/set-wifi-password")
async def set_wifi_password(request: dict):
    """Set GoPro WiFi password for OS-paired connections"""
    ssid = request.get("ssid")
    password = request.get("password")
    if not ssid or not password:
        return {"success": False, "message": "Both ssid and password are required"}
    result = gopro_controller.set_gopro_wifi_password(ssid, password)
    return result

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Echo back any messages (can be used for ping/pong)
            await websocket.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Serve static files (frontend)
try:
    app.mount("/", StaticFiles(directory="../frontend/public", html=True), name="static")
except:
    logger.warning("Frontend static files not found. Frontend may not be built yet.")

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "message": "GoPro Web Controller is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")