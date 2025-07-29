import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebase";
import { useLocation, useNavigate } from "react-router-dom";
import "./Auth.css";

// Enhanced secure logging utility
const secureLog = {
  loginAttempt: (email) => {
    if (process.env.NODE_ENV !== 'production') {
      console.groupCollapsed(`Login attempt with email (truncated)`);
      console.log(`Email: ${email.substring(0, 3)}...@...${email.split('@')[1]}`);
      console.groupEnd();
    }
  },
  
  loginSuccess: (user) => {
    if (process.env.NODE_ENV !== 'production') {
      console.groupCollapsed('Login successful (secured details)');
      console.log('User ID:', `${user.uid.substring(0, 3)}...${user.uid.substring(user.uid.length - 3)}`);
      console.log('Email verified:', user.emailVerified);
      console.log('Provider:', user.providerId);
      console.groupEnd();
    }
  },
  
  loginError: (error) => {
    if (process.env.NODE_ENV !== 'production') {
      console.groupCollapsed('Login error (secured)');
      console.log('Error code:', error.code);
      console.log('Message:', error.message.replace("Firebase: ", ""));
      console.groupEnd();
    }
  }
};

function LoginPage({ setIsAuthenticated }) {
  const [credentials, setCredentials] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const role = location.state?.role || "doctor";

  const handleChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      secureLog.loginAttempt(credentials.email);
      
      const userCredential = await signInWithEmailAndPassword(
        auth,
        credentials.email,
        credentials.password
      );

      secureLog.loginSuccess(userCredential.user);

      setIsAuthenticated(true);
      navigate(role === "doctor" ? "/doctor" : "/patient");
      
    } catch (err) {
      secureLog.loginError(err);
      
      let errorMessage = "Login failed. Please try again.";
      
      switch (err.code) {
        case "auth/invalid-email":
          errorMessage = "Invalid email address";
          break;
        case "auth/user-disabled":
          errorMessage = "Account disabled";
          break;
        case "auth/user-not-found":
          errorMessage = "No account found with this email";
          break;
        case "auth/wrong-password":
          errorMessage = "Incorrect password";
          break;
        case "auth/too-many-requests":
          errorMessage = "Too many attempts. Try again later";
          break;
        default:
          errorMessage = err.message.replace("Firebase: ", "");
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <header className="auth-header">
        <h1>Medical Data Capture System</h1>
        <h2>Welcome to Telehealth Platform</h2>
      </header>

      <div className="auth-form-container">
        <h3>Login as {role}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={credentials.email}
              onChange={handleChange}
              required
              placeholder="Enter your professional email"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={credentials.password}
              onChange={handleChange}
              required
              minLength="6"
              placeholder="At least 6 characters"
            />
          </div>
          
          {error && (
            <div className="error-message">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="auth-button"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Authenticating...
              </>
            ) : "Login"}
          </button>
        </form>

        <div className="auth-links">
          <a href="/forgot-password">Forgot password?</a>
          <a href="/contact">Contact support</a>
          {role === "doctor" && (
            <a href="/register-doctor">Register account</a>
          )}
        </div>
      </div>
    </div>
  );
}

export default LoginPage;