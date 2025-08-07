import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import Webcam from "react-webcam";
import { getDatabase, ref, onValue, off } from "firebase/database";
import {
  checkBrowserCompatibility,
  displayCompatibilityInfo,
} from "../Utils/browserCompatibility";
import MessageNotification from "../Message/MessageNotification";
import { Link } from "react-router-dom"; // Import Link for debug info navigation
import "./PatientDashboard.css";
//endoscope is a special case and needs to be handled differently by a doctor
const PatientDashboard = () => {
  // Get patient UUID from navigation state or session storage
  const { state } = useLocation();
  const patientId =
    state?.patientId || sessionStorage.getItem("currentPatientId");
  const [showCameraSettings, setShowCameraSettings] = useState(false);
  const webcamRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImages, setCapturedImages] = useState({
    temperature: null,
    weight: null,
    blood_pressure: null,
    glucose: null,
    endoscope: null,
  });
  const [mode, setMode] = useState(null);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameras, setSelectedCameras] = useState({
    temperature: "",
    weight: "",
    blood_pressure: "",
    glucose: "",
    endoscope: "",
    webcam: "",
  });
  const [timer, setTimer] = useState(15);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [activeCapture, setActiveCapture] = useState(null);
  const [capturedData, setCapturedData] = useState({
    temperature: {},
    weight: {},
    blood_pressure: {},
    glucose: {},
    endoscope: {},
  });
  const [roomId, setRoomId] = useState("");
  const [showRoomIdModal, setShowRoomIdModal] = useState(false);
  const [pendingCaptureType, setPendingCaptureType] = useState(null);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [assignedRoom, setAssignedRoom] = useState(null);
  const iframeRef = useRef(null);
  const [city] = useState("BFN"); // Default to BFN, but can be dynamic

  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setCameraDevices(videoDevices);

        const savedSettings = localStorage.getItem("patientCameraSettings");

        if (savedSettings) {
          try {
            const parsedSettings = JSON.parse(savedSettings);
            const validSettings = {};
            Object.keys(parsedSettings).forEach((type) => {
              const deviceId = parsedSettings[type];
              const deviceExists = videoDevices.some(
                (device) => device.deviceId === deviceId
              );
              if (deviceExists) {
                validSettings[type] = deviceId;
              }
            });
            setSelectedCameras((prev) => ({ ...prev, ...validSettings }));
          } catch (error) {
            console.error("Error parsing saved settings:", error);
            autoAssignCameras();
          }
        } else {
          autoAssignCameras();
        }

        // Inline auto-assignment function
        function autoAssignCameras() {
          if (videoDevices.length > 0) {
            const defaultAssignments = {};
            const types = [
              "temperature",
              "weight",
              "blood_pressure",
              "glucose",
              "endoscope",
              "webcam",
            ];

            videoDevices.forEach((device, index) => {
              if (types[index]) {
                defaultAssignments[types[index]] = device.deviceId;
              }
            });

            setSelectedCameras((prev) => ({ ...prev, ...defaultAssignments }));

            try {
              localStorage.setItem(
                "patientCameraSettings",
                JSON.stringify(defaultAssignments)
              );
            } catch (error) {
              console.error("Error saving auto-assigned settings:", error);
            }
          }
        }
      })
      .catch((error) => console.error("Error enumerating devices:", error));
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const exitCamera = () => {
    setActiveCapture(null);
    setTimer(15);
    setCameraReady(false);
    setIsCapturing(false);
  };

  const uploadImage = useCallback(
    async (imageSrc, type) => {
      console.log(`Starting upload for ${type}...`);

      try {
        setIsCapturing(true);

        const response = await fetch(imageSrc);
        if (!response.ok) {
          throw new Error("Failed to process captured image");
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error("Captured image is empty");
        }

        const formData = new FormData();
        formData.append("image", blob, `${type}_${Date.now()}.jpg`);
        formData.append("type", type);
        // Use assignedRoom first, then roomId, then default
        formData.append("roomId", assignedRoom || roomId || "default-room");

        const baseUrl =
          process.env.REACT_APP_API_URL ||
          "https://ocr-backend-application.onrender.com";
        const uploadResponse = await fetch(`${baseUrl}/api/upload/`, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const data = await uploadResponse.json();

        // FIXED: Add null safety for confidence property = formatted_value: data.data?.formatted_value || "Processing...",
        const processedData = {
          raw_text: data.data?.raw_text || "No text detected",
          confidence: data.data?.confidence || 0, // Changed from "unknown" to 0
          ...data.data,
        };

        setCapturedData((prev) => ({ ...prev, [type]: processedData }));

        setCurrentMessage({
          content: `Successfully captured ${type}: ${processedData.formatted_value}`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Upload error:", error);
        setCurrentMessage({
          content: `Failed to capture ${type}: ${error.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
        });
      } finally {
        setIsCapturing(false);
      }
    },
    [roomId, assignedRoom] // Added assignedRoom to dependencies
  );

  const captureImage = useCallback(
    (type) => {
      if (webcamRef.current && !isCapturing) {
        setIsCapturing(true);
        setActiveCapture(type);
        const imageSrc = webcamRef.current.getScreenshot();
        setCapturedImages((prev) => ({ ...prev, [type]: imageSrc }));
        uploadImage(imageSrc, type);
      }
    },
    [isCapturing, uploadImage]
  );
  // Key press effect for debug info
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.ctrlKey && e.key === "d") {
        window.open("/debug", "_blank");
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);
  useEffect(() => {
    // Auto-start session when component mounts
    setMode("session");
    setShowCamera(true);
  }, []);
  const assignCameraToType = (captureType, deviceId) => {
    const newSettings = {
      ...selectedCameras,
      [captureType]: deviceId,
    };

    setSelectedCameras(newSettings);

    // Save to localStorage
    try {
      localStorage.setItem(
        "patientCameraSettings",
        JSON.stringify(newSettings)
      );
      console.log("Saved camera settings:", newSettings);
    } catch (error) {
      console.error("Error saving camera settings:", error);
    }
  };

  useEffect(() => {
    // Load saved camera settings from localStorage
    const savedCameraSettings = localStorage.getItem("patientCameraSettings");
    if (savedCameraSettings) {
      try {
        const parsedSettings = JSON.parse(savedCameraSettings);
        setSelectedCameras(parsedSettings);
        console.log("Loaded saved camera settings:", parsedSettings);
      } catch (error) {
        console.error("Error loading camera settings:", error);
      }
    }
  }, []);
  // Message listener effect
  useEffect(() => {
    if (!patientId || !city) {
      console.log("No patientId or city available");
      return;
    }

    const db = getDatabase();
    const patientRef = ref(db, `patients/${city}/${patientId}`);

    const unsubscribe = onValue(
      patientRef,
      (snapshot) => {
        const data = snapshot.val();
        console.log("Data snapshot:", data);

        if (data?.lastMessage) {
          setCurrentMessage({
            content: data.lastMessage,
            room: data.assignedRoom,
            timestamp: data.messageTimestamp,
          });

          // Update assigned room state
          if (data.assignedRoom) {
            setAssignedRoom(data.assignedRoom);

            // Post message to iframe to auto-join
            const iframe = document.querySelector("iframe");
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage(
                {
                  type: "JOIN_ROOM",
                  roomId: data.assignedRoom,
                  cameraId: selectedCameras.webcam,
                },
                "https://telehealth-application.onrender.com"
              ); // Match iframe origin
            }
          }
        }
      },
      (error) => {
        console.error("Listener error:", error);
      }
    );

    return () => off(patientRef, unsubscribe);
  }, [patientId, city]);
  // Request notification permission
  useEffect(() => {
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  }, []);
  useEffect(() => {
    // Check browser compatibility on component mount
    const compatibility = checkBrowserCompatibility();

    if (!compatibility.compatible) {
      setCurrentMessage({
        content: compatibility.message,
        isError: true,
        timestamp: new Date().toISOString(),
      });

      // Optionally show a persistent warning
      displayCompatibilityInfo("patient-browser-warning");
    }

    // For React, you might want to create a dedicated warning component
    // instead of using the DOM-based displayCompatibilityInfo
  }, []);
  useEffect(() => {
    if (
      showCamera &&
      timer > 0 &&
      cameraReady &&
      activeCapture &&
      !isCapturing
    ) {
      const timerId = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);

      if (timer === 1) {
        captureImage(activeCapture);
        clearInterval(timerId);
        setActiveCapture(null);
        setTimer(15);
        setCameraReady(false);
      }

      return () => clearInterval(timerId);
    }
  }, [
    showCamera,
    timer,
    activeCapture,
    cameraReady,
    isCapturing,
    captureImage,
  ]);

  const handleOnReady = () => {
    setCameraReady(true);
  };

  const handleConfirmRoomId = () => {
    const finalRoomId = assignedRoom || roomId.trim();

    if (finalRoomId) {
      setRoomId(finalRoomId);
      setShowRoomIdModal(false);
      setActiveCapture(pendingCaptureType);
      setTimer(15);
    }
  };

  const handleCapture = (type) => {
    setPendingCaptureType(type);

    // Use assignedRoom if available, otherwise show modal for manual input
    if (assignedRoom) {
      setRoomId(assignedRoom); // Set the room ID from assigned room
      setActiveCapture(type);
      setTimer(15);
    } else {
      setShowRoomIdModal(true);
    }
  };

  const getCurrentCameraId = () => {
    return activeCapture ? selectedCameras[activeCapture] : "";
  };

  const getCameraName = (deviceId) => {
    const device = cameraDevices.find((d) => d.deviceId === deviceId);
    return device
      ? device.label || `Camera ${cameraDevices.indexOf(device) + 1}`
      : "Unknown Camera";
  };

  return (
    <div className="app-container">
      {/* Add this div somewhere prominent in your layout */}
      <div id="patient-browser-warning" className="compatibility-warning"></div>
      <header className="app-header">
        <button
          className="back-button"
          onClick={() => (window.location.href = "/")}
        >
          ←
        </button>

        <h1>
          Medical Data Capture System - Patient Dashboard -
          {patientId && <span className="patient-id-header"> {patientId}</span>}
        </h1>

        {mode && (
          <h2 className={`mode-indicator ${mode}`}>
            Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </h2>
        )}
      </header>
      <div className="main-content">
        <MessageNotification
          currentMessage={currentMessage}
          assignedRoom={assignedRoom}
        />

        {/* Patient ID and city for debug info hidden */}
        {process.env.NODE_ENV === "development" && (
          <Link to="/debug" state={{ patientId, city }} className="debug-link">
            Debug Info
          </Link>
        )}

        <div className="sidebar">
          <h3>Actions</h3>
          <div className="button-group">
            <button
              onClick={() => setShowCameraSettings(true)}
              className="button camera-settings-btn"
            >
              <i className="icon camera-icon"></i>
              Camera Settings
            </button>
          </div>

          <div className="camera-info">
            <h4>Camera Assignments:</h4>
            <div className="camera-list">
              <p>
                <strong>Temperature:</strong>{" "}
                {getCameraName(selectedCameras.temperature)}
              </p>
              <p>
                <strong>Weight:</strong> {getCameraName(selectedCameras.weight)}
              </p>
              <p>
                <strong>Blood Pressure:</strong>{" "}
                {getCameraName(selectedCameras.blood_pressure)}
              </p>
              <p>
                <strong>Glucose:</strong>{" "}
                {getCameraName(selectedCameras.glucose)}
              </p>
              <p>
                <strong>Endoscope:</strong>{" "}
                {getCameraName(selectedCameras.endoscope)}
              </p>
              <p>
                <strong>Webcam:</strong>{""}
                {getCameraName(selectedCameras.webcam)}
              </p>
            </div>
            <div className="camera-count">
              <p>{cameraDevices.length} camera(s) detected</p>
              <button onClick={refreshDevices} className="refresh-btn">
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="camera-view">
          <div className="camera-view enhanced-camera-view">
            <div className="capture-controls enhanced-capture-controls">
              {[
                "temperature",
                "weight",
                "blood_pressure",
                "glucose",
                "endoscope",
              ].map((type) => (
                <button
                  key={type}
                  onClick={() => handleCapture(type)}
                  className={`capture-type-btn enhanced-btn ${
                    activeCapture === type ? "active" : ""
                  }`}
                >
                  Capture{" "}
                  {type
                    .replace("_", " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </button>
              ))}
            </div>

            {activeCapture && (
              <div className="compact-camera-container enhanced-camera-box">
                <div className="timer-display enhanced-timer">
                  <span className="timer-circle">{timer}</span>
                  <p>
                    <strong>
                      Capturing {activeCapture.replace("_", " ").toUpperCase()}{" "}
                      in {timer}...
                    </strong>
                  </p>
                  <p className="camera-label">
                    Using Camera:{" "}
                    <em>{getCameraName(selectedCameras[activeCapture])}</em>
                  </p>
                </div>

                <Webcam
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  className="compact-webcam enhanced-webcam"
                  videoConstraints={{
                    deviceId: getCurrentCameraId(),
                    facingMode: "user",
                  }}
                  onUserMedia={handleOnReady}
                />

                <div className="camera-controls">
                  <button
                    className="button exit-btn enhanced-exit-btn"
                    onClick={exitCamera}
                  >
                    ❌ Close Capture
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="stream-view">
            <iframe
              ref={iframeRef}
              src="https://telehealth-application.onrender.com/" // Adjust this URL to your video conferencing app
              title="Video Conferencing"
              width="100%"
              height="500px"
              style={{ border: "none" }}
              allow="camera; microphone"
            ></iframe>
          </div>

          <div className="empty-state"></div>
        </div>
        <div className="results-panel">
          <h3>Patient Vitals</h3>
          <div className="results-content">
            {/* Temperature Reading */}
            {capturedData.temperature && (
              <div className="result-card">
                <h4>Temperature Reading</h4>
                <div className="result-value">
                  <p>{capturedData.temperature?.raw_text || "N/A"}</p>
                </div>
                <div className="result-meta">
                  <p>
                    Confidence: {capturedData.temperature?.confidence || "N/A"}
                  </p>
                </div>
                {capturedImages.temperature && (
                  <img
                    src={capturedImages.temperature}
                    alt="Temperature scan"
                    className="result-image"
                  />
                )}
              </div>
            )}

            {/* Weight Reading */}
            {capturedData.weight && (
              <div className="result-card">
                <h4>Weight Reading</h4>
                <div className="result-value">
                  <p>{capturedData.weight?.raw_text || "N/A"}</p>
                </div>
                <div className="result-meta">
                  <p>Confidence: {capturedData.weight?.confidence || "N/A"}</p>
                </div>
                {capturedImages.weight && (
                  <img
                    src={capturedImages.weight}
                    alt="Weight scan"
                    className="result-image"
                  />
                )}
              </div>
            )}

            {/* Blood Pressure */}
            {capturedData.blood_pressure && (
              <div className="result-card">
                <h4>Blood Pressure</h4>
                <div className="result-value">
                  {capturedData.blood_pressure?.raw_text || "N/A"}
                </div>
                <div className="result-meta">
                  <p></p>
                  <p>
                    Confidence:{" "}
                    {capturedData.blood_pressure?.confidence || "N/A"}
                  </p>
                </div>
                {capturedImages.blood_pressure && (
                  <img
                    src={capturedImages.blood_pressure}
                    alt="Blood Pressure scan"
                    className="result-image"
                  />
                )}
              </div>
            )}

            {/* Glucose */}
            {capturedData.glucose && (
              <div className="result-card">
                <h4>Glucose</h4>
                <div className="result-value">
                  <p>{capturedData.glucose?.raw_text || "N/A"}</p>
                </div>
                <div className="result-meta">
                  <p>Confidence: {capturedData.glucose?.confidence || "N/A"}</p>
                </div>
                {capturedImages.glucose && (
                  <img
                    src={capturedImages.glucose}
                    alt="Glucose scan"
                    className="result-image"
                  />
                )}
              </div>
            )}

            {/* Endoscope */}
            {capturedData.endoscope && (
              <div className="result-card">
                <h4>Endoscope</h4>
                {capturedImages.endoscope && (
                  <img
                    src={capturedImages.endoscope}
                    alt="Endoscope scan"
                    className="result-image"
                  />
                )}
              </div>
            )}
            {!capturedData.temperature &&
              !capturedData.weight &&
              !capturedData.blood_pressure &&
              !capturedData.glucose &&
              !capturedData.endoscope && (
                <div className="no-data">
                  <p>No readings captured yet</p>
                </div>
              )}
          </div>
        </div>
      </div>
      {showRoomIdModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Room Assignment</h3>

            {assignedRoom ? (
              <div>
                <p>You have been assigned to room:</p>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: "bold",
                    color: "#2ecc71",
                    margin: "1rem 0",
                    padding: "0.5rem",
                    backgroundColor: "#f0f8f5",
                    borderRadius: "8px",
                  }}
                >
                  {assignedRoom}
                </div>
                <p>Click confirm to proceed with capture.</p>
              </div>
            ) : (
              <div>
                <p>No room assigned yet. Enter room ID manually:</p>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Enter Room ID"
                />
              </div>
            )}

            <div className="modal-buttons">
              <button
                onClick={handleConfirmRoomId}
                disabled={!assignedRoom && !roomId.trim()}
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  setShowRoomIdModal(false);
                  setRoomId("");
                  setPendingCaptureType(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
     {/* {assignedRoom && (
        <div
          style={{
            backgroundColor: "#2ecc71",
            color: "white",
            padding: "5px 15px",
            borderRadius: "20px",
            fontSize: "0.9rem",
            marginLeft: "15px",
          }}
        >
          Room: {assignedRoom}
        </div>
      )} */}
      {showCameraSettings && (
        <div className="modal-backdrop">
          <div className="modal camera-settings-modal">
            <h3>Camera Settings</h3>
            <p>Assign cameras to capture types</p>

            <div className="camera-assignments">
              {/* Temperature Camera */}
              <div className="camera-assignment-row">
                <label className="assignment-label">
                  <strong>Temperature:</strong>
                </label>
                <select
                  value={selectedCameras.temperature || ""}
                  onChange={(e) =>
                    assignCameraToType("temperature", e.target.value)
                  }
                  className="camera-select"
                >
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Weight Camera */}
              <div className="camera-assignment-row">
                <label className="assignment-label">
                  <strong>Weight:</strong>
                </label>
                <select
                  value={selectedCameras.weight || ""}
                  onChange={(e) => assignCameraToType("weight", e.target.value)}
                  className="camera-select"
                >
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Blood Pressure Camera */}
              <div className="camera-assignment-row">
                <label className="assignment-label">
                  <strong>Blood Pressure:</strong>
                </label>
                <select
                  value={selectedCameras.blood_pressure || ""}
                  onChange={(e) =>
                    assignCameraToType("blood_pressure", e.target.value)
                  }
                  className="camera-select"
                >
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Glucose Camera */}
              <div className="camera-assignment-row">
                <label className="assignment-label">
                  <strong>Glucose:</strong>
                </label>
                <select
                  value={selectedCameras.glucose || ""}
                  onChange={(e) =>
                    assignCameraToType("glucose", e.target.value)
                  }
                  className="camera-select"
                >
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Endoscope Camera */}
              <div className="camera-assignment-row">
                <label className="assignment-label">
                  <strong>Endoscope:</strong>
                </label>
                <select
                  value={selectedCameras.endoscope || ""}
                  onChange={(e) =>
                    assignCameraToType("endoscope", e.target.value)
                  }
                  className="camera-select"
                >
                  <option value="">Select Camera</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              {/* Webcam Camera */}
              <div className="camera-assignment-row">
  <label className="assignment-label">
    <strong>Webcam (Video Conferencing):</strong>
  </label>
  <select
    value={selectedCameras.webcam || ""}
    onChange={(e) => assignCameraToType("webcam", e.target.value)}
    className="camera-select"
  >
    <option value="">Select Camera</option>
    {cameraDevices.map((device, index) => (
      <option key={device.deviceId} value={device.deviceId}>
        {device.label || `Camera ${index + 1}`}
      </option>
    ))}
  </select>
</div>
            </div>

            {/* Camera Info */}
            <div className="camera-info-section">
              <h4>Available Cameras ({cameraDevices.length})</h4>
              <div className="available-cameras">
                {cameraDevices.map((device, index) => (
                  <div key={device.deviceId} className="camera-info-item">
                    <span className="camera-number">#{index + 1}</span>
                    <span className="camera-name">
                      {device.label || `Camera ${index + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="modal-buttons">
              <button
                onClick={() => setShowCameraSettings(false)}
                className="button save-btn"
              >
                Save Settings
              </button>
              <button onClick={refreshDevices} className="button refresh-btn">
                Refresh Cameras
              </button>

              {/* ADD THE RESET BUTTON HERE: */}
              <button
                onClick={() => {
                  localStorage.removeItem("patientCameraSettings");
                  // Reset to empty state, then refresh to auto-assign
                  setSelectedCameras({
                    temperature: "",
                    weight: "",
                    blood_pressure: "",
                    glucose: "",
                    endoscope: "",
                  });
                  refreshDevices();
                  console.log("Reset camera settings to default");
                }}
                className="button reset-btn"
                style={{ backgroundColor: "#dc3545", color: "white" }}
              >
                Reset to Default
              </button>

              <button
                onClick={() => setShowCameraSettings(false)}
                className="button cancel-btn"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;
