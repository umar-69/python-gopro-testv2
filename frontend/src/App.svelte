<script>
	import { onMount, onDestroy } from 'svelte';

	// State variables
	let connected = false;
	let recording = false;
	let connecting = false;
	let cameraInfo = { model: '', serial: '', firmware: '' };
	let wifiConnected = false;
	let status = 'Disconnected';
	let messages = [];
	let ws = null;
	let savedDevice = null;
	let autoReconnectEnabled = true;

	// API base URL
	const API_BASE = 'http://localhost:8000/api';
	const WS_URL = 'ws://localhost:8000/ws';

	// Add message to the log
	function addMessage(type, text) {
		const timestamp = new Date().toLocaleTimeString();
		messages = [...messages, { type, text, timestamp }];
		// Keep only last 10 messages
		if (messages.length > 10) {
			messages = messages.slice(-10);
		}
	}

	// WebSocket connection
	function connectWebSocket() {
		try {
			ws = new WebSocket(WS_URL);
			
			ws.onopen = () => {
				console.log('WebSocket connected');
				addMessage('info', 'Real-time connection established');
			};
			
			ws.onmessage = (event) => {
				const data = JSON.parse(event.data);
				console.log('WebSocket message:', data);
				
				if (data.type === 'status') {
					updateStatus(data.data);
				} else if (data.type === 'connection') {
					addMessage(data.data.success ? 'success' : 'error', data.data.message);
					// Refresh device status when connection changes
					if (data.data.success) {
						checkSavedDevice();
					}
				} else if (data.type === 'recording') {
					addMessage(data.data.success ? 'success' : 'error', data.data.message);
				} else if (data.type === 'download') {
					addMessage(data.data.success ? 'success' : 'error', data.data.message);
				} else if (data.type === 'device_cleared') {
					addMessage(data.data.success ? 'success' : 'error', data.data.message);
					if (data.data.success) {
						savedDevice = null;
					}
				}
			};
			
			ws.onclose = () => {
				console.log('WebSocket disconnected');
				addMessage('warning', 'Real-time connection lost. Attempting to reconnect...');
				// Attempt to reconnect after 3 seconds
				setTimeout(connectWebSocket, 3000);
			};
			
			ws.onerror = (error) => {
				console.error('WebSocket error:', error);
				addMessage('error', 'WebSocket connection error');
			};
		} catch (error) {
			console.error('Failed to connect WebSocket:', error);
			addMessage('error', 'Failed to establish real-time connection');
		}
	}

	// Update status from WebSocket
	function updateStatus(statusData) {
		connected = statusData.connected;
		recording = statusData.recording;
		cameraInfo = statusData.camera_info;
		wifiConnected = statusData.wifi_connected;
		
		if (connected) {
			status = recording ? 'Recording' : 'Connected';
		} else {
			status = 'Disconnected';
		}
	}

	// API call helper
	async function apiCall(endpoint, method = 'GET') {
		try {
			const response = await fetch(`${API_BASE}${endpoint}`, {
				method,
				headers: { 'Content-Type': 'application/json' }
			});
			return await response.json();
		} catch (error) {
			console.error('API call failed:', error);
			addMessage('error', `API call failed: ${error.message}`);
			return { success: false, message: error.message };
		}
	}

	// Connect to GoPro using WiFi+COHN combined approach
	async function connectGoPro() {
		connecting = true;
		addMessage('info', 'Connecting via WiFi+COHN combined (most stable)...');
		
		const result = await apiCall('/connect', 'POST');
		connecting = false;
		
		if (result.success) {
			addMessage('success', 'Connected via WiFi+COHN successfully!');
		} else {
			addMessage('error', `Connection failed: ${result.message}`);
		}
	}

	// Disconnect from GoPro
	async function disconnectGoPro() {
		addMessage('info', 'Disconnecting from GoPro...');
		const result = await apiCall('/disconnect', 'POST');
		
		if (result.success) {
			addMessage('success', 'Disconnected successfully');
		} else {
			addMessage('error', `Disconnect failed: ${result.message}`);
		}
	}

	// Start recording
	async function startRecording() {
		addMessage('info', 'Starting recording...');
		const result = await apiCall('/start-recording', 'POST');
		
		if (!result.success) {
			addMessage('error', `Failed to start recording: ${result.message}`);
		}
	}

	// Stop recording
	async function stopRecording() {
		addMessage('info', 'Stopping recording...');
		const result = await apiCall('/stop-recording', 'POST');
		
		if (!result.success) {
			addMessage('error', `Failed to stop recording: ${result.message}`);
		}
	}

	// Download latest video
	async function downloadLatest() {
		addMessage('info', 'Downloading latest video...');
		const result = await apiCall('/download-latest', 'POST');
		
		if (result.success) {
			addMessage('success', `Downloaded: ${result.filename}`);
		} else {
			addMessage('error', `Download failed: ${result.message}`);
		}
	}

	// Configure camera settings
	async function configureSettings() {
		addMessage('info', 'Configuring camera settings...');
		const result = await apiCall('/configure-settings', 'POST');
		
		if (result.success) {
			addMessage('success', 'Camera settings configured');
		} else {
			addMessage('warning', `Settings warning: ${result.message}`);
		}
	}

	// Auto-connect to known device
	async function autoConnect() {
		connecting = true;
		addMessage('info', 'Auto-connecting to known device...');
		const result = await apiCall('/auto-connect', 'POST');
		connecting = false;
		
		if (result.success) {
			addMessage('success', result.message);
		} else {
			addMessage('warning', result.message);
		}
	}

	// Check for saved device on startup
	async function checkSavedDevice() {
		try {
			const result = await apiCall('/device-status');
			if (result.success) {
				savedDevice = result.saved_device;
				autoReconnectEnabled = result.auto_reconnect_enabled;
				
				if (savedDevice) {
					addMessage('info', `Found saved device: ${savedDevice.model} (${savedDevice.serial})`);
				}
			}
		} catch (error) {
			// Silently handle - no saved device is not an error
		}
	}

	// Clear saved device
	async function clearSavedDevice() {
		if (confirm('Are you sure you want to clear the saved device? You will need to manually connect next time.')) {
			const result = await apiCall('/clear-device', 'POST');
			if (result.success) {
				savedDevice = null;
				addMessage('success', 'Saved device cleared');
			} else {
				addMessage('error', `Failed to clear device: ${result.message}`);
			}
		}
	}

	// Toggle auto-reconnect
	async function toggleAutoReconnect() {
		const newState = !autoReconnectEnabled;
		const result = await apiCall(`/toggle-auto-reconnect?enabled=${newState}`, 'POST');
		if (result.success) {
			autoReconnectEnabled = newState;
			addMessage('info', `Auto-reconnect ${newState ? 'enabled' : 'disabled'}`);
		}
	}

	// Get current status
	async function refreshStatus() {
		const result = await apiCall('/status');
		if (result) {
			updateStatus(result);
		}
	}

	// Force reconnect (bypassing cache)
	async function forceReconnect() {
		connecting = true;
		addMessage('info', 'Force reconnecting (fresh discovery)...');
		const result = await apiCall('/force-reconnect', 'POST');
		connecting = false;
		
		if (result.success) {
			addMessage('success', result.message);
		} else {
			addMessage('error', result.message);
		}
	}

	// WiFi-only reconnect (fastest and most stable)
	async function wifiOnlyConnect() {
		connecting = true;
		addMessage('info', 'Connecting via WiFi with password (most stable)...');
		const result = await apiCall('/connect', 'POST');
		connecting = false;
		
		if (result.success) {
			addMessage('success', result.message);
		} else {
			addMessage('error', result.message);
		}
	}

	// Lifecycle
	onMount(() => {
		connectWebSocket();
		refreshStatus();
		checkSavedDevice();
	});

	onDestroy(() => {
		if (ws) {
			ws.close();
		}
	});
</script>

<main>
	<div class="container">
		<h1>🎥 GoPro Web Controller</h1>
		
		<!-- Saved Device Panel -->
		{#if savedDevice}
			<div class="status-panel">
				<h3 style="margin: 0 0 15px 0; color: #333;">📱 Remembered Device</h3>
				<div class="status-item">
					<span class="status-label">Model:</span>
					<span class="status-value">{savedDevice.model}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Serial:</span>
					<span class="status-value">{savedDevice.serial}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Last Connected:</span>
					<span class="status-value">{savedDevice.last_connected}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Auto-Reconnect:</span>
					<span class="status-value {autoReconnectEnabled ? 'connected' : 'disconnected'}">
						{autoReconnectEnabled ? 'Enabled' : 'Disabled'}
					</span>
				</div>
				<div class="button-group" style="margin-top: 15px;">
					<button class="btn secondary" on:click={toggleAutoReconnect}>
						{autoReconnectEnabled ? '🔄 Disable Auto-Reconnect' : '🔄 Enable Auto-Reconnect'}
					</button>
					<button class="btn danger" on:click={clearSavedDevice}>
						🗑️ Forget Device
					</button>
				</div>
			</div>
		{/if}

		<!-- Status Panel -->
		<div class="status-panel">
			<div class="status-item">
				<span class="status-label">Status:</span>
				<span class="status-value {status.toLowerCase()}">{status}</span>
			</div>
			
			{#if connected && cameraInfo.model}
				<div class="status-item">
					<span class="status-label">Camera:</span>
					<span class="status-value">{cameraInfo.model}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Serial:</span>
					<span class="status-value">{cameraInfo.serial}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Connection Type:</span>
					<span class="status-value {wifiConnected ? 'connected' : 'disconnected'}">
						{wifiConnected ? 'WiFi (HTTP)' : 'Not Connected'}
					</span>
				</div>
			{/if}
		</div>

		<!-- Control Buttons -->
		<div class="controls">
			{#if !connected}
				<div class="button-group">
					<button 
						class="btn primary" 
						on:click={connectGoPro}
						disabled={connecting}
						title="WiFi+COHN combined connection (most stable)"
					>
						{connecting ? 'Connecting WiFi+COHN...' : '🔗 Connect WiFi+COHN'}
					</button>
					<button 
						class="btn accent" 
						on:click={autoConnect}
						disabled={connecting}
					>
						🚀 Auto-Connect
					</button>
				</div>
				
				<!-- Advanced Connection Options -->
				<div class="button-group">
					<button 
						class="btn info" 
						on:click={wifiOnlyConnect}
						disabled={connecting}
						title="Connect via WiFi with saved password (most stable)"
					>
						📶 WiFi Connect
					</button>
					<button 
						class="btn secondary" 
						on:click={forceReconnect}
						disabled={connecting}
						title="Force fresh WiFi connection (clears cache)"
					>
						🔄 Force Reconnect
					</button>
				</div>
			{:else}
				<div class="button-group">
					<button class="btn secondary" on:click={disconnectGoPro}>
						🔌 Disconnect
					</button>
					<button class="btn accent" on:click={configureSettings}>
						⚙️ Configure Settings
					</button>
				</div>
				
				<div class="button-group">
					{#if !recording}
						<button class="btn success large" on:click={startRecording}>
							▶️ Start Recording
						</button>
					{:else}
						<button class="btn danger large" on:click={stopRecording}>
							⏹️ Stop Recording
						</button>
					{/if}
				</div>
				
				<div class="button-group">
					<button 
						class="btn info" 
						on:click={downloadLatest}
						disabled={!wifiConnected}
					>
						⬇️ Download Latest
					</button>
					<button class="btn secondary" on:click={refreshStatus}>
						🔄 Refresh Status
					</button>
				</div>
			{/if}
		</div>

		<!-- Message Log -->
		<div class="messages">
			<h3>📋 Activity Log</h3>
			<div class="message-list">
				{#each messages as message}
					<div class="message {message.type}">
						<span class="timestamp">{message.timestamp}</span>
						<span class="text">{message.text}</span>
					</div>
				{/each}
				{#if messages.length === 0}
					<div class="message info">
						<span class="text">No messages yet...</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	main {
		padding: 20px;
		min-height: 100vh;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	.container {
		max-width: 800px;
		margin: 0 auto;
		background: white;
		border-radius: 15px;
		padding: 30px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
	}

	h1 {
		text-align: center;
		color: #333;
		margin-bottom: 30px;
		font-size: 2.5em;
		font-weight: 300;
	}

	.status-panel {
		background: #f8f9fa;
		border-radius: 10px;
		padding: 20px;
		margin-bottom: 30px;
		border-left: 4px solid #667eea;
	}

	.status-item {
		display: flex;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.status-item:last-child {
		margin-bottom: 0;
	}

	.status-label {
		font-weight: 600;
		color: #555;
	}

	.status-value {
		font-weight: 500;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.status-value.connected { background: #d4edda; color: #155724; }
	.status-value.recording { background: #f8d7da; color: #721c24; animation: pulse 2s infinite; }
	.status-value.disconnected { background: #f1f3f4; color: #6c757d; }

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}

	.controls {
		margin-bottom: 30px;
	}

	.button-group {
		display: flex;
		gap: 15px;
		margin-bottom: 15px;
		flex-wrap: wrap;
	}

	.btn {
		padding: 12px 24px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.3s ease;
		min-width: 140px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.btn.primary { background: #667eea; color: white; }
	.btn.secondary { background: #6c757d; color: white; }
	.btn.success { background: #28a745; color: white; }
	.btn.danger { background: #dc3545; color: white; }
	.btn.info { background: #17a2b8; color: white; }
	.btn.accent { background: #fd7e14; color: white; }

	.btn.large {
		font-size: 18px;
		padding: 16px 32px;
		min-width: 200px;
	}

	.messages {
		background: #f8f9fa;
		border-radius: 10px;
		padding: 20px;
	}

	.messages h3 {
		margin: 0 0 15px 0;
		color: #333;
		font-size: 1.2em;
	}

	.message-list {
		max-height: 300px;
		overflow-y: auto;
	}

	.message {
		padding: 8px 12px;
		margin-bottom: 5px;
		border-radius: 6px;
		display: flex;
		gap: 10px;
		font-size: 14px;
	}

	.message.info { background: #d1ecf1; color: #0c5460; }
	.message.success { background: #d4edda; color: #155724; }
	.message.error { background: #f8d7da; color: #721c24; }
	.message.warning { background: #fff3cd; color: #856404; }

	.timestamp {
		font-weight: 600;
		opacity: 0.8;
		white-space: nowrap;
	}

	.text {
		flex: 1;
	}

	@media (max-width: 600px) {
		.container {
			margin: 10px;
			padding: 20px;
		}

		.button-group {
			flex-direction: column;
		}

		.btn {
			min-width: auto;
		}

		h1 {
			font-size: 2em;
		}
	}
</style>