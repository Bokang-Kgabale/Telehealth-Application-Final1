// Update the message event listener at the top of the file
window.addEventListener('message', (event) => {
  const allowedOrigins = [
    "https://fir-rtc-521a2.web.app",
    "https://telehealth-application.onrender.com",
    "http://localhost:3000" // For local development
  ];
  
  if (!allowedOrigins.includes(event.origin)) return;
  
  if (event.data.type === "JOIN_ROOM" && event.data.roomId) {
    if(event.data.cameraId) {
      preferredWebcamId = event.data.cameraId;
      console.log('Setting preferred webcam ID from message:', preferredWebcamId);
    }

    joinRoom(event.data.roomId).catch(error => {
      console.error('Failed to join room from message:', error);
    });
  }
});

// Firebase configuration with better error handling
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
      
      // Better Firestore settings for connectivity issues
      if (window.location.hostname === "localhost") {
        db.settings({
          experimentalForceLongPolling: true,
          merge: true,
        });
      } else {
        // For production, use more conservative settings
        db.settings({
          experimentalForceLongPolling: false,
          merge: true,
          ignoreUndefinedProperties: true
        });
      }

      // Test connection with better error handling
      db.collection("testConnection")
        .doc("test")
        .get()
        .then(() => {
          console.log('Firestore connection test successful');
          initializeVideoCall();
        })
        .catch((e) => {
          console.error('Firestore connection test failed:', e);
          // Try to initialize anyway, but with offline persistence
          db.enablePersistence({ synchronizeTabs: true })
            .then(() => {
              console.log('Firestore offline persistence enabled');
              initializeVideoCall();
            })
            .catch(() => {
              console.warn('Firestore persistence failed, continuing without');
              initializeVideoCall();
            });
        });

    } catch (initError) {
      throw initError;
    }
  })
  .catch((error) => {
    console.error('Firebase initialization error:', error);
    alert(`Firebase init failed: ${error.message}\nCheck console for details.`);
  });

// Global variables
let preferredWebcamId = null; // Store preferred webcam ID from message
let db;
let localStream;
let remoteStream = new MediaStream();
let peerConnection;
let roomId;
let isCaller = false;
let remoteDescriptionSet = false;
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
const startCallWithMediaBtn = document.getElementById("startCallWithMedia");
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
  const startCallWithMediaBtn = document.getElementById("startCallWithMedia");
  if (startCallWithMediaBtn) {
    startCallWithMediaBtn.addEventListener("click", startCallWithMedia);
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
    const constraints = {
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
    };
    if (preferredWebcamId) {
      constraints.video.deviceId = { exact: preferredWebcamId };
      console.log('Using preferred webcam ID:', preferredWebcamId);
    }
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(e => console.warn('Local video play failed:', e));
    }

    if (joinCallBtn) joinCallBtn.disabled = false;
    if (muteAudioBtn) muteAudioBtn.disabled = false;
    if (toggleVideoBtn) toggleVideoBtn.disabled = false;

    updateConnectionStatus("Ready to connect", false);

  } catch (error) {
    // If specific camera fails, try without deviceId constraint
    if (preferredWebcamId && error.name === 'OverconstrainedError') {
      console.warn('Preferred webcam failed, falling back to default');
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
      } catch (fallbackError) {
        console.error("Fallback media access error:", fallbackError);
        throw fallbackError;
      }
    } else {
      console.error("Media access error:", error);
      throw error;
    }
  }
}

async function startCallWithMedia() {
  try {
    updateConnectionStatus("Opening camera and starting call...");
    
    // First, open the media (camera/microphone)
    await openUserMedia();
    
    // Then immediately start the video call
    await startVideoCall();
    
  } catch (error) {
    console.error("Failed to start call with media:", error);
    updateConnectionStatus("Failed to start call");
    alert("Unable to start call. Please check your camera/microphone permissions and try again.");
  }
}

async function createPeerConnection() {
  if (!iceServers?.iceServers?.length) {
    await ensureFreshCredentials();
  }

  // More aggressive ICE configuration for problematic networks
  const config = {
    iceServers: iceServers.iceServers || iceServers,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10,
    // Add additional configuration for better connectivity
    iceGatheringPolicy: "gather-continually"
  };

  const pc = new RTCPeerConnection(config);

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
  // Enhanced ontrack handler with better remote video handling
  peerConnection.ontrack = (event) => {
    console.log('Track received:', event.track.kind, 'readyState:', event.track.readyState);
    
    if (event.streams && event.streams.length > 0) {
      console.log('Using stream from event.streams[0]');
      const stream = event.streams[0];
      
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteStream = stream;
        attemptRemoteVideoPlay();
      }
    } else {
      console.log('No streams in event, manually constructing stream');
      
      if (!remoteStream || !remoteStream.active) {
        remoteStream = new MediaStream();
      }
      
      remoteStream.addTrack(event.track);
      
      if (remoteVideo && remoteVideo.srcObject !== remoteStream) {
        remoteVideo.srcObject = remoteStream;
        attemptRemoteVideoPlay();
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
        .catch((e) => {
          console.error('Failed to add ICE candidate to Firestore:', e);
        });
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
        restartAttempts = 0; // Reset restart attempts on successful connection
        
        setTimeout(() => {
          logConnectionStats();
          if (remoteStream && remoteStream.getTracks().length > 0) {
            checkRemoteStreamHealth();
          }
        }, 2000);
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
            attemptConnectionRecovery();
          }
        }, 3000);
        break;
      case "failed":
        statusMessage = "Connection failed";
        updateConnectionQuality("poor");
        attemptConnectionRecovery();
        break;
      case "new":
      case "gathering":
        statusMessage = "Preparing connection...";
        updateConnectionQuality("medium");
        break;
      case "closed":
        statusMessage = "Connection closed";
        updateConnectionQuality("poor");
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
      isNegotiating = false;
    }
  };
}

function addNegotiationHandler() {
  peerConnection.onnegotiationneeded = async () => {
    console.log('Negotiation needed');
    
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
      
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        voiceActivityDetection: false
      });

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
        setTimeout(() => {
          handleMediaLineMismatch();
        }, 1000);
      }
    }
  };
}

async function handleMediaLineMismatch() {
  try {
    console.log('Attempting to recover from media line mismatch...');
    
    if (peerConnection) {
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
    
    isNegotiating = false;
    remoteDescriptionSet = false;
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    peerConnection = await createPeerConnection();
    setupPeerConnectionListeners();
    
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

async function attemptRemoteVideoPlay() {
  if (!remoteVideo || !remoteVideo.srcObject) return;

  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  remoteVideo.muted = true; // Always mute to prevent echo
  
  try {
    await remoteVideo.play();
    console.log('Remote video playing successfully');
  } catch (error) {
    console.warn('Remote video play failed:', error);
    // Try again after a short delay
    setTimeout(() => {
      remoteVideo.play().catch(e => console.warn('Retry failed:', e));
    }, 300);
  }
}

function checkRemoteStreamHealth() {
  if (!remoteStream) {
    console.error('No remote stream available');
    return;
  }
  
  const audioTracks = remoteStream.getAudioTracks();
  const videoTracks = remoteStream.getVideoTracks();
  
  console.log('Remote stream health check:', {
    active: remoteStream.active,
    audioTracks: audioTracks.length,
    videoTracks: videoTracks.length,
    audioEnabled: audioTracks.length > 0 ? audioTracks[0].enabled : false,
    videoEnabled: videoTracks.length > 0 ? videoTracks[0].enabled : false,
    audioReadyState: audioTracks.length > 0 ? audioTracks[0].readyState : 'none',
    videoReadyState: videoTracks.length > 0 ? videoTracks[0].readyState : 'none'
  });
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
      
      if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
        console.log('Inbound video stats:', {
          packetsReceived: report.packetsReceived,
          bytesReceived: report.bytesReceived,
          framesDecoded: report.framesDecoded,
          frameWidth: report.frameWidth,
          frameHeight: report.frameHeight
        });
      }
    });
    
    if (remoteStream) {
      checkRemoteStreamHealth();
    }
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

async function attemptConnectionRecovery() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh and try again.");
    console.error('Max restart attempts reached, giving up');
    return;
  }

  restartAttempts++;
  console.log(`Connection recovery attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}`);
  updateConnectionStatus(`Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);

  try {
    if (restartAttempts === 1) {
      await attemptIceRestart();
      return;
    }

    console.log('Attempting full connection restart...');
    
    if (peerConnection) {
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

    isNegotiating = false;
    remoteDescriptionSet = false;

    await ensureFreshCredentials();

    await new Promise(resolve => setTimeout(resolve, 1000));

    peerConnection = await createPeerConnection();
    setupPeerConnectionListenersWithoutNegotiation();

    if (isCaller && roomRef) {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true
      });
      
      await peerConnection.setLocalDescription(offer);
      
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp,
          iceRestart: true,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }
      });

      setTimeout(() => {
        addNegotiationHandler();
      }, 1000);

    } else if (roomId) {
      console.log('Restarting as callee, waiting for new offer...');
      setupCalleeReconnection();
    }

    startConnectionTimer();

  } catch (error) {
    console.error('Connection recovery failed:', error);
    updateConnectionStatus(`Recovery attempt ${restartAttempts} failed`);
    
    setTimeout(() => {
      if (restartAttempts < MAX_RESTART_ATTEMPTS) {
        attemptConnectionRecovery();
      }
    }, 2000);
  }
}

async function setupCalleeReconnection() {
  if (!roomRef) return;

  const unsubscribe = roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (data?.offer && data.offer.iceRestart) {
      console.log('Received restart offer from caller');
      
      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.offer)
        );

        const answer = await peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        
        await peerConnection.setLocalDescription(answer);

        await roomRef.update({
          answer: {
            type: answer.type,
            sdp: answer.sdp,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          }
        });

        remoteDescriptionSet = true;
        console.log('Reconnection answer sent');
        
        unsubscribe();
      } catch (error) {
        console.error('Failed to handle restart offer:', error);
      }
    }
  });

  setTimeout(() => {
    unsubscribe();
  }, 10000);
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

function handleIncomingIceCandidate(candidate) {
  if (peerConnection.remoteDescription) {
    peerConnection.addIceCandidate(candidate).catch(e => {
      console.warn('Failed to add ICE candidate:', e);
    });
  } else {
    console.log('Dropping ICE candidate - remote description not set');
  }
}

function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    const currentState = peerConnection?.iceConnectionState;
    console.log('Connection timeout triggered, current state:', currentState);
    
    if (currentState === "checking" || currentState === "new" || currentState === "gathering") {
      attemptConnectionRecovery();
    } else if (currentState === "disconnected" || currentState === "failed") {
      attemptConnectionRecovery();
    }
  }, MAX_CONNECTION_TIME);
}

function clearConnectionTimer() {
  if (connectionTimer) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

async function startVideoCall() {
  try {
    isCaller = true;
    restartAttempts = 0;
    isNegotiating = false;

    await ensureFreshCredentials();
    await setupMediaStream();

    if (!localStream || localStream.getTracks().length === 0) {
      throw new Error("No media stream available");
    }

    peerConnection = await createPeerConnection();
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

    roomRef.onSnapshot(async (snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !remoteDescriptionSet) {
        console.log('Answer received');
        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          remoteDescriptionSet = true;
        } catch (error) {
          console.error('Failed to set remote description:', error);
          updateConnectionStatus("Failed to set remote description");
        }
      }
    });

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
    isNegotiating = false;
    
    await ensureFreshCredentials();
    await setupMediaStream();

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
  if (localStream) {
    console.log('Local stream already exists, skipping setup');
    return;
  }

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

  if (preferredWebcamId) {
    constraints.video.deviceId = { exact: preferredWebcamId };
  }

  try {
    const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Media access timeout')), 10000)
    );

    localStream = await Promise.race([mediaPromise, timeoutPromise]);
    
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      await localVideo.play().catch(e => console.warn('Local video play failed:', e));
    }
  } catch (error) {
    console.error('Media access failed:', error);
    
    if (preferredWebcamId && error.name === 'OverconstrainedError') {
      try {
        delete constraints.video.deviceId;
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (localVideo) {
          localVideo.srcObject = localStream;
          localVideo.muted = true;
          await localVideo.play().catch(e => console.warn('Local video play failed:', e));
        }
        return;
      } catch (fallbackError) {
        console.error('Camera fallback failed:', fallbackError);
      }
    }
    
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
      updateConnectionStatus("Audio-only mode (camera unavailable)");
    } catch (audioError) {
      console.error('Audio-only fallback failed:', audioError);
      throw new Error('Unable to access any media devices');
    }
  }
}

async function switchToWebcam(cameraId) {
  if (!cameraId) return;
  
  preferredWebcamId = cameraId;
  console.log('Switching to webcam:', cameraId);
  
  try {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.stop();
        localStream.removeTrack(track);
      });
    }
    
    const newVideoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: cameraId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });
    
    const newVideoTrack = newVideoStream.getVideoTracks()[0];
    
    if (localStream) {
      localStream.addTrack(newVideoTrack);
    } else {
      localStream = newVideoStream;
    }
    
    if (localVideo) {
      localVideo.srcObject = localStream;
    }
    
    if (peerConnection) {
      const videoSender = peerConnection.getSenders().find(sender => 
        sender.track && sender.track.kind === 'video'
      );
      
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        console.log('Replaced video track in peer connection');
      }
    }
    
  } catch (error) {
    console.error('Failed to switch webcam:', error);
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
  if (startCallWithMediaBtn) startCallWithMediaBtn.disabled = false;
  if (joinCallBtn) joinCallBtn.disabled = true;
  if (hangUpBtn) hangUpBtn.disabled = true;
  if (muteAudioBtn) muteAudioBtn.disabled = true;
  if (toggleVideoBtn) toggleVideoBtn.disabled = true;

  updateConnectionStatus("Call ended", false);
  remoteDescriptionSet = false;
  restartAttempts = 0;
  isNegotiating = false;
}

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

window.addEventListener('beforeunload', async () => {
  if (peerConnection) {
    await hangUp();
  }
});

document.addEventListener("DOMContentLoaded", initializeVideoCall);