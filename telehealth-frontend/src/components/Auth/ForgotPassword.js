import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Auth.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Simple validation
    if (!email) {
      setMessage('Please enter your email address');
      return;
    }

    // Mock password reset request
    setMessage(`Password reset link sent to ${email}`);
    setIsSubmitted(true);
    
    // In a real app, you would call your backend API here
    // axios.post('/api/forgot-password', { email })
    //   .then(response => {
    //     setMessage(response.data.message);
    //     setIsSubmitted(true);
    //   })
    //   .catch(error => {
    //     setMessage(error.response?.data?.message || 'Error sending reset link');
    //   });
  };

  return (
    <div className="auth-container">
      <header className="auth-header">
        <h1>Medical Data Capture System</h1>
        <h2>Welcome to Telehealth Platform</h2>
      </header>

      <div className="auth-form-container">
        {!isSubmitted ? (
          <>
            <h3>Reset Your Password</h3>
            <p>Enter your email and we'll send you a link to reset your password.</p>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {message && <div className="error-message">{message}</div>}
              <button type="submit" className="auth-button">
                Send Reset Link
              </button>
            </form>
          </>
        ) : (
          <>
            <h3>Check Your Email</h3>
            <div className="success-message">{message}</div>
            <button 
              onClick={() => navigate('/login')} 
              className="auth-button"
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;