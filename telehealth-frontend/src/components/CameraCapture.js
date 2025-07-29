import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";

const CameraCapture = () => {
  const webcamRef = useRef(null);
  const [image, setImage] = useState(null);
  const [captureType, setCaptureType] = useState(null);
  const [cameraDeviceId, setCameraDeviceId] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [isRoomIdEntered, setIsRoomIdEntered] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setCameraDeviceId(videoDevices[0]?.deviceId || null);
      })
      .catch((error) => console.error("Error detecting cameras:", error));
  }, []);

  const captureImage = (type) => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      setImage(imageSrc);
      setCaptureType(type);
      sendImageToBackend(imageSrc, type);
    }
  };

  const sendImageToBackend = async (imageSrc, type) => {
    setIsUploading(true);
    try {
      const blob = await fetch(imageSrc).then((res) => res.blob());

      const formData = new FormData();
      formData.append("image", blob, `${type}.jpg`);
      formData.append("type", type);
      formData.append("roomId", roomId);

      // Use environment variable for base URL
      const baseUrl = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000"; //backend URL
      const response = await fetch(`${baseUrl}/api/upload/`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      alert(`Successfully captured ${type}: ${data.data.formatted_value}`);
    } catch (error) {
      console.error("Error uploading image:", error);
      alert(`Failed to upload image: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRoomIdInput = (e) => setRoomId(e.target.value);

  const handleRoomIdSubmit = () => {
    if (roomId.trim()) {
      setIsRoomIdEntered(true);
    } else {
      alert("Please enter a valid Room ID");
    }
  };

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h2>Capture Data</h2>

      {!isRoomIdEntered ? (
        <div>
          <input
            type="text"
            placeholder="Enter Room ID"
            value={roomId}
            onChange={handleRoomIdInput}
            style={{ padding: "10px", marginBottom: "20px" }}
          />
          <button onClick={handleRoomIdSubmit} style={{ padding: "10px" }}>
            Submit Room ID
          </button>
        </div>
      ) : (
        <div>
          {cameraDeviceId ? (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              width={400}
              height={300}
              videoConstraints={{ deviceId: cameraDeviceId }}
            />
          ) : (
            <p>No camera detected</p>
          )}

          <div style={{ marginTop: "20px" }}>
            <button
              onClick={() => captureImage("temperature")}
              style={{ margin: "10px", padding: "10px" }}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Capture Temperature"}
            </button>
            <button
              onClick={() => captureImage("weight")}
              style={{ margin: "10px", padding: "10px" }}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Capture Weight"}
            </button>
            <button
              onClick={() => captureImage("blood_pressure")}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Capture Blood Pressure"}
            </button>
            <button
              onClick={() => captureImage("glucose")}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Capture Glucose"}
            </button>
            <button
              onClick={() => captureImage("endoscope")}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Capture Endoscope"}
            </button>
          </div>

          {image && (
            <div>
              <h3>Captured {captureType}</h3>
              <img
                src={image}
                alt="Captured"
                style={{ width: "300px", marginTop: "10px" }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CameraCapture;
