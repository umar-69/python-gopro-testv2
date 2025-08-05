from open_gopro import WirelessGoPro
from open_gopro.models.constants import Toggle
from open_gopro.models.constants.settings import VideoResolution, FramesPerSecond, VideoLens, VideoBitRate
from open_gopro.domain.exceptions import GoProError, ConnectFailed
import asyncio
import os
import time

SAVE_DIR = "/Users/umartahir-butt/Movies"

async def connect_with_retry(max_retries=3):
    """Connect to GoPro with improved error handling"""
    for attempt in range(max_retries):
        try:
            print(f"🔍 Connection attempt {attempt + 1}/{max_retries}...")
            
            # Create GoPro instance with custom settings
            gp = WirelessGoPro(
                ble_retries=2,
                wifi_retries=1
            )
            
            # Try to open with timeout
            await asyncio.wait_for(gp.open(timeout=10, retries=2), timeout=30)
            print("✅ Successfully connected to GoPro!")
            return gp
            
        except GoProError as e:
            if "encoding" in str(e).lower() or "status" in str(e).lower():
                print(f"⚠️  Status observable warning (continuing): {e}")
                return gp  # Continue even if some observables fail
            else:
                print(f"❌ GoPro error on attempt {attempt + 1}: {e}")
        except ConnectFailed as e:
            print(f"❌ Bluetooth connection failed on attempt {attempt + 1}: {e}")
        except asyncio.TimeoutError:
            print(f"❌ Connection timeout on attempt {attempt + 1}")
        except Exception as e:
            print(f"❌ Unexpected error on attempt {attempt + 1}: {e}")
        
        if attempt < max_retries - 1:
            print("⏳ Waiting 5 seconds before retry...")
            await asyncio.sleep(5)
    
    raise Exception("Failed to connect after all retries")

async def main():
    gp = None
    try:
        # Connect with retry logic
        gp = await connect_with_retry()

        # Use BLE commands for initial setup - more reliable
        try:
            print("📋 Getting camera info...")
            hw_info = await asyncio.wait_for(gp.ble_command.get_hardware_info(), timeout=10)
            print(f"Camera: {hw_info.data.model_name} (Serial: {hw_info.data.serial_number})")
        except Exception as e:
            print(f"ℹ️  Could not get camera info: {e}")
            print("📱 Camera connected - proceeding with recording setup...")

        # Set video mode and settings using modern SDK
        print("🎥 Setting video mode and quality...")
        try:
            # Load the video preset first with timeout
            await asyncio.wait_for(gp.ble_command.load_preset_group(group=1000), timeout=10)
            
            # Set video settings with individual timeouts
            settings = [
                ("Resolution", gp.ble_setting.video_resolution.set(VideoResolution.NUM_4K)),
                ("Frame Rate", gp.ble_setting.frames_per_second.set(FramesPerSecond.NUM_30_0)),
                ("Lens", gp.ble_setting.video_lens.set(VideoLens.WIDE)),
                ("Bit Rate", gp.ble_setting.video_bit_rate.set(VideoBitRate.HIGH))
            ]
            
            successful_settings = 0
            for name, setting_task in settings:
                try:
                    await asyncio.wait_for(setting_task, timeout=5)
                    print(f"✅ {name} configured")
                    successful_settings += 1
                except Exception as e:
                    print(f"⚠️  {name} setting failed: {e}")
            
            print(f"📹 Video settings: {successful_settings}/4 configured successfully")
            
        except Exception as e:
            print(f"⚠️  Could not configure video settings: {e}")
            print("📹 Using default camera settings...")

        # Start recording
        print("▶️ Starting recording...")
        try:
            await asyncio.wait_for(gp.ble_command.set_shutter(shutter=Toggle.ENABLE), timeout=10)
            print("🔴 Recording started! Press ENTER to stop.")
        except Exception as e:
            print(f"❌ Failed to start recording: {e}")
            return

        # Record for some time or wait on user input
        input()

        # Stop recording
        print("⏹️ Stopping recording...")
        try:
            await asyncio.wait_for(gp.ble_command.set_shutter(shutter=Toggle.DISABLE), timeout=10)
            print("⏹️ Recording stopped!")
        except Exception as e:
            print(f"⚠️  Warning - stop recording may have failed: {e}")

        # Wait for file finalize / camera ready
        print("⏳ Waiting for camera to finalize file...")
        await asyncio.sleep(5)

        # Try to download the video (requires WiFi connection)
        print("📥 Attempting to download video...")
        try:
            # Check if we have HTTP connectivity
            if gp.is_http_connected:
                media_list = await asyncio.wait_for(gp.http_command.get_media_list(), timeout=15)
                if media_list.data and media_list.data.files:
                    # Get the most recent file
                    latest_file = media_list.data.files[-1].filename
                    print(f"📄 Latest file: {latest_file}")

                    # Extract just the filename (remove folder path like "100GOPRO/")
                    filename_only = os.path.basename(latest_file)
                    
                    os.makedirs(SAVE_DIR, exist_ok=True)
                    save_path = os.path.join(SAVE_DIR, filename_only)
                    print(f"⬇️ Downloading to {save_path}...")
                    await gp.http_command.download_file(camera_file=latest_file, local_file=save_path)
                    print("✅ Download complete!")
                else:
                    print("❌ No media files found on camera.")
            else:
                print("📶 WiFi not connected - cannot download automatically.")
                print("💡 You can manually download the video from your GoPro later.")
        except Exception as e:
            print(f"⚠️  Download failed: {e}")
            print("💡 You can manually download the video from your GoPro later.")

    except Exception as e:
        print(f"❌ Fatal error: {e}")
    finally:
        # Clean up connection
        if gp:
            try:
                await gp.close()
                print("🔌 Disconnected from GoPro")
            except:
                pass

if __name__ == "__main__":
    asyncio.run(main())
