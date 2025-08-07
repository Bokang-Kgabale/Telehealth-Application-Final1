import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDatabase, ref, set, serverTimestamp } from "firebase/database";
import "./Auth.css";

function PatientLogin() {
  const [patientId] = useState("BFN-Tele1"); // Hardcoded for demonstration
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const navigate = useNavigate();
  const db = getDatabase();

  const city = "BFN";

  const handleJoinQueue = async () => {
    setLoading(true);
    try {
      // Primary write to patients path
      await set(ref(db, `patients/${city}/${patientId}`), {
        id: patientId,
        city: city,
        status: "waiting",
        assignedRoom: null,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      });
      setShowSuccess(true);

      setTimeout(() => {
        navigate("/patient", {
          state: {
            patientId: patientId,
            city: city,
          },
        });
      }, 2000);
    } catch (err) {
      console.error("Database error:", err);
      alert(`Error joining queue: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {showSuccess && (
        <div className="success-modal">
          <div className="success-content">
            <h3>Successfully Joined Queue!</h3>
            <p>Your ID: {patientId}</p>
            <p>You will be redirected shortly...</p>
          </div>
        </div>
      )}
      <header className="auth-header">
        <button className="back-button" onClick={() => navigate("/")}>
          Back
        </button>
        <h1>Telehealth Patient Portal</h1>
      </header>
      <div className="auth-form-container">
        <div className="patient-id-display">
          <h3>Your Patient ID</h3>
          <div className="patient-id">{patientId}</div>
          <p className="location-info">Tele 1</p>
        </div>

        <button
          className="auth-button"
          onClick={handleJoinQueue}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Joining Queue...
            </>
          ) : (
            "Enter Queue"
          )}
        </button>

        <div className="info-message">
          <p>This ID will expire when you leave this page.</p>
          <p>No personal information is required.</p>
        </div>
      </div>
    </div>
  );
}

export default PatientLogin;
