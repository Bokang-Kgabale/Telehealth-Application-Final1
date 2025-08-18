# Telehealth Application with Video Conferencing and Medical Data Capture

## Project Overview
This Telehealth Application enables remote medical consultations with integrated video conferencing and automated medical data capture. Patients can capture vital signs such as temperature and weight using their webcam, which are processed via OCR and stored for doctors to review. The application consists of a React frontend, a Django backend API, and a FastAPI-based video conferencing server.

## Features
- **Patient Dashboard**: Capture temperature, weight, endoscope, glucose and blood pressure using webcam images, with multi-camera support and automatic OCR processing.
- **Doctor Dashboard**: View live video stream of telehealth sessions and search patient vitals data by Room ID. Download the Patient's Vitals in PDF format.
- **Video Conferencing**: Real-time video communication embedded within the app.
- **Backend API**: Handles image uploads, OCR processing with Google Cloud Vision, data storage in Firebase Realtime Database, and data retrieval.
- **Room-based sessions**: Data and video sessions are organized by unique Room IDs.

## Tech Stack
- Frontend: React, React Router, Webcam.js
- Backend: Django, Firebase Admin SDK, Google Cloud Vision API
- Video Server: FastAPI, Uvicorn, WebRTC & Firebase
- Database: Firebase Realtime Database & Cloud Firestore
- OCR: Google Cloud Vision API

## Setup and Installation

### Prerequisites
- Node.js and npm
- Python 3.8+
- Firebase project with Realtime Database & Firestore enabled
- Google Cloud account with Vision API enabled and credentials JSON
- Metered's TURN Servers
- Environment variables for Firebase and Google Vision credentials

### Frontend Setup
1. Navigate to the `telehealth-frontend` directory:
   ```bash
   cd telehealth-frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm start
   ```
4. The app will be available at `http://localhost:3000`.

### Backend Setup
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set environment variables:
   - `FIREBASE_CREDENTIALS_JSON`: JSON string of Firebase service account credentials.
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON`: JSON string of Google Vision API credentials.
4. Run the Django server:
   ```bash
   python manage.py runserver
   ```
5. The backend API will be available at `http://localhost:8000`.

### Video Conferencing Server Setup
1. Navigate to the `video-conferencing-app` directory:
   ```bash
   cd video-conferencing-app
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the FastAPI video server:
   ```bash
   python video_server.py
   ```
4. The video server will be available at `http://localhost:8001`.

### CI/CD Pipeline for Firebase or Code Updates
1. Navigate to the `telehealth-frontend` directory:
   ```bash
   cd telehealth-frontend
   ```
2. Delete build folder:
   ```bash
   rm -rf build/
   ```
3. After code updates, rebuild and navigate back:
   ```bash
   npm run build && cd .. 
   ```
4. Redeploy the firebase to update the hosting:
    ```bash
   firebase deploy --only hosting --debug 
   ```
   

## Usage

### Patient
- Access the Patient Dashboard.
- Enter the queue using the system's patient ID.
- Capture patient vitals using the webcam.
- The captured data is uploaded and processed automatically.
- Join the video conferencing session embedded in the dashboard.

### Doctor
- Access the Doctor Dashboard.
- Register a new account or login.
- Start the live video stream.
- Select Send Room ID to automatically enable the video call functionality between Doctor and Patient.
- Search for patient data by entering the Room ID.
- View the patient's vitals data retrieved from the backend.
- Download a PDF format of the current Patient's captured vitals, along with the pictures taken.
- Select the geo-location to see other Patients from different locations.

## Environment Variables
- `FIREBASE_CREDENTIALS_JSON`: Firebase service account JSON string.
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Google Vision API credentials JSON string.

## Contributing
Contributions are not allowed.
