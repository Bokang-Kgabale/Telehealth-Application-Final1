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

// Improved ICE configuration
const pcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { 
      urls: "turn:global.relay.metered.ca:80",
      username: "2506751c38ffc2c7eaeccab9",
      credential: "Hnz1SG7ezaCS6Jtg" 
    },
    // Additional fallback servers
  ],
  iceTransportPolicy: "all", // Try both relay and non-relay candidates
  iceCandidatePoolSize: 5, // Reduced from 10 to speed up gathering
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};

// Enhanced timeout handling
function startConnectionTimer() {
  clearConnectionTimer();
  
  // Dynamic timeout based on network conditions
  const baseTimeout = navigator.connection?.effectiveType === 'cellular' ? 25000 : 15000;
  
  connectionTimer = setTimeout(() => {
    const state = peerConnection?.iceConnectionState;
    if (["new", "checking", "disconnected"].includes(state)) {
      console.log(`Proactive restart in ${state} state`);
      
      // Different recovery based on failure stage
      if (state === "new") {
        handleEarlyStageFailure();
      } else {
        attemptConnectionRecovery();
      }
    }
  }, baseTimeout);
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

    if (joinCallBtn) joinCallBtn.disabled = false;
    if (muteAudioBtn) muteAudioBtn.disabled = false;
    if (toggleVideoBtn) toggleVideoBtn.disabled = false;

    updateConnectionStatus("Ready to connect", false);

  } catch (error) {
    console.error("Media access error:", error);
    updateConnectionStatus("Media access failed");
    alert(
      "Unable to access camera and microphone. Please allow permissions and try again."
    );
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
  if (!iceServers || !iceServers.iceServers || iceServers.iceServers.length === 0) {
    await ensureFreshCredentials();
  }

  // More aggressive ICE configuration for problematic networks
  const pc = new RTCPeerConnection({
    iceServers: iceServers.iceServers || iceServers,
    iceTransportPolicy: "relay", // Allow both STUN and TURN
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10,
    // Add additional configuration for better connectivity
    iceGatheringPolicy: "gather-continually"
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
  // Enhanced ontrack handler with better remote video handling
  peerConnection.ontrack = (event) => {
    console.log('Track received:', event.track.kind, 'readyState:', event.track.readyState);
    
    // Log track details for debugging
    console.log('Track details:', {
      kind: event.track.kind,
      enabled: event.track.enabled,
      muted: event.track.muted,
      readyState: event.track.readyState,
      streamCount: event.streams ? event.streams.length : 0
    });
    
    if (event.streams && event.streams.length > 0) {
      console.log('Using stream from event.streams[0]');
      const stream = event.streams[0];
      
      // Log stream details
      console.log('Stream details:', {
        id: stream.id,
        active: stream.active,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
      });
      
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteStream = stream;
        
        // Force play with multiple attempts
        attemptRemoteVideoPlay();
      }
    } else {
      console.log('No streams in event, manually constructing stream');
      
      // If no streams, add track to our remote stream
      if (!remoteStream || !remoteStream.active) {
        remoteStream = new MediaStream();
        console.log('Created new MediaStream for remote');
      }
      
      // Check if track is already in the stream
      const existingTracks = remoteStream.getTracks();
      const trackExists = existingTracks.some(t => t.id === event.track.id);
      
      if (!trackExists) {
        remoteStream.addTrack(event.track);
        console.log('Added track to remote stream. Stream now has:', {
          audioTracks: remoteStream.getAudioTracks().length,
          videoTracks: remoteStream.getVideoTracks().length
        });
      }
      
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
      
      // Add better error handling for Firestore operations
      db.collection("rooms")
        .doc(roomId)
        .collection(collectionName)
        .add(event.candidate.toJSON())
        .catch((e) => {
          console.error('Failed to add ICE candidate to Firestore:', e);
          
          // Store candidates locally if Firestore fails
          if (!window.localCandidateBuffer) {
            window.localCandidateBuffer = [];
          }
          window.localCandidateBuffer.push({
            candidate: event.candidate.toJSON(),
            collection: collectionName,
            timestamp: Date.now()
          });
          
          // Try to flush buffered candidates periodically
          setTimeout(() => {
            flushLocalCandidateBuffer();
          }, 5000);
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
        
        // Give some time for media to flow, then check
        setTimeout(() => {
          logConnectionStats();
          if (remoteStream && remoteStream.getTracks().length > 0) {
            checkRemoteStreamHealth();
          } else {
            console.warn('Connected but no remote tracks received yet');
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
        
        // More aggressive restart for persistent disconnections
        setTimeout(() => {
          if (peerConnection?.iceConnectionState === "disconnected") {
            console.log('Still disconnected after 3 seconds, attempting restart');
            attemptConnectionRecovery();
          }
        }, 3000); // Back to 3 seconds but with better recovery
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
      isNegotiating = false; // Reset negotiation flag
      processBufferedCandidates();
    }
  };
}

function addNegotiationHandler() {

// Enhanced negotiation handler
let negotiationQueue = [];
let isProcessingQueue = false;

peerConnection.onnegotiationneeded = async () => {
  if (isNegotiating) {
    console.log('Negotiation already in progress, queuing request');
    negotiationQueue.push(true);
    return;
  }

  isNegotiating = true;
  
  try {
    console.log('Starting negotiation');
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      iceRestart: false // Only restart if explicitly needed
    });

    // Validate offer before proceeding
    if (!offer.sdp || offer.sdp.indexOf('m=') === -1) {
      throw new Error('Invalid offer generated');
    }

    await peerConnection.setLocalDescription(offer);

    if (roomRef) {
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }
      });
    }
  } catch (error) {
    console.error('Negotiation failed:', error);
    
    // Specific handling for common errors
    if (error.toString().includes('InvalidAccessError')) {
      await handleMediaLineMismatch();
    }
  } finally {
    isNegotiating = false;
    
    // Process queued negotiations
    if (negotiationQueue.length > 0) {
      negotiationQueue = [];
      setTimeout(() => peerConnection.onnegotiationneeded(), 1000);
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

// Add this helper function for better remote video handling
// Enhanced video playback handler
async function attemptRemoteVideoPlay() {
  if (!remoteVideo || !remoteVideo.srcObject) return;

  // Reset video element if previous attempts failed
  if (remoteVideo.error || remoteVideo.readyState === 4) {
    const temp = remoteVideo.cloneNode();
    remoteVideo.parentNode.replaceChild(temp, remoteVideo);
    remoteVideo = temp;
  }

  // Try standard playback first
  try {
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    await remoteVideo.play();
    return;
  } catch (err) {
    console.warn('Standard play failed, trying muted:', err);
  }

  // Fallback to muted playback
  try {
    remoteVideo.muted = true;
    await remoteVideo.play();
    return;
  } catch (mutedErr) {
    console.error('Muted play failed:', mutedErr);
  }

  // Final fallback - recreate stream
  setTimeout(() => {
    if (remoteVideo.srcObject) {
      const stream = remoteVideo.srcObject;
      remoteVideo.srcObject = null;
      setTimeout(() => {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(e => console.error('Final play attempt failed:', e));
      }, 100);
    }
  }, 500);
}

// Add stream health check function
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
  
  // Check if tracks are muted or ended
  videoTracks.forEach((track, index) => {
    console.log(`Video track ${index}:`, {
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      id: track.id
    });
    
    if (track.readyState === 'ended') {
      console.error('Video track has ended!');
    }
  });
  
  audioTracks.forEach((track, index) => {
    console.log(`Audio track ${index}:`, {
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      id: track.id
    });
  });
  
  // Check the video element itself
  if (remoteVideo) {
    console.log('Remote video element status:', {
      videoWidth: remoteVideo.videoWidth,
      videoHeight: remoteVideo.videoHeight,
      paused: remoteVideo.paused,
      ended: remoteVideo.ended,
      readyState: remoteVideo.readyState,
      networkState: remoteVideo.networkState,
      currentTime: remoteVideo.currentTime,
      duration: remoteVideo.duration,
      srcObject: remoteVideo.srcObject ? 'present' : 'null'
    });
    
    // If no video dimensions, there might be an issue
    if (remoteVideo.videoWidth === 0 || remoteVideo.videoHeight === 0) {
      console.warn('Remote video has no dimensions - possible stream issue');
      
      // Try to refresh the video element
      if (remoteVideo.srcObject) {
        console.log('Attempting to refresh remote video element...');
        const stream = remoteVideo.srcObject;
        remoteVideo.srcObject = null;
        setTimeout(() => {
          remoteVideo.srcObject = stream;
          attemptRemoteVideoPlay();
        }, 100);
      }
    }
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
      
      // Log media stats
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
    
    // Also check remote stream health
    if (remoteStream) {
      checkRemoteStreamHealth();
    }
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

// Enhanced connection recovery function
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
    // First, try a simple ICE restart
    if (restartAttempts === 1) {
      await attemptIceRestart();
      return;
    }

    // For subsequent attempts, do a more thorough restart
    console.log('Attempting full connection restart...');
    
    // Close current connection
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

    // Reset states
    isNegotiating = false;
    remoteDescriptionSet = false;
    iceCandidateBuffer = [];

    // Get fresh TURN credentials
    await ensureFreshCredentials();

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Recreate connection
    peerConnection = await createPeerConnection();
    setupPeerConnectionListenersWithoutNegotiation();

    if (isCaller && roomRef) {
      // Caller: create new offer
      console.log('Restarting as caller...');
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

      // Re-add negotiation handler after initial setup
      setTimeout(() => {
        addNegotiationHandler();
      }, 1000);

    } else if (roomId) {
      // Callee: wait for new offer and respond
      console.log('Restarting as callee, waiting for new offer...');
      setupCalleeReconnection();
    }

    startConnectionTimer();

  } catch (error) {
    console.error('Connection recovery failed:', error);
    updateConnectionStatus(`Recovery attempt ${restartAttempts} failed`);
    
    // Try again after a delay
    setTimeout(() => {
      if (restartAttempts < MAX_RESTART_ATTEMPTS) {
        attemptConnectionRecovery();
      }
    }, 2000);
  }
}

// Setup callee reconnection logic
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
        
        // Stop listening for offers
        unsubscribe();

      } catch (error) {
        console.error('Failed to handle restart offer:', error);
      }
    }
  });

  // Stop listening after 10 seconds if no restart offer received
  setTimeout(() => {
    unsubscribe();
  }, 10000);
}

// Function to flush buffered candidates when Firestore connection recovers
async function flushLocalCandidateBuffer() {
  if (!window.localCandidateBuffer || window.localCandidateBuffer.length === 0) {
    return;
  }

  console.log(`Attempting to flush ${window.localCandidateBuffer.length} buffered candidates`);

  const candidates = [...window.localCandidateBuffer];
  window.localCandidateBuffer = [];

  for (const candidateData of candidates) {
    try {
      await db.collection("rooms")
        .doc(roomId)
        .collection(candidateData.collection)
        .add(candidateData.candidate);
      
      console.log('Successfully flushed candidate to Firestore');
    } catch (error) {
      console.error('Failed to flush candidate, re-buffering:', error);
      window.localCandidateBuffer.push(candidateData);
    }
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
    const currentState = peerConnection?.iceConnectionState;
    console.log('Connection timeout triggered, current state:', currentState);
    
    if (currentState === "checking" || currentState === "new" || currentState === "gathering") {
      console.log('Connection timeout, attempting recovery');
      attemptConnectionRecovery();
    } else if (currentState === "disconnected" || currentState === "failed") {
      console.log('Connection in failed state during timeout, attempting recovery');
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