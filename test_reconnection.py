#!/usr/bin/env python3
"""
Test script for GoPro reconnection optimizations
"""
import asyncio
import logging
from open_gopro import WirelessGoPro, Interface
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_basic_connection():
    """Test basic connection without optimizations"""
    logger.info("=== Testing Basic Connection ===")
    
    gopro = WirelessGoPro()
    try:
        logger.info("Connecting...")
        await gopro.open(timeout=15, retries=2)
        logger.info("✅ Basic connection successful")
        
        # Get device info
        hw_info = await gopro.ble_command.get_hardware_info()
        logger.info(f"Camera: {hw_info.data.model_name} (Serial: {hw_info.data.serial_number})")
        
        return hw_info.data.serial_number
    except Exception as e:
        logger.error(f"❌ Basic connection failed: {e}")
        return None
    finally:
        await gopro.close()

async def test_targeted_connection(serial: str):
    """Test targeted connection with identifier"""
    logger.info("=== Testing Targeted Connection ===")
    
    # Extract last 4 digits for target
    target = serial[-4:] if serial and len(serial) >= 4 else None
    if not target:
        logger.warning("No target identifier available")
        return
    
    logger.info(f"Using target identifier: {target}")
    
    gopro = WirelessGoPro(target=target)
    try:
        logger.info("Connecting with target...")
        await gopro.open(timeout=5, retries=2)  # Faster timeout for targeted
        logger.info("✅ Targeted connection successful")
    except Exception as e:
        logger.error(f"❌ Targeted connection failed: {e}")
    finally:
        await gopro.close()

async def test_ble_only_connection(serial: str):
    """Test BLE-only connection"""
    logger.info("=== Testing BLE-Only Connection ===")
    
    target = serial[-4:] if serial and len(serial) >= 4 else None
    
    connection_params = {
        "interfaces": {Interface.BLE},
        "ble_retries": 1
    }
    
    if target:
        connection_params["target"] = target
        logger.info(f"Using BLE-only with target: {target}")
    
    gopro = WirelessGoPro(**connection_params)
    try:
        logger.info("Connecting BLE-only...")
        await gopro.open(timeout=10, retries=1)
        logger.info("✅ BLE-only connection successful")
    except Exception as e:
        logger.error(f"❌ BLE-only connection failed: {e}")
    finally:
        await gopro.close()

async def test_cohn_connection():
    """Test COHN (Camera on Home Network) connection if available"""
    logger.info("=== Testing COHN Connection ===")
    
    cohn_db_path = Path("backend/cohn_db.json")
    if not cohn_db_path.exists():
        logger.info("No COHN database found, skipping")
        return
    
    gopro = WirelessGoPro(
        interfaces={Interface.COHN},
        cohn_db=cohn_db_path
    )
    try:
        logger.info("Connecting via COHN...")
        await gopro.open(timeout=10, retries=1)
        logger.info("✅ COHN connection successful")
    except Exception as e:
        logger.error(f"❌ COHN connection failed: {e}")
    finally:
        await gopro.close()

async def main():
    """Run all connection tests"""
    logger.info("🚀 Starting GoPro reconnection tests...")
    
    # Test 1: Basic connection to get device info
    serial = await test_basic_connection()
    
    if serial:
        await asyncio.sleep(2)  # Brief pause between tests
        
        # Test 2: Targeted connection
        await test_targeted_connection(serial)
        
        await asyncio.sleep(2)
        
        # Test 3: BLE-only connection
        await test_ble_only_connection(serial)
        
        await asyncio.sleep(2)
        
        # Test 4: COHN connection
        await test_cohn_connection()
    
    logger.info("🏁 All tests completed")

if __name__ == "__main__":
    asyncio.run(main())