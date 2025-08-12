import React, { useState, useEffect } from "react";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getDatabase, ref, onValue, off } from "firebase/database"; // Realtime Database
import { getAuth } from "firebase/auth";
import { checkBrowserCompatibility } from "../Utils/browserCompatibility";
import {
  handlePatientClick,
  sendMessageToPatient,
} from "../Handlers/patientsHandlers";
import { handleMarkAsDone } from "../Handlers/patientsHandlers";
import "./DoctorDashboard.css";

const DoctorDashboard = () => {
  const [currentCity, setCurrentCity] = useState("BFN");
  const [showStream, setShowStream] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [capturedData, setCapturedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [patientQueue, setPatientQueue] = useState([]);
  const [browserWarning, setBrowserWarning] = useState(null);
  // Predefined list of cities
  // This can be replaced with a dynamic fetch from your database if needed
  const [availableCities] = useState([
    { code: "BFN", name: "Bloemfontein Base" },
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
        "https://fir-rtc-521a2.web.app",
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

  useEffect(() => {
    const compatibility = checkBrowserCompatibility();

    if (compatibility.level === "problematic") {
      setBrowserWarning({
        title: `Compatibility Issue with ${compatibility.browser.name}`,
        message: compatibility.message,
        actions: compatibility.actions,
      });
    }
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
      const sortedPatients = patientsArray.sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
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
        // The data is already in the correct format from the API
        setCapturedData(data.data);
      } else {
        console.error(data.error);
        setCapturedData(null);
      }
    } catch (error) {
      console.error("Error fetching captured data:", error);
      setCapturedData(null);
    } finally {
      setLoading(false);
    }
  };

  // Download function for captured data as PDF
  const downloadCapturedData = () => {
    if (!capturedData) {
      alert("No data available to download");
      return;
    }

    try {
      // Load jsPDF dynamically
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Set up document properties
        const pageWidth = doc.internal.pageSize.width;
        const margin = 20;
        const lineHeight = 10;
        let yPosition = 30;

        // Header
        doc.setFontSize(20);
        doc.setFont(undefined, "bold");
        doc.text("Patient Vitals Report", margin, yPosition);

        yPosition += 20;

        // Report information
        doc.setFontSize(12);
        doc.setFont(undefined, "normal");
        doc.text(`Room ID: ${searchQuery}`, margin, yPosition);
        yPosition += lineHeight;

        doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, yPosition);
        yPosition += lineHeight;

        doc.text(`Time: ${new Date().toLocaleTimeString()}`, margin, yPosition);
        yPosition += lineHeight;

        if (doctorName) {
          doc.text(`Doctor: Dr. ${doctorName}`, margin, yPosition);
          yPosition += lineHeight;
        }

        const cityName = availableCities.find(
          (c) => c.code === currentCity
        )?.name;
        if (cityName) {
          doc.text(`Location: ${cityName}`, margin, yPosition);
          yPosition += lineHeight;
        }

        yPosition += 10;

        // Draw separator line
        doc.setDrawColor(0, 0, 0);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 15;

        // Vitals section header
        doc.setFontSize(16);
        doc.setFont(undefined, "bold");
        doc.text("Vital Signs", margin, yPosition);
        yPosition += 15;

        doc.setFontSize(12);
        doc.setFont(undefined, "normal");

        // Temperature data
        if (capturedData.temperature) {
          doc.setFont(undefined, "bold");
          doc.text("Temperature:", margin, yPosition);
          doc.setFont(undefined, "normal");
          doc.text(
            `${capturedData.temperature.formatted_value}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `${capturedData.temperature.raw_text}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `Confidence: ${capturedData.temperature.confidence}`,
            margin + 10,
            yPosition
          );
          yPosition += lineHeight + 5;

          // Add image if available
          if (capturedData.temperature.captured_image) {
            try {
              doc.addImage(
                `data:image/jpeg;base64,${capturedData.temperature.captured_image}`,
                "JPEG",
                margin,
                yPosition,
                60, // width
                45 // height
              );
              yPosition += 50; // Adjust for image height
            } catch (error) {
              console.log("Could not add image to PDF:", error);
            }
          }

          yPosition += 5;
        }

        // Weight data
        if (capturedData.weight) {
          doc.setFont(undefined, "bold");
          doc.text("Weight:", margin, yPosition);
          doc.setFont(undefined, "normal");
          doc.text(
            `${capturedData.weight.formatted_value}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `${capturedData.weight.raw_text}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `Confidence: ${capturedData.weight.confidence}`,
            margin + 10,
            yPosition
          );
          yPosition += lineHeight + 5;

          // Add image if available
          if (capturedData.weight.captured_image) {
            try {
              doc.addImage(
                `data:image/jpeg;base64,${capturedData.weight.captured_image}`,
                "JPEG",
                margin,
                yPosition,
                60, // width
                45 // height
              );
              yPosition += 50; // Adjust for image height
            } catch (error) {
              console.log("Could not add image to PDF:", error);
            }
          }

          yPosition += 5;
        }

        // Glucose data
        if (capturedData.glucose) {
          doc.setFont(undefined, "bold");
          doc.text("Glucose:", margin, yPosition);
          doc.setFont(undefined, "normal");
          doc.text(
            `${capturedData.glucose.formatted_value}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `${capturedData.glucose.raw_text}`,
            margin + 40,
            yPosition
          );
          yPosition += lineHeight;
          doc.text(
            `Confidence: ${capturedData.glucose.confidence}`,
            margin + 10,
            yPosition
          );
          yPosition += lineHeight + 5;

          // Add image if available
          if (capturedData.glucose.captured_image) {
            try {
              doc.addImage(
                `data:image/jpeg;base64,${capturedData.glucose.captured_image}`,
                "JPEG",
                margin,
                yPosition,
                60, // width
                45 // height
              );
              yPosition += 50; // Adjust for image height
            } catch (error) {
              console.log("Could not add image to PDF:", error);
            }
          }

          yPosition += 5;
        }

        // Footer
        yPosition += 20;
        doc.setDrawColor(0, 0, 0);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 10;

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by Medical Data Capture System", margin, yPosition);
        doc.text(
          `Generated on: ${new Date().toLocaleString()}`,
          margin,
          yPosition + 8
        );

        // Save the PDF
        const fileName = `patient-vitals-${searchQuery}-${
          new Date().toISOString().split("T")[0]
        }.pdf`;
        doc.save(fileName);

        alert("Patient vitals PDF downloaded successfully!");
      };

      script.onerror = () => {
        console.error("Failed to load jsPDF library");
        alert("Error loading PDF library. Please try again.");
      };

      document.head.appendChild(script);
    } catch (error) {
      console.error("Error downloading PDF:", error);
      alert("Error downloading PDF. Please try again.");
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
      {/* React-style warning banner */}
      {browserWarning && (
        <div className="alert alert-warning">
          <h4>{browserWarning.title}</h4>
          <p>{browserWarning.message}</p>
          <ul>
            {browserWarning.actions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ul>
        </div>
      )}
      <header className="app-header">
        <h1>
          <button
            className="back-button"
            onClick={() => (window.location.href = "/")}
          >
            ←
          </button>
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
                    <div className="flex space-x-2">
                      <button
                        className="message-button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleSendRoomId(patient.id);
                        }}
                        disabled={isSendingMessage}
                      >
                        {isSendingMessage ? "Sending..." : "Send ID"}
                      </button>

                      <button
                        className="done-button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleMarkAsDone(patient.city, patient.id);
                        }}
                      >
                        Done
                      </button>
                    </div>
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
          <div className="results-header">
            <h3>Patient Vitals</h3>
            {capturedData && (
              <button
                className="download-button"
                onClick={downloadCapturedData}
                title="Download patient vitals data"
              >
                <i className="fas fa-file-pdf"></i> Download PDF
              </button>
            )}
          </div>

          <div className="search-section">
            <div className="search-container">
              <input
                type="text"
                className="search-input"
                placeholder="Search by Room ID (manual)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                className="search-button"
                onClick={fetchCapturedData}
                disabled={!searchQuery}
                title="Manual search for historical data"
              >
                🔍
              </button>
              {currentRoomId && !searchQuery && (
                <button
                  className="fill-room-button"
                  onClick={() => setSearchQuery(currentRoomId)}
                  title="Fill current room ID for manual search"
                >
                  Use Current Room
                </button>
              )}
            </div>
          </div>

          <div className="results-content">
            {loading ? (
              <div className="loading-indicator">
                <div className="spinner"></div>
              </div>
            ) : capturedData ? (
              <div className="data-cards">
                {capturedData.temperature && (
                  <div className="data-card temperature-card spaced-card">
                    <h4>Temperature Data</h4>
                    <div className="data-value">
                      {capturedData.temperature.formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.temperature.raw_text}
                    </div>
                    <div className="data-confidence">
                      Confidence: {capturedData.temperature.confidence}
                    </div>
                    {/* ADD THIS IMAGE SECTION */}
                    {capturedData.temperature.captured_image && (
                      <div className="captured-image-section">
                        <h5>Captured Image:</h5>
                        <img
                          src={`data:image/jpeg;base64,${capturedData.temperature.captured_image}`}
                          alt="Temperature reading"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            marginTop: "10px",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {capturedData.weight && (
                  <div className="data-card weight-card spaced-card">
                    <h4>Weight Data</h4>
                    <div className="data-value">
                      {capturedData.weight.formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.weight.raw_text}
                    </div>
                    <div className="data-confidence">
                      Confidence: {capturedData.weight.confidence}
                    </div>
                    {/* ADD THIS IMAGE SECTION */}
                    {capturedData.weight.captured_image && (
                      <div className="captured-image-section">
                        <h5>Captured Image:</h5>
                        <img
                          src={`data:image/jpeg;base64,${capturedData.weight.captured_image}`}
                          alt="Weight reading"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            marginTop: "10px",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {capturedData.glucose && (
                  <div className="data-card glucose-card spaced-card">
                    <h4>Glucose Data</h4>
                    <div className="data-value">
                      {capturedData.glucose.formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.glucose.raw_text}
                    </div>
                    <div className="data-confidence">
                      Confidence: {capturedData.glucose.confidence}
                    </div>
                    {/* ADD THIS IMAGE SECTION */}
                    {capturedData.glucose.captured_image && (
                      <div className="captured-image-section">
                        <h5>Captured Image:</h5>
                        <img
                          src={`data:image/jpeg;base64,${capturedData.glucose.captured_image}`}
                          alt="Glucose reading"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            marginTop: "10px",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {capturedData.blood_pressure && (
                  <div className="data-card blood-pressure-card spaced-card">
                    <h4>Blood Pressure</h4>
                    <div className="data-value">
                      {capturedData.blood_pressure.formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.blood_pressure.raw_text}
                    </div>
                    <div className="data-confidence">
                      Confidence: {capturedData.blood_pressure.confidence}
                    </div>
                    {/* ADD THIS IMAGE SECTION */}
                    {capturedData.blood_pressure.captured_image && (
                      <div className="captured-image-section">
                        <h5>Captured Image:</h5>
                        <img
                          src={`data:image/jpeg;base64,${capturedData.blood_pressure.captured_image}`}
                          alt="Blood pressure reading"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            marginTop: "10px",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {capturedData.endoscope && (
                  <div className="data-card endoscope-card spaced-card">
                    <h4>Endoscope Data</h4>
                    <div className="data-value">
                      {capturedData.endoscope.formatted_value}
                    </div>
                    <div className="data-raw">
                      Raw: {capturedData.endoscope.raw_text}
                    </div>
                    <div className="data-confidence">
                      Confidence: {capturedData.endoscope.confidence}
                    </div>
                    {/* ADD THIS IMAGE SECTION */}
                    {capturedData.endoscope.captured_image && (
                      <div className="captured-image-section">
                        <h5>Captured Image:</h5>
                        <img
                          src={`data:image/jpeg;base64,${capturedData.endoscope.captured_image}`}
                          alt="Endoscope view"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            marginTop: "10px",
                          }}
                        />
                      </div>
                    )}
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
