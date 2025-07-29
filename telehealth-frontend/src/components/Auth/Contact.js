import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Auth.css';

const Contact = () => {
  const navigate = useNavigate();

  return (
    <div className="auth-container">
      <header className="auth-header">
        <h1>Medical Data Capture System</h1>
        <h2>Welcome to Telehealth Platform</h2>
      </header>

      <div className="auth-form-container contact-container">
        <h3>Contact Support</h3>
        
        <div className="contact-methods">
          <div className="contact-method">
            <h4>Email Support</h4>
            <p>For technical issues or account assistance:</p>
            <a href="mailto:support@telehealthplatform.com" className="contact-link">
              support@telehealthplatform.com
            </a>
          </div>

          <div className="contact-method">
            <h4>Phone Support</h4>
            <p>Available Monday-Friday, 9am-5pm EST:</p>
            <a href="tel:+18005551234" className="contact-link">
              +1 (800) 555-1234
            </a>
          </div>

          <div className="contact-method">
            <h4>Emergency Support</h4>
            <p>For urgent medical issues:</p>
            <a href="tel:+18005554321" className="contact-link emergency">
              +1 (800) 555-4321
            </a>
          </div>
        </div>

        <button 
          onClick={() => navigate(-1)} 
          className="auth-button back-button"
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default Contact;