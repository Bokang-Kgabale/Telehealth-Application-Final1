// Update the message event listener at the top of the file
window.addEventListener("message", (event) => {
  const allowedOrigins = [
    "https://fir-rtc-521a2.web.app",
    "https://telehealth-application.onrender.com",
    "http://localhost:3000", // For local development
  ];

  if (!allowedOrigins.includes(event.origin)) return;

  if (event.data.type === "JOIN_ROOM" && event.data.roomId) {
    joinRoom(event.data.roomId).catch((error) => {
      console.error("Failed to join room from message:", error);
    });
  }
});
// Add to your initialization code
window.addEventListener("error", (event) => {
  console.error("Global error:", event.error);

  // Specific handling for WebRTC errors
  if (event.error && event.error.name.includes("WebRTC")) {
    updateConnectionStatus("Connection error - attempting recovery");
    setTimeout(attemptConnectionRecovery, 1000);
  }
});

// Handle unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
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
      if (
        window.location.hostname === "https://fir-rtc-521a2.web.app" ||
        window.location.hostname === "localhost"
      ) {
        db.settings({
          experimentalForceLongPolling: true,
          merge: true,
        });
      } else {
        // For production, use more conservative settings
        db.settings({
          experimentalForceLongPolling: false,
          merge: true,
          ignoreUndefinedProperties: true,
        });
      }

      // Test connection with better error handling
      db.collection("testConnection")
        .doc("test")
        .get()
        .then(() => {
          console.log("Firestore connection test successful");
          initializeVideoCall();
        })
        .catch((e) => {
          console.error("Firestore connection test failed:", e);
          // Try to initialize anyway, but with offline persistence
          db.enablePersistence({ synchronizeTabs: true })
            .then(() => {
              console.log("Firestore offline persistence enabled");
              initializeVideoCall();
            })
            .catch(() => {
              console.warn("Firestore persistence failed, continuing without");
              initializeVideoCall();
            });
        });
    } catch (initError) {
      throw initError;
    }
  })
  .catch((error) => {
    console.error("Firebase initialization error:", error);
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
let playbackAttempts = 0;
const MAX_PLAYBACK_ATTEMPTS = 3;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const MAX_CONNECTION_TIME = 15000;
let lastCredentialsFetchTime = 0;
let iceServers = null;
let isNegotiating = false; // Add this flag to prevent negotiation loops
let playbackState = {
  remoteVideoPlaying: false,
  userHasInteracted: false,
  playbackAttempts: 0,
};
// Track user interaction for autoplay policy compliance
document.addEventListener(
  "click",
  () => {
    playbackState.userHasInteracted = true;
  },
  { once: true }
);

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
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "bcfe4d9904d13b41dd342b96",
        credential: "C1OL6l9YwtpboGuE",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "bcfe4d9904d13b41dd342b96",
        credential: "C1OL6l9YwtpboGuE",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "bcfe4d9904d13b41dd342b96",
        credential: "C1OL6l9YwtpboGuE",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "bcfe4d9904d13b41dd342b96",
        credential: "C1OL6l9YwtpboGuE",
      },
  ];

  try {
    const response = await fetch("/api/turn-credentials");

    if (!response.ok) {
      console.warn(`Failed to fetch TURN credentials: ${response.statusText}`);
      throw new Error(
        `Failed to fetch TURN credentials: ${response.statusText}`
      );
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
    console.log("TURN credentials fetched successfully");
    return true;
  } catch (error) {
    console.warn(
      "Failed to fetch dynamic TURN credentials, using static servers:",
      error
    );
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
      credential: "Hnz1SG7ezaCS6Jtg",
    },
    // Additional fallback servers
  ],
  iceTransportPolicy: "all", // Try both relay and non-relay candidates
  iceCandidatePoolSize: 5, // Reduced from 10 to speed up gathering
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// Enhanced timeout handling
function startConnectionTimer() {
  clearConnectionTimer();

  // Dynamic timeout based on network conditions
  const baseTimeout =
    navigator.connection?.effectiveType === "cellular" ? 25000 : 15000;

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
async function attemptRemoteVideoPlay() {
  if (!remoteVideo || !remoteVideo.srcObject) {
    console.warn("No remote video element or source available");
    return;
  }

  // Prevent multiple simultaneous attempts
  if (playbackState.remoteVideoPlaying) {
    console.log("Remote video already playing or attempt in progress");
    return;
  }

  const MAX_ATTEMPTS = 3;
  if (playbackState.playbackAttempts >= MAX_ATTEMPTS) {
    console.warn(`Max playback attempts (${MAX_ATTEMPTS}) reached`);
    return;
  }

  playbackState.playbackAttempts++;
  console.log(
    `Remote video play attempt ${playbackState.playbackAttempts}/${MAX_ATTEMPTS}`
  );

  try {
    // Set essential attributes for modern browsers
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true; // Critical for iOS Safari
    remoteVideo.controls = false;

    // Start with muted playback (always allowed by browsers)
    remoteVideo.muted = true;

    // Wait for video metadata to be ready
    if (remoteVideo.readyState < 1) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Metadata timeout")),
          10000
        );
        remoteVideo.addEventListener(
          "loadedmetadata",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true }
        );
      });
    }

    // Attempt muted playback first
    await remoteVideo.play();
    console.log("Remote video started playing (muted)");
    playbackState.remoteVideoPlaying = true;
    playbackState.playbackAttempts = 0;

    // Try to unmute if user has interacted
    if (playbackState.userHasInteracted) {
      setTimeout(async () => {
        try {
          remoteVideo.muted = false;
          console.log("Remote video unmuted successfully");
        } catch (unmuteError) {
          console.warn("Could not unmute remote video:", unmuteError);
          // Show user control to enable audio
          showUnmutePrompt();
        }
      }, 500);
    } else {
      // Show user that they need to interact to hear audio
      showUnmutePrompt();
    }
  } catch (error) {
    console.error(
      `Remote video play attempt ${playbackState.playbackAttempts} failed:`,
      error
    );
    playbackState.remoteVideoPlaying = false;

    // Try different recovery strategies based on attempt number
    if (playbackState.playbackAttempts < MAX_ATTEMPTS) {
      const delay = Math.min(
        1000 * Math.pow(2, playbackState.playbackAttempts - 1),
        5000
      );
      console.log(`Retrying in ${delay}ms...`);

      setTimeout(async () => {
        if (playbackState.playbackAttempts === 2) {
          // Second attempt: try recreating the video element
          await recreateVideoElement();
        } else if (playbackState.playbackAttempts === 3) {
          // Third attempt: reset the stream connection
          await resetVideoStream();
        }
        attemptRemoteVideoPlay();
      }, delay);
    } else {
      // All attempts failed - show manual play button
      showManualPlayButton();
    }
  }
}
// Recreate video element (safer than cloneNode)
async function recreateVideoElement() {
  if (!remoteVideo || !remoteVideo.parentNode) return;

  console.log("Recreating remote video element...");
  const parent = remoteVideo.parentNode;
  const stream = remoteVideo.srcObject;

  // Create new video element with proper attributes
  const newVideo = document.createElement("video");
  newVideo.id = remoteVideo.id;
  newVideo.className = remoteVideo.className;
  newVideo.autoplay = true;
  newVideo.playsInline = true;
  newVideo.muted = true;

  // Copy styles
  newVideo.style.cssText = remoteVideo.style.cssText;

  // Replace old element
  parent.replaceChild(newVideo, remoteVideo);

  // Update global reference - IMPORTANT: update your global remoteVideo reference
  const oldRemoteVideo =
    window.remoteVideo || document.getElementById("remoteVideo");
  window.remoteVideo = newVideo;

  // Also update the module-level variable if it exists
  if (typeof remoteVideo !== "undefined") {
    remoteVideo = newVideo;
  }

  // Restore stream
  if (stream) {
    newVideo.srcObject = stream;
  }

  return newVideo;
}

// Reset video stream connection
async function resetVideoStream() {
  console.log("Resetting video stream...");

  if (remoteVideo && remoteVideo.srcObject) {
    const stream = remoteVideo.srcObject;

    // Temporarily disconnect and reconnect
    remoteVideo.srcObject = null;

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Recreate MediaStream with existing tracks
    const newStream = new MediaStream();
    stream.getTracks().forEach((track) => {
      if (track.readyState === "live") {
        newStream.addTrack(track);
      }
    });

    remoteVideo.srcObject = newStream;
    remoteStream = newStream;
  }
}

// Show unmute prompt to user
function showUnmutePrompt() {
  const existingPrompt = document.getElementById("unmute-prompt");
  if (existingPrompt) return;

  const prompt = document.createElement("div");
  prompt.id = "unmute-prompt";
  prompt.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 15px;
    border-radius: 20px;
    cursor: pointer;
    z-index: 1000;
    font-size: 14px;
    font-family: Arial, sans-serif;
    animation: pulse 2s infinite;
    user-select: none;
  `;
  prompt.innerHTML = `🔇 Click to enable audio`;

  prompt.addEventListener("click", async () => {
    try {
      if (remoteVideo) {
        remoteVideo.muted = false;
        prompt.remove();
        playbackState.userHasInteracted = true;
        console.log("Audio manually enabled by user");
      }
    } catch (error) {
      console.error("Manual unmute failed:", error);
    }
  });

  // Add to video container or body
  const videoContainer = remoteVideo.parentElement;
  if (
    videoContainer &&
    getComputedStyle(videoContainer).position !== "static"
  ) {
    videoContainer.appendChild(prompt);
  } else {
    // Make video container relative if needed
    if (videoContainer) {
      videoContainer.style.position = "relative";
      videoContainer.appendChild(prompt);
    } else {
      document.body.appendChild(prompt);
    }
  }

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (prompt.parentNode) {
      prompt.remove();
    }
  }, 10000);
}

// Show manual play button as last resort
function showManualPlayButton() {
  const existingButton = document.getElementById("manual-play-btn");
  if (existingButton) return;

  const button = document.createElement("button");
  button.id = "manual-play-btn";
  button.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #007bff;
    color: white;
    border: none;
    padding: 15px 30px;
    border-radius: 25px;
    cursor: pointer;
    font-size: 16px;
    font-family: Arial, sans-serif;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
    transition: all 0.3s ease;
    user-select: none;
  `;
  button.innerHTML = `▶️ Click to Play Video`;

  // Add hover effect
  button.addEventListener("mouseenter", () => {
    button.style.background = "#0056b3";
    button.style.transform = "translate(-50%, -50%) scale(1.05)";
  });

  button.addEventListener("mouseleave", () => {
    button.style.background = "#007bff";
    button.style.transform = "translate(-50%, -50%) scale(1)";
  });

  button.addEventListener("click", async () => {
    playbackState.userHasInteracted = true;
    playbackState.playbackAttempts = 0;
    playbackState.remoteVideoPlaying = false;
    button.remove();
    console.log("Manual play button clicked, retrying video playback");
    await attemptRemoteVideoPlay();
  });

  // Add to video container
  const videoContainer = remoteVideo.parentElement;
  if (
    videoContainer &&
    getComputedStyle(videoContainer).position !== "static"
  ) {
    videoContainer.appendChild(button);
  } else {
    if (videoContainer) {
      videoContainer.style.position = "relative";
      videoContainer.appendChild(button);
    } else {
      document.body.appendChild(button);
    }
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
  initEnhancedVideoHandling(); // Add this line

  testTurnServer().catch((error) => {
    console.warn("TURN server test failed, proceeding anyway:", error);
  });
}
function initEnhancedVideoHandling() {
  // Set up proper video element attributes
  if (remoteVideo) {
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.muted = true;
    remoteVideo.controls = false;

    // Add error handling
    remoteVideo.addEventListener("error", (e) => {
      console.error("Remote video error:", e);
      playbackState.remoteVideoPlaying = false;
    });

    // Track when video actually starts playing
    remoteVideo.addEventListener("playing", () => {
      console.log("Remote video is now playing");
      playbackState.remoteVideoPlaying = true;

      // Remove any manual controls
      const manualButton = document.getElementById("manual-play-btn");
      const unmutePrompt = document.getElementById("unmute-prompt");
      if (manualButton) manualButton.remove();
      if (unmutePrompt) unmutePrompt.remove();
    });

    // Handle video pause/stall
    remoteVideo.addEventListener("pause", () => {
      if (playbackState.remoteVideoPlaying) {
        console.log("Remote video paused unexpectedly");
        playbackState.remoteVideoPlaying = false;
      }
    });

    // Handle video ended
    remoteVideo.addEventListener("ended", () => {
      console.log("Remote video ended");
      playbackState.remoteVideoPlaying = false;
    });
  }
}
// Add this function definition (it's declared in the code but might be out of scope)
async function testTurnServer() {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "2506751c38ffc2c7eaeccab9",
          credential: "Hnz1SG7ezaCS6Jtg",
        },
      ],
    });
    pc.createDataChannel("test");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("TURN test successful");
    pc.close();
  } catch (error) {
    console.error("TURN test failed:", error);
    throw error; // Re-throw to handle in calling function
  }
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
        frameRate: { ideal: 30 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo
        .play()
        .catch((e) => console.warn("Local video play failed:", e));
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
    alert(
      "Unable to start call. Please check your camera/microphone permissions and try again."
    );
  }
}

async function createPeerConnection() {
  if (
    !iceServers ||
    !iceServers.iceServers ||
    iceServers.iceServers.length === 0
  ) {
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
    iceGatheringPolicy: "gather-continually",
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
  // ENHANCED ONTRACK HANDLER - REPLACE YOUR EXISTING ONE
  peerConnection.ontrack = (event) => {
    console.log(
      "Track received:",
      event.track.kind,
      "readyState:",
      event.track.readyState
    );

    // Log track details for debugging
    console.log("Track details:", {
      kind: event.track.kind,
      enabled: event.track.enabled,
      muted: event.track.muted,
      readyState: event.track.readyState,
      streamCount: event.streams ? event.streams.length : 0,
    });

    if (event.streams && event.streams.length > 0) {
      console.log("Using stream from event.streams[0]");
      const stream = event.streams[0];

      // Log stream details
      console.log("Stream details:", {
        id: stream.id,
        active: stream.active,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });

      if (remoteVideo && remoteVideo.srcObject !== stream) {
        remoteVideo.srcObject = stream;
        remoteStream = stream;

        // Reset playback state for new stream
        playbackState.remoteVideoPlaying = false;
        playbackState.playbackAttempts = 0;

        // Attempt playback with delay to ensure stream is ready
        setTimeout(() => attemptRemoteVideoPlay(), 100);
      }
    } else {
      console.log("No streams in event, manually constructing stream");

      // If no streams, add track to our remote stream
      if (!remoteStream || !remoteStream.active) {
        remoteStream = new MediaStream();
        console.log("Created new MediaStream for remote");
      }

      // Check if track is already in the stream
      const existingTracks = remoteStream.getTracks();
      const trackExists = existingTracks.some((t) => t.id === event.track.id);

      if (!trackExists && event.track.readyState === "live") {
        remoteStream.addTrack(event.track);
        console.log("Added track to remote stream. Stream now has:", {
          audioTracks: remoteStream.getAudioTracks().length,
          videoTracks: remoteStream.getVideoTracks().length,
        });

        if (remoteVideo && remoteVideo.srcObject !== remoteStream) {
          remoteVideo.srcObject = remoteStream;

          // Reset playback state for new stream
          playbackState.remoteVideoPlaying = false;
          playbackState.playbackAttempts = 0;

          setTimeout(() => attemptRemoteVideoPlay(), 100);
        }
      }
    }

    updateConnectionQuality("good");
  };

  // KEEP ALL YOUR OTHER EXISTING HANDLERS BELOW (don't change these)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && roomId) {
      console.log("Local ICE candidate:", event.candidate.candidate);
      const collectionName = isCaller ? "callerCandidates" : "calleeCandidates";

      // Add better error handling for Firestore operations
      db.collection("rooms")
        .doc(roomId)
        .collection(collectionName)
        .add(event.candidate.toJSON())
        .catch((e) => {
          console.error("Failed to add ICE candidate to Firestore:", e);

          // Store candidates locally if Firestore fails
          if (!window.localCandidateBuffer) {
            window.localCandidateBuffer = [];
          }
          window.localCandidateBuffer.push({
            candidate: event.candidate.toJSON(),
            collection: collectionName,
            timestamp: Date.now(),
          });

          // Try to flush buffered candidates periodically
          setTimeout(() => {
            flushLocalCandidateBuffer();
          }, 5000);
        });
    }
  };

  // Keep all your other existing handlers exactly as they are...
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log("ICE connection state:", state);

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
            console.warn("Connected but no remote tracks received yet");
          }
        }, 5000); // Wait 5 seconds to allow media to start flowing
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
            console.log(
              "Still disconnected after 3 seconds, attempting restart"
            );
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
    updateConnectionStatus(
      statusMessage,
      state !== "connected" && state !== "completed"
    );
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state:", peerConnection.connectionState);
    if (peerConnection.connectionState === "failed") {
      attemptIceRestart();
    }
  };

  // Add this to your peer connection setup:
  peerConnection.onsignalingstatechange = () => {
    console.log("Signaling state:", peerConnection.signalingState);

    if (peerConnection.signalingState === "stable") {
      isNegotiating = false;
      if (peerConnection && peerConnection.iceConnectionState) {
        // safe to read iceConnectionState here
      } else {
        console.warn("peerConnection or iceConnectionState is not available");
      }

      // Validate connection state
      if (peerConnection.iceConnectionState !== "connected") {
        console.warn("Signaling stable but ICE not connected, checking...");
        setTimeout(() => {
          if (peerConnection.iceConnectionState !== "connected") {
            attemptConnectionRecovery();
          }
        }, 5000);
      }
    }
  };
}

function addNegotiationHandler() {
  // Enhanced negotiation handler
  let negotiationQueue = [];
  let isProcessingQueue = false;

  peerConnection.onnegotiationneeded = async () => {
    if (isNegotiating) {
      console.log("Negotiation already in progress, queuing request");
      negotiationQueue.push(true);
      return;
    }

    isNegotiating = true;

    try {
      console.log("Starting negotiation");
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false, // Only restart if explicitly needed
      });

      // Validate offer before proceeding
      if (!offer.sdp || offer.sdp.indexOf("m=") === -1) {
        throw new Error("Invalid offer generated");
      }

      await peerConnection.setLocalDescription(offer);

      if (roomRef) {
        await roomRef.update({
          offer: {
            type: offer.type,
            sdp: offer.sdp,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          },
        });
      }
    } catch (error) {
      console.error("Negotiation failed:", error);

      // Specific handling for common errors
      if (error.toString().includes("InvalidAccessError")) {
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
    console.log("Attempting to recover from media line mismatch...");

    // Close existing connection completely
    if (peerConnection) {
      // Remove all existing senders first
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        try {
          peerConnection.removeTrack(sender);
        } catch (e) {
          console.warn("Failed to remove sender:", e);
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create completely new peer connection
    peerConnection = await createPeerConnection();
    setupPeerConnectionListeners();

    // Restart the call flow
    if (isCaller && roomRef) {
      await restartCallerFlow();
    }
  } catch (error) {
    console.error("Recovery failed:", error);
    updateConnectionStatus("Recovery failed. Please restart the call.");
  }
}

async function restartCallerFlow() {
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await peerConnection.setLocalDescription(offer);

    await roomRef.update({
      offer: {
        type: offer.type,
        sdp: offer.sdp,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });

    updateConnectionStatus("Restarted - waiting for answer...");
  } catch (error) {
    console.error("Failed to restart caller flow:", error);
  }
}

// Add stream health check function
function checkRemoteStreamHealth() {
  if (!remoteStream) {
    console.error("No remote stream available");
    return;
  }

  const audioTracks = remoteStream.getAudioTracks();
  const videoTracks = remoteStream.getVideoTracks();

  console.log("Remote stream health check:", {
    active: remoteStream.active,
    audioTracks: audioTracks.length,
    videoTracks: videoTracks.length,
    audioEnabled: audioTracks.length > 0 ? audioTracks[0].enabled : false,
    videoEnabled: videoTracks.length > 0 ? videoTracks[0].enabled : false,
    audioReadyState:
      audioTracks.length > 0 ? audioTracks[0].readyState : "none",
    videoReadyState:
      videoTracks.length > 0 ? videoTracks[0].readyState : "none",
  });

  // Check if tracks are muted or ended
  videoTracks.forEach((track, index) => {
    console.log(`Video track ${index}:`, {
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      id: track.id,
    });

    if (track.readyState === "ended") {
      console.error("Video track has ended!");
    }
  });

  audioTracks.forEach((track, index) => {
    console.log(`Audio track ${index}:`, {
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      id: track.id,
    });
  });

  // Check the video element itself
  if (remoteVideo) {
    console.log("Remote video element status:", {
      videoWidth: remoteVideo.videoWidth,
      videoHeight: remoteVideo.videoHeight,
      paused: remoteVideo.paused,
      ended: remoteVideo.ended,
      readyState: remoteVideo.readyState,
      networkState: remoteVideo.networkState,
      currentTime: remoteVideo.currentTime,
      duration: remoteVideo.duration,
      srcObject: remoteVideo.srcObject ? "present" : "null",
    });

    // If no video dimensions, there might be an issue
    if (remoteVideo.videoWidth === 0 || remoteVideo.videoHeight === 0) {
      console.warn("Remote video has no dimensions - possible stream issue");

      // Try to refresh the video element
      if (remoteVideo.srcObject) {
        console.log("Attempting to refresh remote video element...");
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
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        console.log("Connection established via:", {
          local: report.localCandidateId,
          remote: report.remoteCandidateId,
          transport: report.transportId,
        });
      }

      // Log media stats
      if (report.type === "inbound-rtp" && report.mediaType === "video") {
        console.log("Inbound video stats:", {
          packetsReceived: report.packetsReceived,
          bytesReceived: report.bytesReceived,
          framesDecoded: report.framesDecoded,
          frameWidth: report.frameWidth,
          frameHeight: report.frameHeight,
        });
      }
    });

    // Also check remote stream health
    if (remoteStream) {
      checkRemoteStreamHealth();
    }
  } catch (err) {
    console.error("Failed to get stats:", err);
  }
}

// Enhanced connection recovery function
async function attemptConnectionRecovery() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh and try again.");
    console.error("Max restart attempts reached, giving up");
    return;
  }

  restartAttempts++;
  console.log(
    `Connection recovery attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}`
  );
  updateConnectionStatus(
    `Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`
  );

  try {
    // First, try a simple ICE restart
    if (restartAttempts === 1) {
      await attemptIceRestart();
      return;
    }

    // For subsequent attempts, do a more thorough restart
    console.log("Attempting full connection restart...");

    // Close current connection
    if (peerConnection) {
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        try {
          peerConnection.removeTrack(sender);
        } catch (e) {
          console.warn("Failed to remove sender:", e);
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
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Recreate connection
    peerConnection = await createPeerConnection();
    setupPeerConnectionListenersWithoutNegotiation();

    if (isCaller && roomRef) {
      // Caller: create new offer
      console.log("Restarting as caller...");
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true,
      });

      await peerConnection.setLocalDescription(offer);

      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp,
          iceRestart: true,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        },
      });

      // Re-add negotiation handler after initial setup
      setTimeout(() => {
        addNegotiationHandler();
      }, 1000);
    } else if (roomId) {
      // Callee: wait for new offer and respond
      console.log("Restarting as callee, waiting for new offer...");
      setupCalleeReconnection();
    }

    startConnectionTimer();
  } catch (error) {
    console.error("Connection recovery failed:", error);
    updateConnectionStatus(`Recovery attempt ${restartAttempts} failed`);

    // Try again after a delay
    setTimeout(() => {
      if (restartAttempts < MAX_RESTART_ATTEMPTS) {
        attemptConnectionRecovery();
      }
    }, 5000);
  }
}

// Setup callee reconnection logic
async function setupCalleeReconnection() {
  if (!roomRef) return;

  const unsubscribe = roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (data?.offer && data.offer.iceRestart) {
      console.log("Received restart offer from caller");

      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.offer)
        );

        const answer = await peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        await peerConnection.setLocalDescription(answer);

        await roomRef.update({
          answer: {
            type: answer.type,
            sdp: answer.sdp,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          },
        });

        remoteDescriptionSet = true;
        console.log("Reconnection answer sent");

        // Stop listening for offers
        unsubscribe();
      } catch (error) {
        console.error("Failed to handle restart offer:", error);
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
  if (
    !window.localCandidateBuffer ||
    window.localCandidateBuffer.length === 0
  ) {
    return;
  }

  console.log(
    `Attempting to flush ${window.localCandidateBuffer.length} buffered candidates`
  );

  const candidates = [...window.localCandidateBuffer];
  window.localCandidateBuffer = [];

  for (const candidateData of candidates) {
    try {
      await db
        .collection("rooms")
        .doc(roomId)
        .collection(candidateData.collection)
        .add(candidateData.candidate);

      console.log("Successfully flushed candidate to Firestore");
    } catch (error) {
      console.error("Failed to flush candidate, re-buffering:", error);
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
    if ("restartIce" in peerConnection) {
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
          iceRestart: true,
        },
      });
    }
  } catch (err) {
    console.error("ICE restart failed:", err);
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
        console.error("Failed to add buffered candidate:", e);
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
      offerToReceiveVideo: true,
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
        console.log("Answer received");
        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          processBufferedCandidates();
          remoteDescriptionSet = true;
        } catch (error) {
          console.error("Failed to set remote description:", error);
        }
      }
    });

    // Listen for callee candidates
    calleeCandidatesCollection.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidateData = change.doc.data();
          console.log(
            "Remote ICE candidate received:",
            candidateData.candidate
          );
          const candidate = new RTCIceCandidate(candidateData);
          handleIncomingIceCandidate(candidate);
        }
      });
    });
  } catch (error) {
    console.error("Start call error:", error);
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
      offerToReceiveVideo: true,
    });
    await peerConnection.setLocalDescription(answer);

    await roomRef.update({
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
      answerCreatedAt: firebase.firestore.FieldValue.serverTimestamp(),
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
          console.log(
            "Remote ICE candidate received:",
            candidateData.candidate
          );
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
    console.error("Join room error:", error);
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
          frameRate: { ideal: 15, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      // Add timeout to media access
      const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Media access timeout")), 10000)
      );

      localStream = await Promise.race([mediaPromise, timeoutPromise]);

      if (localVideo) {
        localVideo.srcObject = localStream;
        try {
          await localVideo.play();
        } catch (e) {
          console.warn("Local video play failed:", e);
          // Try to play with muted attribute
          localVideo.muted = true;
          await localVideo
            .play()
            .catch((e) => console.warn("Muted play also failed:", e));
        }
      }
    } catch (error) {
      console.error("Failed to get media stream:", error);

      // Try fallback with audio only
      if (error.message !== "Media access timeout") {
        try {
          console.log("Attempting audio-only fallback...");
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

          if (localVideo) {
            localVideo.srcObject = localStream;
          }

          updateConnectionStatus("Audio-only mode (camera unavailable)");
        } catch (fallbackError) {
          console.error("Audio fallback also failed:", fallbackError);
          throw new Error("Unable to access any media devices");
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
      .then(() => console.log("ICE candidate added successfully"))
      .catch((e) => {
        console.error("Failed to add ICE candidate:", e);
        iceCandidateBuffer.push(candidate);
      });
  } else {
    console.log("Buffering ICE candidate");
    iceCandidateBuffer.push(candidate);
  }
}

function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    const currentState = peerConnection?.iceConnectionState;
    console.log("Connection timeout triggered, current state:", currentState);

    if (
      currentState === "checking" ||
      currentState === "new" ||
      currentState === "gathering"
    ) {
      console.log("Connection timeout, attempting recovery");
      attemptConnectionRecovery();
    } else if (currentState === "disconnected" || currentState === "failed") {
      console.log(
        "Connection in failed state during timeout, attempting recovery"
      );
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

  // ADD THESE LINES AT THE BEGINNING:
  // Reset video playback state
  playbackState.remoteVideoPlaying = false;
  playbackState.playbackAttempts = 0;
  playbackState.userHasInteracted = false;

  // Remove any UI prompts
  const manualButton = document.getElementById("manual-play-btn");
  const unmutePrompt = document.getElementById("unmute-prompt");
  if (manualButton) manualButton.remove();
  if (unmutePrompt) unmutePrompt.remove();
  // END OF NEW LINES

  // KEEP ALL YOUR EXISTING HANGUP CODE BELOW:
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (roomRef && isCaller) {
    await roomRef
      .update({ callEnded: true })
      .catch((e) => console.error("Failed to update room:", e));
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

if (
  navigator.userAgent.includes("Safari") &&
  !navigator.userAgent.includes("Chrome")
) {
  document.cookie = "crossSiteCookie=fix; SameSite=None; Secure";
}

// Handle page unload to clean up
window.addEventListener("beforeunload", async () => {
  if (peerConnection) {
    await hangUp();
  }
});

document.addEventListener("DOMContentLoaded", initializeVideoCall);
