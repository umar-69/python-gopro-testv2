from open_gopro import WirelessGoPro
from open_gopro.models.constants import Toggle
from open_gopro.models.constants.settings import VideoResolution, FramesPerSecond, VideoLens, VideoBitRate
from open_gopro.domain.exceptions import GoProError, ConnectFailed
import asyncio
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any, Set
import logging
from bleak import BleakScanner
import aiohttp

class GoProController:
    def __init__(self, client_name: str = "GoProWebController"):
        self.gopro: Optional[WirelessGoPro] = None
        self.client_name = client_name
        self.is_connected = False
        self.is_recording = False
        self.camera_info = {}
        self.status_callbacks = []
        self._connection_lock = asyncio.Lock()
        self._device_db_path = "cohn_db.json"
        self._auto_reconnect_enabled = False  # Disabled by default - only manual connections
        self._reconnect_task: Optional[asyncio.Task] = None
        self._last_known_device = None
        self._camera_target = None  # Store camera identifier for fast reconnection
        self._preferred_interfaces: Set[WirelessGoPro.Interface] = {WirelessGoPro.Interface.BLE, WirelessGoPro.Interface.WIFI_AP}
        self._reconnecting = False  # Flag to prevent concurrent reconnection attempts
        
    async def connect(self) -> Dict[str, Any]:
        """Connect to GoPro camera using WiFi-only strategy with password"""
        async with self._connection_lock:
            try:
                if self.is_connected:
                    return {"success": True, "message": "Already connected", "info": self.camera_info}
            
                # Clean up any existing connection properly
                await self._cleanup_connection_thoroughly()
                
                # Extract camera identifier from saved device info
                target = self._get_camera_target()
                saved_device = self._load_device_info()
                
                # TIER 1: Fast COHN reconnect (Wi-Fi STA mode) - if we're already on home network
                if self._can_use_cohn() and target:
                    logging.info(f"TIER 1: Attempting COHN-only reconnect for target: {target}")
                    
                    # First check if GoPro is reachable on network
                    network_reachable = await self._test_gopro_network_connectivity()
                    if network_reachable:
                        try:
                            self.gopro = WirelessGoPro(
                                interfaces={WirelessGoPro.Interface.COHN},
                                cohn_db=Path(self._device_db_path),
                                target=target
                            )
                            await asyncio.wait_for(
                                self.gopro.open(timeout=5, retries=1),
                                timeout=10
                            )
                            
                            # Wait and verify HTTP connection is working
                            await asyncio.sleep(2)  # Give connection time to stabilize
                            
                            if getattr(self.gopro, 'is_http_connected', False):
                                # Test with a simple HTTP command
                                try:
                                    test_resp = await asyncio.wait_for(
                                        self.gopro.http_command.get_camera_info(),
                                        timeout=10
                                    )
                                    logging.info("COHN HTTP connectivity verified")
                                except Exception as e:
                                    logging.warning(f"COHN HTTP test failed: {e}")
                                    # Continue anyway if basic connection exists
                                
                                logging.info("COHN WiFi connection successful - stopping all fallback attempts")
                                await self._finalize_connection("COHN")
                                return {
                                    "success": True, 
                                    "message": "Connected successfully via COHN WiFi", 
                                    "info": self.camera_info
                                }
                        except Exception as e:
                            logging.warning(f"TIER 1 COHN failed: {e}")
                            await self._cleanup_connection_thoroughly()
                    else:
                        logging.info("GoPro not reachable on home network, trying direct WiFi connection")
                
                # TIER 2: WiFi+COHN combined approach (most stable)
                if saved_device:
                    logging.info("TIER 2: Attempting WiFi+COHN combined connection")
                    result = await self.connect_wifi_cohn_combined()
                    if result["success"]:
                        return result
                
                # If we get here, all WiFi methods failed
                return {"success": False, "message": "All WiFi connection methods failed. Ensure GoPro is powered on and WiFi password is correct."}
                            
            except ConnectFailed as e:
                error_msg = f"All connection tiers failed. Last error: {str(e)}"
                logging.error(error_msg)
                await self._cleanup_connection()
                return {"success": False, "message": error_msg}
            except GoProError as e:
                error_msg = f"GoPro error: {str(e)}"
                logging.error(error_msg)
                await self._cleanup_connection()
                return {"success": False, "message": error_msg}
            except Exception as e:
                error_msg = f"Unexpected connection error: {str(e)}"
                logging.error(error_msg, exc_info=True)
                await self._cleanup_connection()
                return {"success": False, "message": error_msg}

    async def _finalize_connection(self, method: str):
        """Finalize connection setup after successful open()"""
        # Get camera info with timeout and retries
        await self._get_camera_info_with_retry()
        
        # Save device info and target for auto-reconnection
        await self._save_device_info()
        self._update_camera_target()
        
        # Store the camera's identifier for future fast reconnects
        if hasattr(self.gopro, 'identifier'):
            self._camera_target = self.gopro.identifier
            logging.info(f"Stored camera identifier: {self._camera_target}")
        
        self.is_connected = True
        await self._notify_status_change()
        
        # Only start monitoring if auto-reconnect is enabled
        if self._auto_reconnect_enabled:
            self._start_connection_monitor()
        
        logging.info(f"Connection finalized via {method}")

    async def _get_camera_info_with_retry(self, max_retries=3):
        """Get camera info with retry logic - WiFi HTTP preferred"""
        for attempt in range(max_retries):
            try:
                # Try HTTP first if available
                if getattr(self.gopro, 'is_http_connected', False):
                    # Wait a bit longer for camera to be ready
                    if attempt == 0:
                        await asyncio.sleep(2)
                    
                    hw_info = await asyncio.wait_for(
                        self.gopro.http_command.get_camera_info(), 
                        timeout=15  # Longer timeout
                    )
                    if getattr(hw_info, 'ok', False) and hasattr(hw_info, 'data'):
                        self.camera_info = {
                            "model": getattr(hw_info.data, 'model_name', 'GoPro Camera'),
                            "serial": getattr(hw_info.data, 'serial_number', 'Unknown'),
                            "firmware": getattr(hw_info.data, 'firmware_version', 'Unknown')
                        }
                        logging.info(f"Camera info retrieved: {self.camera_info}")
                        return
                    else:
                        logging.warning(f"HTTP camera info failed: {getattr(hw_info, 'status', 'Unknown status')}")
                
                # Use saved info from cohn_db.json if HTTP fails
                saved_device = self._load_device_info()
                if saved_device and saved_device.get('camera_info'):
                    saved_camera = saved_device['camera_info']
                    self.camera_info = {
                        "model": saved_camera.get('model', 'GoPro Camera'),
                        "serial": saved_camera.get('serial', 'Unknown'),
                        "firmware": saved_camera.get('firmware', 'Unknown')
                    }
                    logging.info(f"Using saved camera info: {self.camera_info}")
                    return
                
                # Final fallback info
                self.camera_info = {
                    "model": "GoPro Camera", 
                    "serial": "Unknown", 
                    "firmware": "Unknown"
                }
                logging.info("Using fallback camera info")
                return
                    
            except Exception as e:
                logging.warning(f"Camera info attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2)  # Longer wait between retries
                else:
                    # Use saved or fallback info
                    saved_device = self._load_device_info()
                    if saved_device and saved_device.get('camera_info'):
                        saved_camera = saved_device['camera_info']
                        self.camera_info = {
                            "model": saved_camera.get('model', 'GoPro Camera'),
                            "serial": saved_camera.get('serial', 'Unknown'),
                            "firmware": saved_camera.get('firmware', 'Unknown')
                        }
                        logging.info(f"Using saved camera info after failures: {self.camera_info}")
                    else:
                        self.camera_info = {
                            "model": "GoPro Camera", 
                            "serial": "Unknown", 
                            "firmware": "Unknown"
                        }

    def _get_camera_target(self) -> Optional[str]:
        """Extract camera target identifier from saved device info"""
        if self._camera_target:
            return self._camera_target
        
        saved_device = self._load_device_info()
        if not saved_device:
            return None
        
        # Try to extract target from BLE name or serial
        ble_name = saved_device.get('ble_name', '')
        serial = saved_device.get('camera_info', {}).get('serial', '')
        
        # GoPro BLE names are like "GoPro 5924" - extract last 4 digits
        if ble_name and 'GoPro' in ble_name:
            parts = ble_name.split()
            if len(parts) > 1 and parts[-1].isdigit():
                return parts[-1]
        
        # Fallback to last 4 digits of serial
        if serial and len(serial) >= 4:
            return serial[-4:]
        
        return None

    def _can_use_cohn(self) -> bool:
        """Check if we can use COHN for fast reconnection"""
        # Check if COHN database exists and has credentials
        if not Path(self._device_db_path).exists():
            return False
        
        try:
            with open(self._device_db_path, 'r') as f:
                cohn_data = json.load(f)
                # Check if we have any stored network credentials
                return bool(cohn_data and len(cohn_data) > 0)
        except Exception as e:
            logging.debug(f"Could not read COHN database: {e}")
            return False

    async def _wake_wifi(self) -> bool:
        """
        Hit the GoPro's pair/complete endpoint so that after a reboot
        its Wi-Fi AP comes back online immediately.
        """
        url = (
            f"http://10.5.5.9/gp/gpControl/command/"
            f"wireless/pair/complete?success=1"
            f"&deviceName={self.client_name}"
        )
        try:
            logging.info(f"Attempting to wake GoPro WiFi interface at: {url}")
            async with aiohttp.ClientSession() as session:
                resp = await asyncio.wait_for(
                    session.get(url, timeout=5),
                    timeout=8
                )
                success = resp.status == 200
                if success:
                    logging.info("GoPro WiFi interface awakened successfully")
                    # Give it a moment to fully initialize
                    await asyncio.sleep(2)
                else:
                    logging.warning(f"WiFi wake failed with status: {resp.status}")
                return success
        except Exception as e:
            logging.warning(f"Failed to wake GoPro WiFi: {e}")
            return False

    async def _wait_for_gopro_dhcp(self) -> bool:
        """Wait for macOS to get a proper DHCP lease on GoPro's 10.5.5.x network"""
        try:
            logging.info("Waiting for GoPro DHCP lease...")
            for attempt in range(15):  # Wait up to 15 seconds
                try:
                    # Get current IP address on en0
                    result = await asyncio.create_subprocess_exec(
                        'ipconfig', 'getifaddr', 'en0',
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    stdout, _ = await result.communicate()
                    current_ip = stdout.decode().strip()
                    
                    if current_ip.startswith("10.5.5."):
                        logging.info(f"Got GoPro DHCP lease: {current_ip}")
                        # Additional small wait for network to stabilize
                        await asyncio.sleep(2)
                        return True
                    else:
                        logging.debug(f"Still waiting for 10.5.5.x lease, current IP: {current_ip}")
                        
                except Exception as e:
                    logging.debug(f"DHCP check attempt {attempt + 1} failed: {e}")
                
                await asyncio.sleep(1)
            
            logging.warning("Failed to get GoPro DHCP lease after 15 seconds")
            return False
            
        except Exception as e:
            logging.warning(f"DHCP wait failed: {e}")
            return False

    async def _test_gopro_network_connectivity(self) -> bool:
        """Test if GoPro is reachable on the network"""
        try:
            # Try to ping the GoPro's default IP with longer timeout
            result = await asyncio.create_subprocess_exec(
                'ping', '-c', '2', '-W', '3000', '10.5.5.9',  # 2 pings, 3 second timeout
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(result.wait(), timeout=8)  # Total 8 second timeout
            is_reachable = result.returncode == 0
            if is_reachable:
                logging.debug("GoPro network connectivity confirmed")
            else:
                logging.debug("GoPro not reachable via ping")
            return is_reachable
        except Exception as e:
            logging.debug(f"Network connectivity test failed: {e}")
            return False

    async def _try_os_paired_wifi(self, camera_ssid: str) -> bool:
        """Try to connect to GoPro via OS-paired WiFi networks"""
        try:
            # Check if we're already connected to the GoPro's network
            result = await asyncio.create_subprocess_exec(
                'networksetup', '-getairportnetwork', 'en0',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            stdout, _ = await result.communicate()
            current_network = stdout.decode().strip()
            
            if camera_ssid in current_network:
                logging.info(f"Already connected to GoPro WiFi: {current_network}")
                return True
            
            # Load saved WiFi credentials from cohn_db.json
            wifi_credentials = self._load_gopro_wifi_credentials()
            
            # Try to connect to known GoPro networks with passwords
            gopro_networks = [camera_ssid, "HERO10 Black", "GoPro 5924"]
            
            for network in gopro_networks:
                try:
                    logging.info(f"Trying to connect to OS-saved WiFi network: {network}")
                    
                    # Get password for this network - always required for GoPro
                    password = wifi_credentials.get(network)
                    if not password:
                        logging.info(f"No password found for {network}, skipping (GoPro networks always require password)")
                        continue
                    
                    logging.info(f"Using saved password for {network}")
                    cmd = ['networksetup', '-setairportnetwork', 'en0', network, password]
                    
                    # Attempt to connect to the network
                    result = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    await asyncio.wait_for(result.wait(), timeout=5)
                    
                    if result.returncode == 0:
                        # Wait a moment for connection to establish
                        await asyncio.sleep(2)
                        # Test if we can reach the GoPro
                        logging.info(f"WiFi connection command succeeded for: {network}")
                        return True  # Return success immediately after networksetup succeeds
                    else:
                        logging.warning(f"Failed to connect to {network} (return code: {result.returncode})")
                        
                except Exception as e:
                    logging.debug(f"Failed to connect to {network}: {e}")
                    continue
            
            return False
        except Exception as e:
            logging.warning(f"OS-paired WiFi check failed: {e}")
            return False

    def _load_gopro_wifi_credentials(self) -> Dict[str, str]:
        """Load GoPro WiFi credentials from cohn_db.json or return defaults"""
        try:
            if os.path.exists(self._device_db_path):
                with open(self._device_db_path, 'r') as f:
                    data = json.load(f)
                    # Check if we have wifi_credentials section
                    wifi_creds = data.get('wifi_credentials', {})
                    if wifi_creds:
                        return wifi_creds
                    
                    # Fallback: check if there's AP info in the main data
                    if isinstance(data, dict):
                        for key, value in data.items():
                            if isinstance(value, dict) and 'password' in value:
                                return {value.get('ssid', key): value['password']}
        except Exception as e:
            logging.debug(f"Could not load WiFi credentials: {e}")
        
        # Return empty dict - will try without password (relies on macOS keychain)
        return {}

    def _update_camera_target(self):
        """Update camera target from current connection"""
        if not self.gopro:
            return
        
        # Try to get target from BLE device name
        try:
            if hasattr(self.gopro, '_ble') and self.gopro._ble._device:
                ble_name = str(self.gopro._ble._device.name)
                if 'GoPro' in ble_name:
                    parts = ble_name.split()
                    if len(parts) > 1 and parts[-1].isdigit():
                        self._camera_target = parts[-1]
                        logging.info(f"Updated camera target: {self._camera_target}")
        except Exception as e:
            logging.debug(f"Could not extract camera target: {e}")

    async def _cleanup_connection_thoroughly(self):
        """Thoroughly clean up connection state and resources"""
        # Stop monitoring first
        self._stop_connection_monitor()
        
        if self.gopro:
            try:
                # Attempt graceful close with timeout
                await asyncio.wait_for(self.gopro.close(), timeout=5)
                logging.debug("GoPro connection closed gracefully")
            except asyncio.TimeoutError:
                logging.warning("GoPro close operation timed out")
            except Exception as e:
                logging.debug(f"Error during GoPro close: {e}")
            finally:
                self.gopro = None
        
        # Reset state
        self.is_connected = False
        self.is_recording = False
        self._reconnecting = False  # Reset reconnection flag
        
        # Give system time to clean up BLE resources
        await asyncio.sleep(1)

    async def _cleanup_connection(self):
        """Clean up connection state (legacy method)"""
        await self._cleanup_connection_thoroughly()

    def _load_device_info(self) -> Optional[Dict[str, Any]]:
        """Load saved device information"""
        try:
            if os.path.exists(self._device_db_path):
                with open(self._device_db_path, 'r') as f:
                    data = json.load(f)
                    return data.get('last_known_device')
        except Exception as e:
            logging.warning(f"Could not load device info: {e}")
        return None

    async def _save_device_info(self):
        """Save current device information for auto-reconnection"""
        try:
            device_info = {
                "camera_info": self.camera_info,
                "connected_at": asyncio.get_event_loop().time(),
                "device_fingerprint": self._generate_device_fingerprint()
            }
            
            # Try to get BLE device info if available
            if self.gopro and hasattr(self.gopro, '_ble') and self.gopro._ble._device:
                device_info["ble_address"] = str(self.gopro._ble._device.address)
                device_info["ble_name"] = str(self.gopro._ble._device.name)
            
            # Try to get WiFi AP info if available
            wifi_info = {}
            if self.gopro and hasattr(self.gopro, '_wifi') and self.gopro._wifi:
                try:
                    # Extract AP info from the camera
                    if hasattr(self.gopro._wifi, '_ssid') and hasattr(self.gopro._wifi, '_password'):
                        ssid = getattr(self.gopro._wifi, '_ssid', None)
                        password = getattr(self.gopro._wifi, '_password', None)
                        if ssid and password:
                            wifi_info[ssid] = password
                            logging.info(f"Saved WiFi credentials for: {ssid}")
                except Exception as e:
                    logging.debug(f"Could not extract WiFi credentials: {e}")
            
            # Load existing data to preserve WiFi credentials
            existing_data = {}
            if os.path.exists(self._device_db_path):
                try:
                    with open(self._device_db_path, 'r') as f:
                        existing_data = json.load(f)
                except Exception:
                    pass
            
            data = {
                "last_known_device": device_info,
                "saved_at": asyncio.get_event_loop().time(),
                "version": "1.0",
                "wifi_credentials": {**existing_data.get('wifi_credentials', {}), **wifi_info}
            }
            
            with open(self._device_db_path, 'w') as f:
                json.dump(data, f, indent=2)
                
            self._last_known_device = device_info
            logging.info(f"Device info saved: {self.camera_info.get('model', 'Unknown')} ({self.camera_info.get('serial', 'Unknown')})")
            
        except Exception as e:
            logging.warning(f"Could not save device info: {e}")

    def set_gopro_wifi_password(self, ssid: str, password: str) -> Dict[str, Any]:
        """Manually set GoPro WiFi password for OS-paired connections"""
        try:
            # Load existing data
            existing_data = {}
            if os.path.exists(self._device_db_path):
                with open(self._device_db_path, 'r') as f:
                    existing_data = json.load(f)
            
            # Update WiFi credentials
            wifi_credentials = existing_data.get('wifi_credentials', {})
            wifi_credentials[ssid] = password
            existing_data['wifi_credentials'] = wifi_credentials
            
            # Save back to file
            with open(self._device_db_path, 'w') as f:
                json.dump(existing_data, f, indent=2)
            
            logging.info(f"WiFi password saved for: {ssid}")
            return {"success": True, "message": f"WiFi password saved for {ssid}"}
            
        except Exception as e:
            logging.error(f"Failed to save WiFi password: {e}")
            return {"success": False, "message": f"Failed to save WiFi password: {str(e)}"}

    def _generate_device_fingerprint(self) -> str:
        """Generate a unique fingerprint for the device"""
        model = self.camera_info.get('model', '')
        serial = self.camera_info.get('serial', '')
        firmware = self.camera_info.get('firmware', '')
        return f"{model}_{serial}_{firmware}".replace(' ', '_')

    def _validate_device_fingerprint(self, saved_device: Dict[str, Any]) -> bool:
        """Validate that the current device matches the saved device"""
        if not saved_device:
            return False
        
        saved_fingerprint = saved_device.get('device_fingerprint', '')
        current_fingerprint = self._generate_device_fingerprint()
        
        # Also check individual components for backwards compatibility
        saved_camera = saved_device.get('camera_info', {})
        current_camera = self.camera_info
        
        model_match = saved_camera.get('model') == current_camera.get('model')
        serial_match = saved_camera.get('serial') == current_camera.get('serial')
        
        fingerprint_match = saved_fingerprint == current_fingerprint
        component_match = model_match and serial_match
        
        return fingerprint_match or component_match

    def _start_connection_monitor(self):
        """Start background connection monitoring"""
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        
        self._reconnect_task = asyncio.create_task(self._connection_monitor())

    def _stop_connection_monitor(self):
        """Stop background connection monitoring"""
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        self._reconnect_task = None

    async def _connection_monitor(self):
        """Monitor WiFi connection and auto-reconnect if needed"""
        consecutive_failures = 0
        while self._auto_reconnect_enabled:
            try:
                await asyncio.sleep(15)  # Check every 15 seconds (less aggressive)
                
                if not self.is_connected:
                    consecutive_failures = 0  # Reset counter
                    continue
                
                # Check WiFi/HTTP connection stability
                if self.gopro and getattr(self.gopro, 'is_http_connected', False):
                    # Test actual connectivity to GoPro
                    if await self._test_gopro_network_connectivity():
                        logging.debug("WiFi connection stable, monitoring continues")
                        consecutive_failures = 0  # Reset counter
                        continue
                    else:
                        consecutive_failures += 1
                        logging.warning(f"WiFi ping failed (attempt {consecutive_failures}/3)")
                        
                        # Only trigger reconnection after 3 consecutive failures
                        if consecutive_failures >= 3:
                            logging.warning("WiFi connection lost after 3 failed pings - attempting reconnection")
                            consecutive_failures = 0
                            await self._handle_disconnection()
                else:
                    consecutive_failures += 1
                    logging.warning(f"HTTP connection lost (attempt {consecutive_failures}/3)")
                    
                    # Only trigger reconnection after 3 consecutive failures
                    if consecutive_failures >= 3:
                        logging.warning("HTTP connection lost after 3 attempts - attempting reconnection")
                        consecutive_failures = 0
                        await self._handle_disconnection()
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                logging.error(f"Connection monitor error: {e}")
                await asyncio.sleep(5)

    async def _handle_disconnection(self):
        """Handle unexpected disconnection"""
        try:
            # Prevent concurrent reconnection attempts
            if self._reconnecting:
                logging.debug("Disconnection handling already in progress, skipping")
                return
            
            self._reconnecting = True
            
            # Mark as disconnected
            self.is_connected = False
            self.is_recording = False
            await self._notify_status_change()
            
            # Only attempt reconnection if auto-reconnect is enabled
            if self._auto_reconnect_enabled and self._last_known_device:
                logging.info("Auto-reconnect enabled - attempting automatic reconnection...")
                await asyncio.sleep(5)  # Delay before reconnect
                result = await self._auto_reconnect()
                if result["success"]:
                    logging.info("Auto-reconnection successful")
                else:
                    logging.warning(f"Auto-reconnection failed: {result['message']}")
            else:
                logging.info("Auto-reconnect disabled - waiting for manual connection")
                    
        except Exception as e:
            logging.error(f"Error handling disconnection: {e}")
        finally:
            self._reconnecting = False

    async def _auto_reconnect(self) -> Dict[str, Any]:
        """Attempt to reconnect to the last known device with COHN priority"""
        try:
            # Use the regular connect method which now has smart COHN/BLE fallback logic
            return await self.connect()
        except Exception as e:
            return {"success": False, "message": f"Auto-reconnection failed: {str(e)}"}

    async def connect_wifi_cohn_combined(self) -> Dict[str, Any]:
        """Sequential WiFi + COHN connection for maximum stability"""
        target = self._get_camera_target()
        saved_device = self._load_device_info()
        
        if not target or not saved_device:
            return {"success": False, "message": "WiFi+COHN not available - no target or saved device"}
        
        try:
            await self._cleanup_connection_thoroughly()
            
            # Step 0: Wake GoPro WiFi interface (critical after reboot)
            camera_ssid = saved_device.get("camera_info", {}).get("model", "HERO10 Black")
            logging.info("Step 0: Waking GoPro WiFi interface after potential reboot...")
            
            # First try to join WiFi to reach the wake endpoint
            if await self._try_os_paired_wifi(camera_ssid):
                # Now wake the WiFi interface
                if not await self._wake_wifi():
                    logging.warning("WiFi wake failed, but continuing with connection attempt")
            else:
                logging.warning("Could not join WiFi to wake interface, but continuing")
            
            # Step 1: Ensure we're connected to WiFi (may need to reconnect after wake)
            logging.info(f"Step 1: Ensuring WiFi connection to: {camera_ssid}")
            if not await self._try_os_paired_wifi(camera_ssid):
                return {"success": False, "message": "Failed to join WiFi network"}
            
            # Step 2: Wait for proper DHCP lease
            logging.info("Step 2: Waiting for DHCP lease...")
            if not await self._wait_for_gopro_dhcp():
                return {"success": False, "message": "Failed to get GoPro DHCP lease"}
            
            # Step 3: Open COHN connection (using existing WiFi network)
            logging.info("Step 3: Opening COHN connection...")
            self.gopro = WirelessGoPro(
                interfaces={WirelessGoPro.Interface.COHN},
                cohn_db=Path(self._device_db_path),
                target=target
            )
            await asyncio.wait_for(
                self.gopro.open(timeout=5, retries=1),
                timeout=15
            )
            
            # Step 4: Verify HTTP channel works
            logging.info("Step 4: Verifying HTTP connectivity...")
            if getattr(self.gopro, 'is_http_connected', False):
                await self._finalize_connection("WiFi+COHN Sequential")
                return {
                    "success": True,
                    "message": f"WiFi+COHN sequential connection successful to {camera_ssid}",
                    "info": self.camera_info
                }
            else:
                return {"success": False, "message": "COHN opened but HTTP not available"}
            
        except Exception as e:
            await self._cleanup_connection_thoroughly()
            return {"success": False, "message": f"WiFi+COHN sequential failed: {str(e)}"}

    async def connect_cohn_only(self) -> Dict[str, Any]:
        """Attempt COHN-only connection for maximum speed"""
        target = self._get_camera_target()
        if not target or not self._can_use_cohn():
            return {"success": False, "message": "COHN not available - no target or credentials"}
        
        try:
            await self._cleanup_connection_thoroughly()
            
            connection_params = {
                "interfaces": {WirelessGoPro.Interface.COHN},
                "cohn_db": Path(self._device_db_path),
                "target": target
            }
            
            self.gopro = WirelessGoPro(**connection_params)
            await asyncio.wait_for(
                self.gopro.open(timeout=5, retries=2),
                timeout=15
            )
            
            # Get basic camera info
            await self._get_camera_info_with_retry()
            
            self.is_connected = True
            await self._notify_status_change()
            self._start_connection_monitor()
            
            return {
                "success": True,
                "message": f"COHN-only connection successful to target {target}",
                "info": self.camera_info
            }
            
        except Exception as e:
            await self._cleanup_connection()
            return {"success": False, "message": f"COHN-only connection failed: {str(e)}"}

    async def auto_connect_if_known(self) -> Dict[str, Any]:
        """Try to auto-connect to a previously connected device"""
        if self.is_connected:
            return {"success": True, "message": "Already connected", "info": self.camera_info}
        
        saved_device = self._load_device_info()
        if not saved_device:
            return {"success": False, "message": "No previously connected device found"}
        
        saved_camera = saved_device.get('camera_info', {})
        device_model = saved_camera.get('model', 'Unknown GoPro')
        device_serial = saved_camera.get('serial', 'Unknown')
        
        self._last_known_device = saved_device
        logging.info(f"Found saved device: {device_model} (Serial: {device_serial})")
        
        # Try WiFi+COHN combined first (most stable)
        if self._can_use_cohn():
            combined_result = await self.connect_wifi_cohn_combined()
            if combined_result["success"]:
                logging.info("Auto-connect via WiFi+COHN combined successful")
                return {
                    "success": True,
                    "message": f"Auto-connected to {device_model} via WiFi+COHN",
                    "info": combined_result.get("info", {})
                }
            else:
                logging.info("WiFi+COHN combined failed, trying COHN-only")
                
                # Fallback to COHN-only
                cohn_result = await self.connect_cohn_only()
                if cohn_result["success"]:
                    logging.info("Auto-connect via COHN-only successful")
                    return {
                        "success": True,
                        "message": f"Auto-connected to {device_model} via COHN",
                        "info": cohn_result.get("info", {})
                    }
                else:
                    logging.info("COHN-only also failed, trying full connection")
        
        # Fallback to regular connection
        result = await self.connect()
        if result["success"]:
            # Validate that we connected to the same device
            if self._validate_device_fingerprint(saved_device):
                return {
                    "success": True, 
                    "message": f"Auto-connected to {device_model}", 
                    "info": result.get("info", {})
                }
            else:
                # Connected to different device - disconnect and warn
                await self.disconnect()
                return {
                    "success": False, 
                    "message": f"Connected to different device than saved {device_model}. Manual connection required."
                }
        else:
            return {"success": False, "message": f"Failed to connect to {device_model}: {result['message']}"}

    def clear_saved_device(self) -> Dict[str, Any]:
        """Clear saved device information"""
        try:
            if os.path.exists(self._device_db_path):
                os.remove(self._device_db_path)
            self._last_known_device = None
            self._camera_target = None  # Clear cached target
            logging.info("Saved device information cleared")
            return {"success": True, "message": "Saved device information cleared"}
        except Exception as e:
            logging.error(f"Failed to clear device info: {e}")
            return {"success": False, "message": f"Failed to clear device info: {str(e)}"}

    def get_saved_device_info(self) -> Dict[str, Any]:
        """Get saved device information with additional details"""
        saved_device = self._load_device_info()
        if not saved_device:
            return {"success": False, "message": "No saved device found"}
        
        camera_info = saved_device.get('camera_info', {})
        connected_at = saved_device.get('connected_at', 0)
        
        # Convert timestamp to readable format
        try:
            from datetime import datetime
            connected_time = datetime.fromtimestamp(connected_at).strftime("%Y-%m-%d %H:%M:%S")
        except:
            connected_time = "Unknown"
        
        return {
            "success": True,
            "device_info": {
                "model": camera_info.get('model', 'Unknown'),
                "serial": camera_info.get('serial', 'Unknown'),
                "firmware": camera_info.get('firmware', 'Unknown'),
                "last_connected": connected_time,
                "ble_name": saved_device.get('ble_name', 'Unknown'),
                "fingerprint": saved_device.get('device_fingerprint', 'Legacy')
            }
        }

    def enable_auto_reconnect(self, enabled: bool = True):
        """Enable or disable auto-reconnection"""
        self._auto_reconnect_enabled = enabled
        if enabled and self.is_connected:
            self._start_connection_monitor()
        elif not enabled:
            self._stop_connection_monitor()

    def set_connection_interfaces(self, interfaces: Set[str]) -> Dict[str, Any]:
        """Set preferred connection interfaces"""
        try:
            # Map string names to WirelessGoPro.Interface enums
            interface_map = {
                "ble": WirelessGoPro.Interface.BLE,
                "wifi": WirelessGoPro.Interface.WIFI_AP,
                "cohn": WirelessGoPro.Interface.COHN
            }
            
            self._preferred_interfaces = {
                interface_map[iface.lower()]
                for iface in interfaces 
                if iface.lower() in interface_map
            }
            
            if not self._preferred_interfaces:
                self._preferred_interfaces = {WirelessGoPro.Interface.BLE, WirelessGoPro.Interface.WIFI_AP}
            
            logging.info(f"Updated connection interfaces: {[i.name for i in self._preferred_interfaces]}")
            return {"success": True, "message": f"Connection interfaces updated to: {[i.name for i in self._preferred_interfaces]}"}
        except Exception as e:
            return {"success": False, "message": f"Failed to update interfaces: {str(e)}"}

    async def force_reconnect(self) -> Dict[str, Any]:
        """Force a fresh reconnection (clears cached connections)"""
        try:
            # Clear target cache to force fresh discovery
            old_target = self._camera_target
            self._camera_target = None
            
            # Disconnect if connected
            if self.is_connected:
                await self.disconnect()
                await asyncio.sleep(3)  # Increased delay for cleanup
            
            # Attempt fresh connection (will use smart COHN/BLE fallback)
            result = await self.connect()
            
            if result["success"]:
                return {"success": True, "message": "Force reconnection successful"}
            else:
                # Restore target for future attempts
                self._camera_target = old_target
                return {"success": False, "message": f"Force reconnection failed: {result['message']}"}
                
        except Exception as e:
            return {"success": False, "message": f"Force reconnection error: {str(e)}"}
    
    async def disconnect(self) -> Dict[str, Any]:
        """Disconnect from GoPro camera"""
        async with self._connection_lock:
            try:
                await self._cleanup_connection()
                await asyncio.sleep(2)  # Delay to ensure full cleanup
                await self._notify_status_change()
                
                return {"success": True, "message": "Disconnected successfully"}
            except Exception as e:
                logging.error(f"Disconnect error: {e}")
            return {"success": False, "message": f"Disconnect failed: {str(e)}"}
    
    async def configure_video_settings(self) -> Dict[str, Any]:
        """Configure video settings for recording"""
        if not self.is_connected or not self.gopro:
            return {"success": False, "message": "Not connected to camera"}
        
        try:
            # Load video preset with timeout
            await asyncio.wait_for(
                self.gopro.ble_command.load_preset_group(group=1000), 
                timeout=10
            )
            
            # Configure video settings with individual timeouts
            setting_tasks = [
                asyncio.wait_for(
                    self.gopro.ble_setting.video_resolution.set(VideoResolution.NUM_4K), 
                    timeout=5
                ),
                asyncio.wait_for(
                    self.gopro.ble_setting.frames_per_second.set(FramesPerSecond.NUM_30_0), 
                    timeout=5
                ),
                asyncio.wait_for(
                    self.gopro.ble_setting.video_lens.set(VideoLens.WIDE), 
                    timeout=5
                ),
                asyncio.wait_for(
                    self.gopro.ble_setting.video_bit_rate.set(VideoBitRate.HIGH), 
                    timeout=5
                )
            ]
            
            # Apply settings with some tolerance for failures
            successful_settings = 0
            for i, task in enumerate(setting_tasks):
                try:
                    await task
                    successful_settings += 1
                except Exception as e:
                    logging.warning(f"Setting {i} failed: {e}")
            
            if successful_settings >= 2:  # At least half the settings worked
                return {"success": True, "message": f"Video settings configured ({successful_settings}/4 settings applied)"}
            else:
                return {"success": False, "message": "Failed to configure most video settings"}
                
        except asyncio.TimeoutError:
            return {"success": False, "message": "Settings configuration timed out"}
        except Exception as e:
            return {"success": False, "message": f"Settings configuration failed: {str(e)}"}
    
    async def start_recording(self) -> Dict[str, Any]:
        """Start video recording via WiFi HTTP commands"""
        if not self.is_connected or not self.gopro:
            return {"success": False, "message": "Not connected to camera"}
        
        if self.is_recording:
            return {"success": False, "message": "Already recording"}
        
        try:
            # WiFi-only approach - use HTTP commands
            if getattr(self.gopro, "is_http_connected", False):
                logging.info("Starting recording via HTTP command")
                resp = await asyncio.wait_for(
                    self.gopro.http_command.set_shutter(shutter=Toggle.ENABLE),
                    timeout=10
                )
                if not getattr(resp, "ok", True):
                    raise GoProError(f"HTTP shutter failed: {getattr(resp, 'status', 'Unknown error')}")
                
                self.is_recording = True
                await self._notify_status_change()
                
                return {"success": True, "message": "Recording started via WiFi HTTP"}
            else:
                return {"success": False, "message": "WiFi not connected - cannot start recording"}
                
        except asyncio.TimeoutError:
            return {"success": False, "message": "Recording start command timed out"}
        except Exception as e:
            return {"success": False, "message": f"Failed to start recording: {str(e)}"}
    
    async def stop_recording(self) -> Dict[str, Any]:
        """Stop video recording via WiFi HTTP commands"""
        if not self.is_connected or not self.gopro:
            return {"success": False, "message": "Not connected to camera"}
        
        if not self.is_recording:
            return {"success": False, "message": "Not currently recording"}
        
        try:
            # WiFi-only approach - use HTTP commands
            if getattr(self.gopro, "is_http_connected", False):
                logging.info("Stopping recording via HTTP command")
                resp = await asyncio.wait_for(
                    self.gopro.http_command.set_shutter(shutter=Toggle.DISABLE),
                    timeout=10
                )
                if not getattr(resp, "ok", True):
                    raise GoProError(f"HTTP shutter failed: {getattr(resp, 'status', 'Unknown error')}")
                
                self.is_recording = False
                await self._notify_status_change()
                
                return {"success": True, "message": "Recording stopped via WiFi HTTP"}
            else:
                return {"success": False, "message": "WiFi not connected - cannot stop recording"}
                
        except asyncio.TimeoutError:
            return {"success": False, "message": "Recording stop command timed out"}
        except Exception as e:
            return {"success": False, "message": f"Failed to stop recording: {str(e)}"}
    
    async def get_latest_media(self) -> Dict[str, Any]:
        """Get information about the latest media file"""
        if not self.is_connected or not self.gopro:
            return {"success": False, "message": "Not connected to camera"}
        
        try:
            if self.gopro.is_http_connected:
                media_list = await self.gopro.http_command.get_media_list()
                if media_list.data and media_list.data.files:
                    latest_file = media_list.data.files[-1].filename
                    filename_only = os.path.basename(latest_file)
                    return {
                        "success": True, 
                        "filename": filename_only,
                        "full_path": latest_file,
                        "can_download": True
                    }
                else:
                    return {"success": False, "message": "No media files found"}
            else:
                return {"success": False, "message": "WiFi not connected - cannot access media"}
        except Exception as e:
            return {"success": False, "message": f"Failed to get media info: {str(e)}"}
    
    async def download_latest_video(self, save_dir: str = "/Users/umartahir-butt/Movies") -> Dict[str, Any]:
        """Download the latest video file"""
        if not self.is_connected or not self.gopro:
            return {"success": False, "message": "Not connected to camera"}
        
        try:
            # Wait for file to finalize
            await asyncio.sleep(3)
            
                        # Always use the existing get_latest_media() method which works reliably
            logging.info("Getting latest media info")
            media_info = await self.get_latest_media()
            if not media_info["success"]:
                return media_info
            
            latest_file = media_info["full_path"]
            filename_only = media_info["filename"]
            
            os.makedirs(save_dir, exist_ok=True)
            save_path = os.path.join(save_dir, filename_only)
            
            # Download via HTTP (works regardless of BLE status)
            await asyncio.wait_for(
                self.gopro.http_command.download_file(camera_file=latest_file, local_file=save_path),
                timeout=120  # Longer timeout for large files
            )
            
            method = "HTTP" if getattr(self.gopro, "is_http_connected", False) else "BLE->HTTP"
            return {
                "success": True, 
                "message": f"Download complete via {method}",
                "local_path": save_path,
                "filename": filename_only
            }
        except Exception as e:
            return {"success": False, "message": f"Download failed: {str(e)}"}
    
    def get_status(self) -> Dict[str, Any]:
        """Get current camera status"""
        ble_connected = False
        wifi_connected = False
        network_reachable = False
        
        if self.gopro:
            try:
                ble_connected = getattr(self.gopro, '_ble', None) and getattr(self.gopro._ble, 'is_connected', False)
                wifi_connected = getattr(self.gopro, 'is_http_connected', False)
            except Exception:
                pass
        
        # Test if we can reach GoPro on network (sync version for status)
        try:
            import subprocess
            result = subprocess.run(['ping', '-c', '1', '-W', '2000', '10.5.5.9'], 
                                  capture_output=True, timeout=3)
            network_reachable = result.returncode == 0
        except Exception:
            network_reachable = False
        
        # Consider connected if we have WiFi OR network is reachable
        effective_connected = self.is_connected or wifi_connected or network_reachable
        
        return {
            "connected": effective_connected,
            "recording": self.is_recording,
            "camera_info": self.camera_info,
            "wifi_connected": wifi_connected or network_reachable,  # Show connected if reachable
            "ble_connected": ble_connected,
            "network_reachable": network_reachable,
            "connection_method": "WiFi (HTTP)" if wifi_connected or network_reachable else "None",
            "can_use_cohn": self._can_use_cohn(),
            "camera_target": self._camera_target
        }
    
    def add_status_callback(self, callback):
        """Add callback for status changes"""
        self.status_callbacks.append(callback)
    
    def remove_status_callback(self, callback):
        """Remove status callback"""
        if callback in self.status_callbacks:
            self.status_callbacks.remove(callback)
    
    async def _notify_status_change(self):
        """Notify all callbacks of status change"""
        status = self.get_status()
        for callback in self.status_callbacks:
            try:
                await callback(status)
            except Exception as e:
                logging.error(f"Status callback error: {e}")