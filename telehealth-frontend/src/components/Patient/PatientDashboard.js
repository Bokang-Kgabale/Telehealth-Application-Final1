import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import Webcam from "react-webcam";
import { getDatabase, ref, onValue, off } from "firebase/database";
import MessageNotification from "../Message/MessageNotification";
import { Link } from "react-router-dom"; // Import Link for debug info navigation
import "./PatientDashboard.css";
//endoscope is a special case and needs to be handled differently by a doctor
const PatientDashboard = () => {
  // Get patient UUID from navigation state or session storage
  const { state } = useLocation();
  const patientId =
    state?.patientId || sessionStorage.getItem("currentPatientId");

  const webcamRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showStream, setShowStream] = useState(false);
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
  });
  const [timer, setTimer] = useState(5);
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
  const [cameraSelectionModal, setCameraSelectionModal] = useState(false);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [assignedRoom, setAssignedRoom] = useState(null);
  const iframeRef = useRef(null);
  const [city] = useState("CPT"); // Default to CPT, but can be dynamic

  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setCameraDevices(videoDevices);

        if (videoDevices.length > 0) {
          const temperatureCamera = videoDevices[0].deviceId;
          const weightCamera =
            videoDevices.length > 1
              ? videoDevices[1].deviceId
              : videoDevices[0].deviceId;

          setSelectedCameras({
            temperature: temperatureCamera,
            weight: weightCamera,
          });
        }
      })
      .catch((error) => console.error("Error enumerating devices:", error));
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const openCaptureWindow = () => {
    setMode("capture");
    setShowCamera(true);
    setShowStream(false);
    resetState();
  };

  const toggleLiveStream = async () => {
    setMode(mode === "stream" ? null : "stream");
    setShowStream(!showStream);
    setShowCamera(false);
    resetState();
  };

  const exitCamera = () => {
    setShowCamera(false);
    setShowStream(false);
    setMode(null);
    setTimer(5);
    setCameraReady(false);
    setIsCapturing(false);
    setActiveCapture(null);
  };

  const resetState = () => {
    setTimer(5);
    setCameraReady(false);
    setIsCapturing(false);
    setActiveCapture(null);
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

        // FIXED: Add null safety for confidence property
        const processedData = {
          formatted_value: data.data?.formatted_value || "Processing...",
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
                },
                "https://telehealth-application.onrender.com/"
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
        exitCamera();
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

  const startSession = () => {
    setMode("session");
    setShowCamera(true);
    setShowStream(true);
    resetState();
    toggleLiveStream();
    openCaptureWindow();
  };

  const handleConfirmRoomId = () => {
    const finalRoomId = assignedRoom || roomId.trim();

    if (finalRoomId) {
      setRoomId(finalRoomId);
      setShowRoomIdModal(false);
      setActiveCapture(pendingCaptureType);
      setTimer(5);
    }
  };

  const handleCapture = (type) => {
    setPendingCaptureType(type);

    // Use assignedRoom if available, otherwise show modal for manual input
    if (assignedRoom) {
      setRoomId(assignedRoom); // Set the room ID from assigned room
      setActiveCapture(type);
      setTimer(5);
    } else if (cameraDevices.length > 1) {
      setCameraSelectionModal(true);
    } else {
      setShowRoomIdModal(true);
    }
  };

  const handleCameraSelection = (deviceId) => {
    if (pendingCaptureType) {
      setSelectedCameras((prev) => ({
        ...prev,
        [pendingCaptureType]: deviceId,
      }));
      setCameraSelectionModal(false);

      // Use assignedRoom if available, otherwise show room ID modal
      if (assignedRoom) {
        setRoomId(assignedRoom);
        setActiveCapture(pendingCaptureType);
        setTimer(5);
      } else {
        setShowRoomIdModal(true);
      }
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
            <button onClick={startSession} className="button start-session-btn">
              <i className="icon stream-icon"></i>
              Capture Vitals
            </button>

            <button
              onClick={() => setCameraSelectionModal(true)}
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
                //"endoscope",
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
                  {capturedData.temperature?.formatted_value || "N/A"}
                </div>
                <div className="result-meta">
                  <p>Raw OCR: {capturedData.temperature?.raw_text || "N/A"}</p>
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
                  {capturedData.weight?.formatted_value || "N/A"}
                </div>
                <div className="result-meta">
                  <p>Raw OCR: {capturedData.weight?.raw_text || "N/A"}</p>
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
                  {capturedData.blood_pressure?.formatted_value || "N/A"}
                </div>
                <div className="result-meta">
                  <p>
                    Raw OCR: {capturedData.blood_pressure?.raw_text || "N/A"}
                  </p>
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
                  {capturedData.glucose?.formatted_value || "N/A"}
                </div>
                <div className="result-meta">
                  <p>Raw OCR: {capturedData.glucose?.raw_text || "N/A"}</p>
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
                <div className="result-value">
                  {capturedData.endoscope?.formatted_value || "N/A"}
                </div>
                <div className="result-meta">
                  <p>Raw OCR: {capturedData.endoscope?.raw_text || "N/A"}</p>
                  <p>
                    Confidence: {capturedData.endoscope?.confidence || "N/A"}
                  </p>
                </div>
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
      {assignedRoom && (
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
      )}
      {cameraSelectionModal && (
        <div className="modal-backdrop">
          <div className="modal camera-modal">
            <h3>Select Camera for {pendingCaptureType || "Capture"}</h3>

            {cameraDevices.length > 0 ? (
              <div className="camera-options">
                {cameraDevices.map((device, index) => (
                  <button
                    key={device.deviceId}
                    className="camera-option-btn"
                    onClick={() => handleCameraSelection(device.deviceId)}
                  >
                    {device.label || `Camera ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : (
              <p>No cameras detected. Please check your permissions.</p>
            )}

            <div className="modal-buttons">
              <button
                onClick={() => {
                  setCameraSelectionModal(false);
                  setPendingCaptureType(null);
                }}
              >
                Cancel
              </button>
              <button onClick={refreshDevices}>Refresh Cameras</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;
