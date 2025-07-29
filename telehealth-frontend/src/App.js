import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage/LandingPage';
import LoginPage from './components/Auth/Login';
import DoctorRegister from './components/Auth/DoctorRegister';
import DebugInfoPage from './components/Debug/DebugInfoPage';
import ForgotPassword from './components/Auth/ForgotPassword';
import Contact from './components/Auth/Contact';
import PatientDashboard from './components/Patient/PatientDashboard';
import DoctorDashboard from './components/Doctor/DoctorDashboard';
import PatientLogin from './components/Auth/PatientLogin'; // Add this import
import { useState } from 'react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <Router basename={process.env.PUBLIC_URL}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route 
          path="/login" 
          element={<LoginPage setIsAuthenticated={setIsAuthenticated} />} 
        />
        <Route 
          path="/patient-login" 
          element={<PatientLogin />} 
        />
        <Route 
          path="/register-doctor" 
          element={<DoctorRegister setIsAuthenticated={setIsAuthenticated} />} 
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/contact" element={<Contact />} />
        <Route 
          path="/patient" 
          element={
            // No authentication required for patient route
            <PatientDashboard /> 
          } 
        />
        <Route 
          path="/debug" 
          element={<DebugInfoPage />} 
        />
        <Route 
          path="/doctor" 
          element={
            isAuthenticated ? 
              <DoctorDashboard /> : 
              <Navigate to="/login" state={{ from: '/doctor' }} />
          } 
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;