// Update the message event listener at the top of the file
window.addEventListener('message', (event) => {
  const allowedOrigins = [
    "https://fir-rtc-521a2.web.app",
    "https://telehealth-application.onrender.com",
    "http://localhost:3000" // For local development
  ];
  
  if (!allowedOrigins.includes(event.origin)) return;
  
  if (event.data.type === "JOIN_ROOM" && event.data.roomId) {
    joinRoom(event.data.roomId).catch(error => {
      console.error('Failed to join room from message:', error);
    });
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
        .catch((e) => console.warn('Test connection failed:', e));

      initializeVideoCall();
    } catch (initError) {
      throw initError;
    }
  })
  .catch((error) => {
    console.error('Firebase initialization error:', error);
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
let isNegotiating = false; // Add this flag to prevent negotiation loops

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
      console.warn(`Failed to fetch TURN credentials: ${response.statusText}`);
      throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
    }

    const turnServers = await response.json();
    const fetchedIceServers = turnServers.iceServers || turnServers || [];

    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        ...fetchedIceServers,
        ...staticTurnServers,
      ],
    };

    lastCredentialsFetchTime = Date.now();
    console.log('TURN credentials fetched successfully');
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
        ...staticTurnServers,
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
  if (statusText) {
    statusText.textContent = message;
  }
  if (connectionStatus) {
    connectionStatus.className = isConnecting
      ? "connection-status connecting"
      : "connection-status ready";
  }
}

function updateConnectionQuality(quality) {
  if (!connectionQuality) return;
  
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

  if (startCallBtn) {
    startCallBtn.addEventListener("click", startVideoCall);
  }
  
  if (joinCallBtn) {
    joinCallBtn.addEventListener("click", async () => {
      const inputId = prompt("Enter Room ID:");
      if (inputId) await joinRoom(inputId);
    });
  }
  
  if (hangUpBtn) {
    hangUpBtn.addEventListener("click", hangUp);
  }
  
  if (toggleVideoBtn) {
    toggleVideoBtn.addEventListener("click", toggleCamera);
  }
  
  if (muteAudioBtn) {
    muteAudioBtn.addEventListener("click", toggleMic);
  }
}

function toggleMic() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks[0].enabled = !audioTracks[0].enabled;
      const icon = audioTracks[0].enabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
      if (muteAudioBtn) {
        muteAudioBtn.innerHTML = icon;
      }
    }
  }
}

async function openUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
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
    
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(e => console.warn('Local video play failed:', e));
    }

    if (startCallBtn) startCallBtn.disabled = false;
    if (joinCallBtn) joinCallBtn.disabled = false;
    if (muteAudioBtn) muteAudioBtn.disabled = false;
    if (toggleVideoBtn) toggleVideoBtn.disabled = false;

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
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10
  });

  // Add tracks to peer connection in consistent order (audio first, then video)
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    const videoTracks = localStream.getVideoTracks();
    
    // Add audio tracks first
    audioTracks.forEach((track) => {
      pc.addTrack(track, localStream);
    });
    
    // Then add video tracks
    videoTracks.forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  return pc;
}

function setupPeerConnectionListeners() {
  setupPeerConnectionListenersWithoutNegotiation();
  addNegotiationHandler();
}

function setupPeerConnectionListenersWithoutNegotiation() {
  // Enhanced ontrack handler
  peerConnection.ontrack = (event) => {
    console.log('Track received:', event.track.kind);
    
    if (event.streams && event.streams[0]) {
      console.log('Setting remote stream directly');
      if (remoteVideo) {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.play().catch(e => console.warn('Remote video play failed:', e));
      }
      remoteStream = event.streams[0];
    } else {
      console.log('Adding track to remote stream');
      remoteStream.addTrack(event.track);
      if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.play().catch(e => console.warn('Remote video play failed:', e));
      }
    }
    
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
      isNegotiating = false; // Reset negotiation flag
      processBufferedCandidates();
    }
  };
}

function addNegotiationHandler() {

  // FIXED: Prevent negotiation loops and handle InvalidAccessError
  peerConnection.onnegotiationneeded = async () => {
    console.log('Negotiation needed');
    
    // Prevent negotiation loops
    if (isNegotiating) {
      console.log('Already negotiating, skipping...');
      return;
    }
    
    if (!isCaller || peerConnection.signalingState !== "stable") {
      console.log('Skipping negotiation - not caller or signaling not stable');
      return;
    }

    try {
      isNegotiating = true;
      console.log('Creating new offer...');
      
      // Use more specific offer options to prevent m-line issues
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        voiceActivityDetection: false
      });

      // Check if we're still in stable state before setting local description
      if (peerConnection.signalingState !== "stable") {
        console.log('Signaling state changed during offer creation, aborting');
        isNegotiating = false;
        return;
      }

      await peerConnection.setLocalDescription(offer);

      if (roomRef) {
        console.log('Updating room with new offer...');
        await roomRef.update({
          offer: {
            type: offer.type,
            sdp: offer.sdp,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          }
        });
      }
    } catch (error) {
      console.error('Negotiation error:', error);
      isNegotiating = false;
      
      if (error.toString().includes('InvalidAccessError') || 
          error.toString().includes("order of m-lines")) {
        console.warn('Media line mismatch detected - attempting recovery...');
        // Delay recovery to avoid immediate re-triggering
        setTimeout(() => {
          handleMediaLineMismatch();
        }, 1000);
      }
    }
  };
}

// FIXED: Better error handling for media line mismatch
async function handleMediaLineMismatch() {
  try {
    console.log('Attempting to recover from media line mismatch...');
    
    // Close existing connection completely
    if (peerConnection) {
      // Remove all existing senders first
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        try {
          peerConnection.removeTrack(sender);
        } catch (e) {
          console.warn('Failed to remove sender:', e);
        }
      }
      peerConnection.close();
      peerConnection = null;
    }
    
    // Reset states
    isNegotiating = false;
    remoteDescriptionSet = false;
    iceCandidateBuffer = [];
    
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Create completely new peer connection
    peerConnection = await createPeerConnection();
    setupPeerConnectionListeners();
    
    // Restart the call flow
    if (isCaller && roomRef) {
      await restartCallerFlow();
    }
  } catch (error) {
    console.error('Recovery failed:', error);
    updateConnectionStatus("Recovery failed. Please restart the call.");
  }
}

async function restartCallerFlow() {
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    
    await peerConnection.setLocalDescription(offer);
    
    await roomRef.update({
      offer: {
        type: offer.type,
        sdp: offer.sdp,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      }
    });
    
    updateConnectionStatus("Restarted - waiting for answer...");
  } catch (error) {
    console.error('Failed to restart caller flow:', error);
  }
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
    isNegotiating = false;

    await ensureFreshCredentials();
    await setupMediaStream();

    // Ensure we have media before creating peer connection
    if (!localStream || localStream.getTracks().length === 0) {
      throw new Error("No media stream available");
    }

    peerConnection = await createPeerConnection();
    if (!peerConnection) throw new Error("Failed to create peer connection");
    
    // Setup listeners but delay negotiation handler
    setupPeerConnectionListenersWithoutNegotiation();

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

    // Now add the negotiation handler after initial setup
    addNegotiationHandler();

    if (currentRoomDisplay) {
      currentRoomDisplay.innerText = `${roomId}`;
    }
    if (hangUpBtn) {
      hangUpBtn.disabled = false;
    }

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
    isNegotiating = false;
    
    await ensureFreshCredentials();

    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    if (currentRoomDisplay) {
      currentRoomDisplay.innerText = `${roomIdInput}`;
    }
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

    if (hangUpBtn) {
      hangUpBtn.disabled = false;
    }
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
    try {
      // Use more conservative constraints to avoid timeout
      const constraints = {
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 15, max: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      // Add timeout to media access
      const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Media access timeout')), 10000)
      );

      localStream = await Promise.race([mediaPromise, timeoutPromise]);
      
      if (localVideo) {
        localVideo.srcObject = localStream;
        try {
          await localVideo.play();
        } catch (e) {
          console.warn('Local video play failed:', e);
          // Try to play with muted attribute
          localVideo.muted = true;
          await localVideo.play().catch(e => console.warn('Muted play also failed:', e));
        }
      }
    } catch (error) {
      console.error('Failed to get media stream:', error);
      
      // Try fallback with audio only
      if (error.message !== 'Media access timeout') {
        try {
          console.log('Attempting audio-only fallback...');
          localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
          });
          
          if (localVideo) {
            localVideo.srcObject = localStream;
          }
          
          updateConnectionStatus("Audio-only mode (camera unavailable)");
        } catch (fallbackError) {
          console.error('Audio fallback also failed:', fallbackError);
          throw new Error('Unable to access any media devices');
        }
      } else {
        throw error;
      }
    }
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
    if (toggleVideoBtn) {
      toggleVideoBtn.innerHTML = icon;
    }
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

  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  if (currentRoomDisplay) currentRoomDisplay.innerText = "";

  if (startCallBtn) startCallBtn.disabled = true;
  if (joinCallBtn) joinCallBtn.disabled = true;
  if (hangUpBtn) hangUpBtn.disabled = true;
  if (muteAudioBtn) muteAudioBtn.disabled = true;
  if (toggleVideoBtn) toggleVideoBtn.disabled = true;

  if (openMediaBtn) {
    openMediaBtn.style.display = "block";
  }

  updateConnectionStatus("Call ended", false);
  remoteDescriptionSet = false;
  iceCandidateBuffer = [];
  restartAttempts = 0;
  isNegotiating = false;
}

// Add at the bottom of the file
window.addEventListener('error', (event) => {
  if (event.message.includes('blocked') || event.message.includes('Tracking Prevention')) {
    console.warn('Resource blocked:', event);
    if (connectionStatus) {
      connectionStatus.textContent = 
        'Browser blocked required resources. Please disable tracking protection.';
    }
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