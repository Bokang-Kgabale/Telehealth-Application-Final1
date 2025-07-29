import { getDatabase, ref, onValue, off, get } from "firebase/database";

/**
 * Fetches and monitors the patient queue for a specific city
 * @param {string} cityCode - City code (e.g. "CPT", "JHB")
 * @param {function} callback - Function to receive queue updates
 * @returns {function} Unsubscribe function
 */
export const monitorCityQueue = (cityCode, callback) => {
  const db = getDatabase();
  const queueRef = ref(db, `patients/${cityCode}`);
  
  // Set up realtime listener
  const handleSnapshot = (snapshot) => {
    const patients = [];
    
    snapshot.forEach((childSnapshot) => {
      const patient = childSnapshot.val();
      patients.push({
        id: childSnapshot.key,  // Use the key as fallback ID
        ...patient,             // Spread all existing properties
        status: patient.status || 'waiting'  // Default status
      });
    });

    // Sort by creation time (oldest first)
    patients.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    
    callback(patients);
  };

  onValue(queueRef, handleSnapshot);

  // Return unsubscribe function
  return () => off(queueRef, handleSnapshot);
};

/**
 * Get current queue snapshot (one-time read)
 */
export const getCityQueue = async (cityCode) => {
  const db = getDatabase();
  const queueRef = ref(db, `patients/${cityCode}`);
  
  try {
    const snapshot = await get(queueRef);
    if (!snapshot.exists()) return [];

    const patients = [];
    snapshot.forEach((childSnapshot) => {
      patients.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });
    
    return patients.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch (error) {
    console.error("Error fetching queue:", error);
    return [];
  }
};