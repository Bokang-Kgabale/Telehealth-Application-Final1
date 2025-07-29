import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getDatabase, ref, set, serverTimestamp } from "firebase/database";
import AnimatedUUID from "../Animations/AnimatedUUID";
import "./Auth.css";

function PatientLogin() {
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const navigate = useNavigate();
  const db = getDatabase();
  const city = "CPT";

  useEffect(() => {
    if (patientId) {
      sessionStorage.setItem('currentPatientId', patientId);
    }
  }, [patientId]);

  const handleJoinQueue = async () => {
    if (!patientId) {
      alert("Please wait for your Patient ID to generate");
      return;
    }

    setLoading(true);
    try {
      // Primary write to patients path
      await set(ref(db, `patients/${city}/${patientId}`), {
        id: patientId,
        city: city,
        status: 'waiting',
        assignedRoom: null,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      });
      setShowSuccess(true);
      
      setTimeout(() => {
        navigate('/patient', { 
          state: { 
            patientId: patientId,
            city: city
          } 
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
        <h1>Telehealth Patient Portal</h1>
        <h2>Cape Town Location</h2>
      </header>

      <div className="auth-form-container">
        <div className="patient-id-display">
          <h3>Your Temporary Patient ID</h3>
          <AnimatedUUID 
            prefix={city}
            onFinalize={(id) => {
              setPatientId(id);
              sessionStorage.setItem('pendingPatientId', id);
            }}
          />
          <p className="location-info">Location: Cape Town ({city})</p>
        </div>

        <button 
          className="auth-button"
          onClick={handleJoinQueue}
          disabled={!patientId || loading}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Joining Queue...
            </>
          ) : "Enter Queue"}
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