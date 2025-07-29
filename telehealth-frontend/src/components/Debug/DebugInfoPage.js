import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDatabase, ref, get, onValue, off } from 'firebase/database';
import './DebugInfoPage.css';

const DebugInfoPage = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [patientData, setPatientData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [realtimeUpdates, setRealtimeUpdates] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const patientId = state?.patientId || localStorage.getItem('currentPatientId');
  const city = state?.city || 'CPT';

  const fetchPatientData = useCallback(async () => {
    if (!patientId) return;
    
    setLoading(true);
    try {
      const db = getDatabase();
      const dbRef = ref(db, `patients/${city}/${patientId}`);
      const snapshot = await get(dbRef);
      setPatientData(snapshot.val());
      setConnectionStatus('connected');
    } catch (error) {
      console.error('Error fetching patient data:', error);
      setConnectionStatus('error');
    } finally {
      setLoading(false);
    }
  }, [patientId, city]);

  useEffect(() => {
    if (!realtimeUpdates || !patientId) return;

    const db = getDatabase();
    const dbRef = ref(db, `patients/${city}/${patientId}`);
    
    const unsubscribe = onValue(dbRef, (snapshot) => {
      setPatientData(snapshot.val());
      setConnectionStatus('active');
    }, (error) => {
      console.error('Realtime listener error:', error);
      setConnectionStatus('error');
    });

    return () => {
      off(dbRef, unsubscribe);
      setConnectionStatus('disconnected');
    };
  }, [realtimeUpdates, patientId, city]);

  useEffect(() => {
    fetchPatientData();
  }, [fetchPatientData]);

  return (
    <div className="debug-page">
      <header className="debug-header">
        <h2>System Debug Information</h2>
        <button onClick={() => navigate(-1)} className="back-button">
          Back to Dashboard
        </button>
      </header>

      <div className="debug-controls">
        <button onClick={fetchPatientData} className="refresh-btn" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
        
        <label className="realtime-toggle">
          <input
            type="checkbox"
            checked={realtimeUpdates}
            onChange={() => setRealtimeUpdates(!realtimeUpdates)}
          />
          Realtime Updates
        </label>

        <div className="connection-status">
          <span className={`status-indicator ${connectionStatus}`} />
          Status: {connectionStatus}
        </div>
      </div>

      <div className="debug-section">
        <h3>Patient Data</h3>
        {loading ? (
          <p className="loading">Loading data...</p>
        ) : patientData ? (
          <pre>{JSON.stringify(patientData, null, 2)}</pre>
        ) : (
          <p className="no-data">No patient data available</p>
        )}
      </div>
    </div>
  );
};

export default DebugInfoPage;