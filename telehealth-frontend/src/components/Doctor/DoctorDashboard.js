import React, { useState, useEffect } from "react";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getDatabase, ref, onValue, off } from "firebase/database"; // Realtime Database
import { getAuth } from "firebase/auth";
import {
  handlePatientClick,
  sendMessageToPatient,
} from "../Handlers/patientsHandlers";
import "./DoctorDashboard.css";

const DoctorDashboard = () => {
  const [currentCity, setCurrentCity] = useState("CPT");
  const [showStream, setShowStream] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [capturedData, setCapturedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [patientQueue, setPatientQueue] = useState([]);
  const [availableCities] = useState([
    { code: "CPT", name: "Cape Town Hub" },
    { code: "JHB", name: "Johannesburg Base" },
  ]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Fetch doctor's name on component mount
  useEffect(() => {
    const fetchDoctorName = async () => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (user) {
          const db = getFirestore();
          const doctorRef = doc(db, "doctors", user.uid);
          const doctorSnap = await getDoc(doctorRef);
          if (doctorSnap.exists()) {
            setDoctorName(doctorSnap.data().fullName || "");
          }
        }
      } catch (error) {
        console.error("Error fetching doctor data:", error);
      }
    };
    fetchDoctorName();
  }, []);
  

  // Handle messages from video call iframe
  useEffect(() => {
    const handleMessage = (event) => {
      const allowedOrigins = [
        "http://localhost:8001",
        "http://127.0.0.1:8001",
        "https://telehealth-application.onrender.com",
      ];

      if (!allowedOrigins.includes(event.origin)) {
        console.warn("Ignored message from:", event.origin);
        return;
      }

      if (event.data.type === "ROOM_CREATED") {
        console.log("Received room ID:", event.data.roomId);
        setCurrentRoomId(event.data.roomId);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Monitor queue when city changes using queueService
// Replace the current monitorCityQueue useEffect with this:
useEffect(() => {
  const db = getDatabase();
  const patientsRef = ref(db, `patients/${currentCity}`);

  // Listen for realtime updates
  const unsubscribe = onValue(patientsRef, (snapshot) => {
    const patientsData = snapshot.val();
    
    // Convert the object of patients into an array
    const patientsArray = patientsData 
      ? Object.keys(patientsData).map((patientId) => ({
          id: patientId,
          ...patientsData[patientId],
        }))
      : [];

    // Sort by createdAt timestamp (fallback to 0 if missing)
    const sortedPatients = patientsArray.sort((a, b) => 
      (a.createdAt || 0) - (b.createdAt || 0)
    );

    setPatientQueue(sortedPatients);
  });

  // Clean up listener on unmount or city change
  return () => off(patientsRef, unsubscribe);
}, [currentCity]);

  const toggleLiveStream = () => {
    setShowStream(!showStream);
  };

  const fetchCapturedData = async () => {
    if (!searchQuery.trim()) {
      alert("Please enter a Room ID.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `https://ocr-backend-application.onrender.com/api/get-data/?roomId=${encodeURIComponent(
          searchQuery
        )}`
      );
      const data = await response.json();

      if (response.ok) {
        setCapturedData(data.data);
      } else {
        console.error(data.error);
        setCapturedData(null);
      }
    } catch (error) {
      console.error("Error fetching captured data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatWaitTime = (timestamp) => {
    if (!timestamp) return "";
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    return `${minutes} min`;
  };

  const handleSendRoomId = async (patientId) => {
    if (!currentRoomId) {
      alert("Please start a video call first to get a room ID");
      return;
    }

    setIsSendingMessage(true);
    try {
      const message = `Please proceed to consultation room ${currentRoomId}`;
      const success = await sendMessageToPatient(
        currentCity,
        patientId,
        message,
        currentRoomId // This ensures assignedRoom matches the message
      );

      if (success) {
        alert(`Room ${currentRoomId} assigned to patient ${patientId}`);
      } else {
        alert("Failed to assign room");
      }
    } catch (error) {
      console.error("Error assigning room:", error);
      alert("Error assigning room");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const copyRoomId = () => {
    if (!currentRoomId) return;
    navigator.clipboard
      .writeText(currentRoomId)
      .then(() => alert("Room ID copied to clipboard"))
      .catch((err) => console.error("Failed to copy room ID:", err));
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>
          Medical Data Capture System -{" "}
          {availableCities.find((c) => c.code === currentCity)?.name} -
          {doctorName && (
            <span className="doctor-name-header"> Dr. {doctorName}</span>
          )}
        </h1>
        <div className="location-selector">
          <select
            value={currentCity}
            onChange={(e) => setCurrentCity(e.target.value)}
          >
            {availableCities.map((city) => (
              <option key={city.code} value={city.code}>
                {city.name} ({patientQueue.length})
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="main-content">
        <div className="sidebar">
          <div className="button-group">
            <button
              onClick={toggleLiveStream}
              className={`button stream-btn ${showStream ? "active" : ""}`}
            >
              <i className="icon stream-icon"></i>
              {showStream ? "Stop Live Stream" : "Start Live Stream"}
            </button>

            {currentRoomId && (
              <div className="active-room">
                Room N.o: <strong>{currentRoomId}</strong>
                <button
                  onClick={copyRoomId}
                  className="copy-button"
                  title="Copy Room ID"
                >
                  <i className="fas fa-copy"></i>
                </button>
              </div>
            )}
          </div>

          <div className="queue-section">
            <h4>Current Queue ({patientQueue.length})</h4>
            <ul>
              {patientQueue.map((patient, index) => (
                <li
                  key={patient.id}
                  className={`patient-item ${patient.status} ${
                    index === 0 ? "next-patient" : ""
                  }`}
                  onClick={() => handlePatientClick(patient)}
                >
                  <span className="patient-id">
                    {index + 1}. {patient.id}
                    {patient.status === "in_consultation" && (
                      <span className="status-badge">In Session</span>
                    )}
                  </span>
                  <span className="patient-actions">
                    <button
                      className="message-button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleSendRoomId(patient.id);
                      }}
                      disabled={isSendingMessage}
                    >
                      {isSendingMessage ? "Sending..." : "Send Room ID"}
                    </button>
                  </span>
                  <span className="wait-time">
                    {formatWaitTime(patient.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="camera-container">
          {showStream ? (
            <div className="stream-view">
              <iframe
                src="https://telehealth-application.onrender.com/"
                title="Video Conferencing"
                width="100%"
                height="500px"
                style={{ border: "none" }}
                allow="camera; microphone"
              ></iframe>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-content">
                <i className="icon camera-icon2 large"></i>
                <h2>Start a Live Stream</h2>
                <p>Use the button on the left to start the live stream</p>
              </div>
            </div>
          )}
        </div>

        <div className="results-panel">
          <h3>Patient Vitals</h3>

          <div className="search-section">
            <div className="search-container">
              <input
                type="text"
                className="search-input"
                placeholder="Search by Room ID..."
                value={currentRoomId || searchQuery} // Auto-fills with currentRoomId when available
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                className="search-button"
                onClick={fetchCapturedData}
                disabled={!currentRoomId && !searchQuery} // Disable if no room ID
              >
                🔍
              </button>
            </div>
          </div>

          <div className="results-content">
            {loading ? (
              <div className="loading-indicator">
                <div className="spinner"></div>
              </div>
            ) : capturedData ? (
              <div className="data-cards">
                {capturedData.temperature &&
                  capturedData.temperature.length > 0 && (
                    <div className="data-card temperature-card spaced-card">
                      <h4>Temperature Data</h4>
                      <div className="data-value">
                        {capturedData.temperature[0].formatted_value}
                      </div>
                      <div className="data-raw">
                        Raw: {capturedData.temperature[0].raw_text}
                      </div>
                    </div>
                  )}
                {capturedData.weight && capturedData.weight.length > 0 && (
                  <div className="data-card weight-card spaced-card">
                    <h4>Weight Data</h4>
                    <div className="data-value">
                      {capturedData.weight[0].formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.weight[0].raw_text}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="no-data">
                <p>No data received yet</p>
                <p>Waiting for captured data...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoctorDashboard;
