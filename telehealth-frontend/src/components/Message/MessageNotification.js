import React, { useState, useEffect } from 'react';
import './MessageNotification.css';

const MessageNotification = ({ currentMessage, assignedRoom }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isSlidingOut, setIsSlidingOut] = useState(false);
  const [notificationSound] = useState(new Audio('/notification-sound.mp3')); // Add your sound file

  useEffect(() => {
    if (currentMessage?.content || assignedRoom) {
      // Play notification sound
      notificationSound.play().catch(e => console.error("Audio playback failed:", e));
      
      // Show notification
      setIsVisible(true);
      setIsSlidingOut(false);
      
      // Start timer to slide out after 10 seconds
      const timer = setTimeout(() => {
        handleClose();
      }, 10000); // 10 seconds

      return () => clearTimeout(timer);
    }
  }, [currentMessage, assignedRoom, notificationSound]);

  const handleClose = () => {
    setIsSlidingOut(true);
    // After slide-out animation completes, hide completely
    setTimeout(() => {
      setIsVisible(false);
    }, 500); // Match this with your CSS transition duration
  };

  if (!isVisible) return null;

  return (
    <div className={`message-notification ${isSlidingOut ? 'slide-out' : ''}`}>
      <div className="message-content">
        {currentMessage ? (
          <>
            <div className="notification-header">
              <h3>Doctor's Message</h3>
              <button className="close-btn" onClick={handleClose} aria-label="Close notification">
                &times;
              </button>
            </div>
            <p className="message-text">{currentMessage.content}</p>
            {assignedRoom && (
              <p className="room-assignment">
                <strong>Your consultation room:</strong> {assignedRoom}
              </p>
            )}
            <small className="timestamp">
              {new Date(currentMessage.timestamp).toLocaleTimeString()}
            </small>
          </>
        ) : (
          <p className="waiting-message">Waiting for doctor's instructions...</p>
        )}
      </div>
    </div>
  );
};

export default MessageNotification;