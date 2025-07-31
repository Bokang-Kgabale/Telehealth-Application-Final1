// Update the message event listener at the top of the file
window.addEventListener('message', (event) => {
  const allowedOrigins = [
    "https://fir-rtc-521a2.web.app",
    "https://telehealth-application.onrender.com",
    "http://localhost:3000" // For local development
  ];
  
  if (!allowedOrigins.includes(event.origin)) return;
  
  if (event.data.type === "JOIN_ROOM" && event.data.roomId) {
    joinRoom(event.data.roomId).catch(error => {});
  }
});

// Firebase configuration
fetch("/firebase-config")
  .then((res) => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  })
  .then((config) => {
    const requiredFields = ["apiKey", "authDomain", "projectId"];
    const missingFields = requiredFields.filter((field) => !config[field]);
    if (missingFields.length > 0) {
      throw new Error(
        `Missing required Firebase config fields: ${missingFields.join(", ")}`
      );
    }

    try {
      const firebaseApp = firebase.initializeApp(config);
      db = firebase.firestore();
      if (window.location.hostname === "localhost") {
        db.settings({
          experimentalForceLongPolling: true,
          merge: true,
        });
      }

      db.collection("testConnection")
        .doc("test")
        .get()
        .catch((e) => {});

      initializeVideoCall();
    } catch (initError) {
      throw initError;
    }
  })
  .catch((error) => {
    alert(`Firebase init failed: ${error.message}\nCheck console for details.`);
  });

// Global variables
let db;
let localStream;
let remoteStream = new MediaStream();
let peerConnection;
let roomId;
let isCaller = false;
let remoteDescriptionSet = false;
let iceCandidateBuffer = [];
let connectionTimer;
let roomRef;
let callerCandidatesCollection;
let calleeCandidatesCollection;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;
const MAX_CONNECTION_TIME = 15000;
let lastCredentialsFetchTime = 0;
let iceServers = null;

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;
const connectionStatus = document.getElementById("connectionStatus");
const statusText = document.getElementById("statusText");
const connectionQuality = document.getElementById("connectionQuality");
const currentRoomDisplay = document.getElementById("currentRoom");
const openMediaBtn = document.getElementById("openMedia");
const startCallBtn = document.getElementById("startCall");
const joinCallBtn = document.getElementById("joinCall");
const hangUpBtn = document.getElementById("hangUp");
const toggleVideoBtn = document.getElementById("toggleVideo");
const muteAudioBtn = document.getElementById("muteAudio");

async function fetchTurnCredentials() {
  // Your static metered.ca TURN servers
  const staticTurnServers = [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "2506751c38ffc2c7eaeccab9",
      credential: "Hnz1SG7ezaCS6Jtg",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "2506751c38ffc2c7eaeccab9",
      credential: "Hnz1SG7ezaCS6Jtg",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "2506751c38ffc2c7eaeccab9",
      credential: "Hnz1SG7ezaCS6Jtg",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "2506751c38ffc2c7eaeccab9",
      credential: "Hnz1SG7ezaCS6Jtg",
    },
  ];

  try {
    const response = await fetch("/api/turn-credentials");

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
    }

    const turnServers = await response.json();

    // Normalize fetched turn servers array
    const fetchedIceServers = turnServers.iceServers || turnServers || [];

    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        ...fetchedIceServers,
        ...staticTurnServers, // append your static TURN servers at the end
      ],
    };

    lastCredentialsFetchTime = Date.now();
    return true;
  } catch (error) {
    console.warn("Failed to fetch dynamic TURN credentials, using static servers:", error);
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        ...staticTurnServers, // fallback includes your static TURN servers too
      ],
    };
    return false;
  }
}

async function ensureFreshCredentials() {
  const timeSinceLastFetch = Date.now() - lastCredentialsFetchTime;
  if (!lastCredentialsFetchTime || timeSinceLastFetch > 50 * 60 * 1000) {
    await fetchTurnCredentials();
  }
}

// Test TURN server connectivity
async function testTurnServer() {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { 
          urls: 'turn:global.relay.metered.ca:80', 
          username: '2506751c38ffc2c7eaeccab9', 
          credential: 'Hnz1SG7ezaCS6Jtg' 
        }
      ]
    });
    pc.createDataChannel('test');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('TURN test successful');
    pc.close();
  } catch (error) {
    console.error('TURN test failed:', error);
  }
}

function updateConnectionStatus(message, isConnecting = true) {
  statusText.textContent = message;
  connectionStatus.className = isConnecting
    ? "connection-status connecting"
    : "connection-status ready";
}

function updateConnectionQuality(quality) {
  connectionQuality.className = `connection-quality ${quality}`;

  let qualityText = "Unknown";
  switch (quality) {
    case "good":
      qualityText = "Good";
      break;
    case "medium":
      qualityText = "Medium";
      break;
    case "poor":
      qualityText = "Poor";
      break;
  }

  connectionQuality.innerHTML = `<i class="fas fa-circle"></i><span>${qualityText}</span>`;
}

function initializeVideoCall() {
  updateConnectionStatus("Ready to connect", false);
  setupUI();
  // Test TURN server on initialization
  testTurnServer();
}

function setupUI() {
  if (openMediaBtn) {
    openMediaBtn.addEventListener("click", openUserMedia);
  }

  startCallBtn.addEventListener("click", startVideoCall);
  joinCallBtn.addEventListener("click", async () => {
    const inputId = prompt("Enter Room ID:");
    if (inputId) await joinRoom(inputId);
  });
  hangUpBtn.addEventListener("click", hangUp);
  toggleVideoBtn.addEventListener("click", toggleCamera);
  muteAudioBtn.addEventListener("click", toggleMic);
}

function toggleMic() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks[0].enabled = !audioTracks[0].enabled;
      const icon = audioTracks[0].enabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
      muteAudioBtn.innerHTML = icon;
    }
  }
}

async function openUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;

    startCallBtn.disabled = false;
    joinCallBtn.disabled = false;
    muteAudioBtn.disabled = false;
    toggleVideoBtn.disabled = false;

    updateConnectionStatus("Ready to connect", false);

    if (openMediaBtn) {
      openMediaBtn.style.display = "none";
    }
  } catch (error) {
    console.error("Media access error:", error);
    updateConnectionStatus("Media access failed");
    alert(
      "Unable to access camera and microphone. Please allow permissions and try again."
    );
  }
}

async function createPeerConnection() {
if (!iceServers || !iceServers.iceServers || iceServers.iceServers.length === 0) {
  await ensureFreshCredentials();
}

  const pc = new RTCPeerConnection({
    iceServers: iceServers.iceServers || iceServers,
    iceTransportPolicy: "all", // Changed from "relay" to "all" for better connectivity
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10
  });

  // Add tracks to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  return pc;
}

function setupPeerConnectionListeners() {
  // Enhanced ontrack handler
  peerConnection.ontrack = (event) => {
    console.log('Track received:', event.track.kind);
    
    if (event.streams && event.streams[0]) {
      console.log('Setting remote stream directly');
      remoteVideo.srcObject = event.streams[0];
      remoteStream = event.streams[0];
    } else {
      console.log('Adding track to remote stream');
      remoteStream.addTrack(event.track);
      remoteVideo.srcObject = remoteStream;
    }
    
    // Ensure video plays
    remoteVideo.play().catch(e => console.log('Play failed:', e));
    updateConnectionQuality("good");
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && roomId) {
      console.log('Local ICE candidate:', event.candidate.candidate);
      const collectionName = isCaller ? "callerCandidates" : "calleeCandidates";
      db.collection("rooms")
        .doc(roomId)
        .collection(collectionName)
        .add(event.candidate.toJSON())
        .catch((e) => console.error('Failed to add ICE candidate:', e));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log('ICE connection state:', state);

    let statusMessage = "Ready to connect";
    switch (state) {
      case "connected":
      case "completed":
        statusMessage = "Connected";
        updateConnectionQuality("good");
        clearConnectionTimer();
        // Log connection stats
        logConnectionStats();
        break;
      case "checking":
        statusMessage = "Connecting...";
        updateConnectionQuality("medium");
        break;
      case "disconnected":
        statusMessage = "Network issues detected...";
        updateConnectionQuality("poor");
        setTimeout(() => {
          if (peerConnection?.iceConnectionState === "disconnected") {
            attemptIceRestart();
          }
        }, 3000);
        break;
      case "failed":
        statusMessage = "Connection failed";
        updateConnectionQuality("poor");
        attemptIceRestart();
        break;
    }
    updateConnectionStatus(statusMessage, state !== "connected" && state !== "completed");
    console.warn(`ICE State: ${peerConnection.iceConnectionState}`);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'failed') {
      attemptIceRestart();
    }
  };

  peerConnection.onsignalingstatechange = () => {
    console.log('Signaling state:', peerConnection.signalingState);
    if (peerConnection.signalingState === "stable") {
      processBufferedCandidates();
    }
    console.warn(`Signaling State: ${peerConnection.signalingState}`);
  };

  // Add negotiation needed handler
  peerConnection.onnegotiationneeded = async () => {
    console.log('Negotiation needed');
    try {
      if (isCaller && peerConnection.signalingState === "stable") {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        if (roomRef) {
          await roomRef.update({
            offer: {
              type: offer.type,
              sdp: offer.sdp,
            },
          });
        }
      }
    } catch (error) {
      console.error('Negotiation error:', error);
    }
  };
}

async function logConnectionStats() {
  try {
    const stats = await peerConnection.getStats();
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        console.log('Connection established via:', {
          local: report.localCandidateId,
          remote: report.remoteCandidateId,
          transport: report.transportId
        });
      }
    });
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

async function attemptIceRestart() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh.");
    return;
  }

  restartAttempts++;
  updateConnectionStatus(
    `Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`
  );

  try {
    await ensureFreshCredentials();

    // Use restartIce if available
if ('restartIce' in peerConnection) {
  try {
    peerConnection.restartIce();
  } catch (err) {
    console.warn("restartIce failed:", err);
  }
}


    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);

    if (isCaller && roomRef) {
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp,
          iceRestart: true
        },
      });
    }
  } catch (err) {
    console.error('ICE restart failed:', err);
    updateConnectionStatus("Restart failed");
  }
}

async function processBufferedCandidates() {
  if (iceCandidateBuffer.length > 0) {
    console.log(`Processing ${iceCandidateBuffer.length} buffered candidates`);
    for (const candidate of iceCandidateBuffer) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (e) {
        console.error('Failed to add buffered candidate:', e);
      }
    }
    iceCandidateBuffer = [];
  }
}

async function startVideoCall() {
  try {
    isCaller = true;
    restartAttempts = 0;

    await ensureFreshCredentials();
    await setupMediaStream();

    peerConnection = await createPeerConnection();
    if (!peerConnection) throw new Error("Failed to create peer connection");
    setupPeerConnectionListeners();

    updateConnectionStatus("Creating offer...");
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(offer);

    roomRef = await db.collection("rooms").add({
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    roomId = roomRef.id;

    currentRoomDisplay.innerText = `${roomId}`;
    hangUpBtn.disabled = false;

    const parentOrigin =
      window.location.ancestorOrigins?.[0] || "https://fir-rtc-521a2.web.app";

    const message = {
      type: "ROOM_CREATED",
      roomId: roomId,
      timestamp: Date.now(),
    };

    window.parent.postMessage(message, parentOrigin);

    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    startConnectionTimer();
    updateConnectionStatus("Waiting for answer...");

    // Listen for answer
    roomRef.onSnapshot(async (snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !remoteDescriptionSet) {
        console.log('Answer received');
        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          processBufferedCandidates();
          remoteDescriptionSet = true;
        } catch (error) {
          console.error('Failed to set remote description:', error);
        }
      }
    });

    // Listen for callee candidates
    calleeCandidatesCollection.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidateData = change.doc.data();
          console.log('Remote ICE candidate received:', candidateData.candidate);
          const candidate = new RTCIceCandidate(candidateData);
          handleIncomingIceCandidate(candidate);
        }
      });
    });
  } catch (error) {
    console.error('Start call error:', error);
    updateConnectionStatus("Failed to start call");
  }
}

async function joinRoom(roomIdInput) {
  try {
    isCaller = false;
    restartAttempts = 0;
    remoteDescriptionSet = false;
    iceCandidateBuffer = [];
    
    await ensureFreshCredentials();

    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    currentRoomDisplay.innerText = `${roomIdInput}`;
    roomId = roomIdInput;

    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    await setupMediaStream();
    
    if (peerConnection) {
      peerConnection.close();
    }
    
    peerConnection = await createPeerConnection();
    setupPeerConnectionListeners();

    const offer = roomSnapshot.data().offer;
    if (!offer) {
      throw new Error("No offer found in room");
    }

    updateConnectionStatus("Setting remote description...");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    processBufferedCandidates();


    updateConnectionStatus("Creating answer...");
    const answer = await peerConnection.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(answer);

    await roomRef.update({
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
      answerCreatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    remoteDescriptionSet = true;
    startConnectionTimer();

    // Process any buffered candidates
    processBufferedCandidates();

    // Listen for caller candidates
    callerCandidatesCollection.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidateData = change.doc.data();
          console.log('Remote ICE candidate received:', candidateData.candidate);
          const candidate = new RTCIceCandidate(candidateData);
          handleIncomingIceCandidate(candidate);
        }
      });
    });

    hangUpBtn.disabled = false;
    updateConnectionStatus("Connecting...");
  } catch (error) {
    console.error('Join room error:', error);
    updateConnectionStatus("Failed to join room");
    
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }
}

async function setupMediaStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    localVideo.srcObject = localStream;
    
    // Ensure local video plays
    localVideo.play().catch(e => console.log('Local play failed:', e));
  }
}

function handleIncomingIceCandidate(candidate) {
  if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
    peerConnection
      .addIceCandidate(candidate)
      .then(() => console.log('ICE candidate added successfully'))
      .catch((e) => {
        console.error('Failed to add ICE candidate:', e);
        iceCandidateBuffer.push(candidate);
      });
  } else {
    console.log('Buffering ICE candidate');
    iceCandidateBuffer.push(candidate);
  }
}

function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    if (peerConnection?.iceConnectionState === "checking" || 
        peerConnection?.iceConnectionState === "new") {
      console.log('Connection timeout, attempting restart');
      attemptIceRestart();
    }
  }, MAX_CONNECTION_TIME);
}

function clearConnectionTimer() {
  if (connectionTimer) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

function toggleCamera() {
  const videoTracks = localStream?.getVideoTracks();
  if (videoTracks?.length) {
    videoTracks[0].enabled = !videoTracks[0].enabled;
    const icon = videoTracks[0].enabled
      ? '<i class="fas fa-video"></i>'
      : '<i class="fas fa-video-slash"></i>';
    toggleVideoBtn.innerHTML = icon;
  }
}

async function hangUp() {
  clearConnectionTimer();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (roomRef && isCaller) {
    await roomRef.update({ callEnded: true }).catch(e => console.error('Failed to update room:', e));
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  currentRoomDisplay.innerText = "";

  startCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  hangUpBtn.disabled = true;
  muteAudioBtn.disabled = true;
  toggleVideoBtn.disabled = true;

  if (openMediaBtn) {
    openMediaBtn.style.display = "block";
  }

  updateConnectionStatus("Call ended", false);
  remoteDescriptionSet = false;
  iceCandidateBuffer = [];
  restartAttempts = 0;
}

// Add at the bottom of the file
window.addEventListener('error', (event) => {
  if (event.message.includes('blocked') || event.message.includes('Tracking Prevention')) {
    console.warn('Resource blocked:', event);
    document.getElementById('connectionStatus').textContent = 
      'Browser blocked required resources. Please disable tracking protection.';
  }
}, true);

if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
  document.cookie = "crossSiteCookie=fix; SameSite=None; Secure";
}

// Handle page unload to clean up
window.addEventListener('beforeunload', async () => {
  if (peerConnection) {
    await hangUp();
  }
});

document.addEventListener("DOMContentLoaded", initializeVideoCall);