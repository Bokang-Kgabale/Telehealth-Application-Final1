// Configuration Constants
const CONFIG = {
  MAX_RESTART_ATTEMPTS: 3,
  MAX_CONNECTION_TIME: 15000,
  ALLOWED_ORIGINS: [
    "https://fir-rtc-521a2.web.app",
    "https://telehealth-application.onrender.com",
    "http://localhost:3000"
  ],
  ICE_SERVERS: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      {
        urls: [
          "turn:global.relay.metered.ca:80",
          "turn:global.relay.metered.ca:443",
          "turns:global.relay.metered.ca:443?transport=tcp"
        ],
        username: "2506751c38ffc2c7eaeccab9",
        credential: "Hnz1SG7ezaCS6Jtg"
      }
    ]
  }
};

// Global State
const state = {
  db: null,
  localStream: null,
  remoteStream: new MediaStream(),
  peerConnection: null,
  roomId: null,
  isCaller: false,
  remoteDescriptionSet: false,
  iceCandidateBuffer: [],
  connectionTimer: null,
  roomRef: null,
  callerCandidatesCollection: null,
  calleeCandidatesCollection: null,
  restartAttempts: 0,
  lastCredentialsFetchTime: 0
};

// DOM Elements
const elements = {
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  connectionStatus: document.getElementById("connectionStatus"),
  statusText: document.getElementById("statusText"),
  connectionQuality: document.getElementById("connectionQuality"),
  currentRoomDisplay: document.getElementById("currentRoom"),
  openMediaBtn: document.getElementById("openMedia"),
  startCallBtn: document.getElementById("startCall"),
  joinCallBtn: document.getElementById("joinCall"),
  hangUpBtn: document.getElementById("hangUp"),
  toggleVideoBtn: document.getElementById("toggleVideo"),
  muteAudioBtn: document.getElementById("muteAudio")
};

// Initialize the application
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initializeFirebase();
    setupUI();
    initializeVideoCall();
    
    // Set up error handling
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('beforeunload', cleanupBeforeUnload);
  } catch (error) {
    console.error('Initialization failed:', error);
    updateConnectionStatus("Initialization failed");
  }
});

// Core Functions
async function initializeFirebase() {
  try {
    const response = await fetch("/firebase-config");
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    
    const config = await response.json();
    validateFirebaseConfig(config);

    const firebaseApp = firebase.initializeApp(config);
    state.db = firebase.firestore();
    
    configureFirestore();
    await testFirestoreConnection();
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    throw error;
  }
}

function validateFirebaseConfig(config) {
  const requiredFields = ["apiKey", "authDomain", "projectId"];
  const missingFields = requiredFields.filter(field => !config[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }
}

function configureFirestore() {
  state.db.settings({
    experimentalForceLongPolling: window.location.hostname === "localhost",
    merge: true,
    ignoreUndefinedProperties: true
  });
}

async function testFirestoreConnection() {
  await state.db.collection("connectionTest").doc("ping").set({
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function setupUI() {
  elements.openMediaBtn?.addEventListener("click", openUserMedia);
  elements.startCallBtn.addEventListener("click", startVideoCall);
  elements.joinCallBtn.addEventListener("click", promptJoinRoom);
  elements.hangUpBtn.addEventListener("click", hangUp);
  elements.toggleVideoBtn.addEventListener("click", toggleCamera);
  elements.muteAudioBtn.addEventListener("click", toggleMic);
  
  elements.remoteVideo.srcObject = state.remoteStream;
}

async function promptJoinRoom() {
  const inputId = prompt("Enter Room ID:");
  if (inputId) await joinRoom(inputId);
}

// WebRTC Functions
async function createPeerConnection() {
  try {
    const pc = new RTCPeerConnection(CONFIG.ICE_SERVERS);
    
    // Add event listeners
    pc.addEventListener('icecandidate', handleIceCandidate);
    pc.addEventListener('track', handleTrackEvent);
    pc.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
    pc.addEventListener('connectionstatechange', handleConnectionStateChange);
    pc.addEventListener('signalingstatechange', handleSignalingStateChange);
    pc.addEventListener('negotiationneeded', handleNegotiationNeeded);

    return pc;
  } catch (error) {
    console.error('PeerConnection creation failed:', error);
    throw error;
  }
}

function handleIceCandidate(event) {
  if (event.candidate && state.roomId) {
    const collectionName = state.isCaller ? "callerCandidates" : "calleeCandidates";
    state.db.collection("rooms")
      .doc(state.roomId)
      .collection(collectionName)
      .add(event.candidate.toJSON())
      .catch(error => console.error('Failed to add ICE candidate:', error));
  }
}

function handleTrackEvent(event) {
  if (event.streams && event.streams[0]) {
    elements.remoteVideo.srcObject = event.streams[0];
    state.remoteStream = event.streams[0];
  } else {
    event.streams[0].getTracks().forEach(track => {
      state.remoteStream.addTrack(track);
    });
    elements.remoteVideo.srcObject = state.remoteStream;
  }
  updateConnectionQuality("good");
}

function handleIceConnectionStateChange() {
  const state = state.peerConnection.iceConnectionState;
  console.log('ICE connection state:', state);

  switch (state) {
    case "connected":
    case "completed":
      updateConnectionStatus("Connected");
      updateConnectionQuality("good");
      clearConnectionTimer();
      break;
    case "checking":
      updateConnectionStatus("Connecting...");
      updateConnectionQuality("medium");
      break;
    case "disconnected":
      updateConnectionStatus("Network issues detected...");
      updateConnectionQuality("poor");
      setTimeout(() => {
        if (state.peerConnection?.iceConnectionState === "disconnected") {
          attemptIceRestart();
        }
      }, 3000);
      break;
    case "failed":
      updateConnectionStatus("Connection failed");
      updateConnectionQuality("poor");
      attemptIceRestart();
      break;
  }
}

// Media Functions
async function openUserMedia() {
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    elements.localVideo.srcObject = state.localStream;
    enableCallControls();
    updateConnectionStatus("Ready to connect", false);

    if (elements.openMediaBtn) {
      elements.openMediaBtn.style.display = "none";
    }
  } catch (error) {
    console.error("Media access error:", error);
    handleMediaError(error);
  }
}

function handleMediaError(error) {
  updateConnectionStatus("Media access failed");
  
  let message = "Unable to access camera/microphone.";
  if (error.name === 'NotAllowedError') {
    message = "Please enable permissions and refresh.";
  } else if (error.name === 'NotFoundError') {
    message = "No media devices found.";
  }
  
  alert(`${message} Error: ${error.message}`);
}

// Connection Management
async function startVideoCall() {
  try {
    resetCallState();
    state.isCaller = true;

    await setupMediaStream();
    await initializePeerConnection();

    const offer = await createOffer();
    await setLocalDescription(offer);
    
    state.roomRef = await createRoom(offer);
    state.roomId = state.roomRef.id;
    
    updateUIForCallStart();
    setupRoomListeners();
    startConnectionTimer();
    
    notifyParentAboutRoomCreation();
  } catch (error) {
    console.error('Start call error:', error);
    handleCallError("Failed to start call");
  }
}

async function joinRoom(roomId) {
  try {
    resetCallState();
    state.isCaller = false;

    await setupMediaStream();
    await initializePeerConnection();

    state.roomRef = state.db.collection("rooms").doc(roomId);
    const roomSnapshot = await state.roomRef.get();

    if (!roomSnapshot.exists) {
      alert("Room not found");
      return;
    }

    state.roomId = roomId;
    await setRemoteDescription(roomSnapshot.data().offer);

    const answer = await createAnswer();
    await setLocalDescription(answer);
    await updateRoomWithAnswer(answer);

    updateUIForCallStart();
    setupRoomListeners();
    startConnectionTimer();
  } catch (error) {
    console.error('Join room error:', error);
    handleCallError("Failed to join room");
  }
}

// Utility Functions
function updateConnectionStatus(message, isConnecting = true) {
  elements.statusText.textContent = message;
  elements.connectionStatus.className = isConnecting
    ? "connection-status connecting"
    : "connection-status ready";
}

function updateConnectionQuality(quality) {
  const qualityText = {
    good: "Good",
    medium: "Medium",
    poor: "Poor"
  }[quality] || "Unknown";

  elements.connectionQuality.className = `connection-quality ${quality}`;
  elements.connectionQuality.innerHTML = `<i class="fas fa-circle"></i><span>${qualityText}</span>`;
}

async function cleanupBeforeUnload() {
  if (state.peerConnection) {
    await hangUp();
  }
}

function handleGlobalError(event) {
  console.error('Uncaught error:', event.error);
  updateConnectionStatus("System error occurred", true);
}

// Export for testing if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeFirebase,
    createPeerConnection,
    startVideoCall,
    joinRoom
  };
}