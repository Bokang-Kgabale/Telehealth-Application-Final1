import { getDatabase, ref, set, remove } from "firebase/database";
import { serverTimestamp } from "firebase/database";

/**
 * Handles clicking on a patient in the queue
 * @param {Object} patient - The patient object
 * @param {Function} [setSelectedPatient] - Optional state setter for selected patient
 */
export const handlePatientClick = (patient, setSelectedPatient = null) => {
    console.log("Patient clicked:", patient);
    
    if (setSelectedPatient) {
        setSelectedPatient(patient);
    }
};

/**
 * Initiates a call with a patient
 * @param {Object} patient - The patient object
 * @param {Function} [setShowStream] - Optional state setter for stream visibility
 * @param {Function} [setSearchQuery] - Optional state setter for search query
 */


/**
 * Sends a message to a patient with room assignment
 * @param {string} city - Current city code
 * @param {string} patientId - ID of the patient
 * @param {string} message - Message content
 * @param {string} currentRoomId - Current room ID
 * @returns {Promise<boolean>} Whether the message was sent successfully
 */
export const sendMessageToPatient = async (
    city, 
    patientId, 
    message,
    currentRoomId
) => {
    if (!currentRoomId) {
        console.error("Cannot send message - no room assigned");
        return false;
    }

    const db = getDatabase();
    const patientRef = ref(db, `patients/${city}/${patientId}`);
    
    try {
        await set(patientRef, {
            id: patientId,
            city: city,
            status: 'in_consultation',
            assignedRoom: currentRoomId, // Now properly set to current room
            lastMessage: message,
            lastActive: serverTimestamp(),
            messageTimestamp: serverTimestamp()
        });
        console.log(`Message sent to ${patientId} for room ${currentRoomId}`);
        return true;
    } catch (error) {
        console.error("Failed to send message:", error);
        return false;
    }
};
export const handleMarkAsDone = async (city, patientId) => {
    const db = getDatabase();
    const patientRef = ref(db, `patients/${city}/${patientId}`);
    
    try {
        await remove(patientRef);
        console.log(`Patient ${patientId} removed from the queue.`);
    } catch (error) {
        console.error(`Failed to remove patient ${patientId}:`, error);
    }
};
