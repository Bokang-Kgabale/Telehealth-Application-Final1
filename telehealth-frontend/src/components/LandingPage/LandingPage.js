import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './styles.css';

function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const contentBox = document.querySelector('.content-box');
    if (contentBox) {
      contentBox.style.opacity = 0;
      setTimeout(() => {
        contentBox.style.opacity = 1;
        contentBox.style.transition = 'opacity 0.8s ease-in-out';
      }, 200);
    }

    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
      const handleRipple = (e) => {
        const x = e.clientX - button.getBoundingClientRect().left;
        const y = e.clientY - button.getBoundingClientRect().top;

        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        button.appendChild(ripple);
        setTimeout(() => {
          ripple.remove();
        }, 600);
      };

      button.addEventListener('mousedown', handleRipple);
      return () => {
        button.removeEventListener('mousedown', handleRipple);
      };
    });
  }, []);

  return (
    <div>
      <header className="header">
        <h1>Medical Data Capture System</h1>
      </header>

      <div className="container">
        <div className="content-box">
          <h2>Welcome to Telehealth Platform</h2>

          <svg className="camera-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#2c3e50" d="M12,10.8a2,2,0,1,0,2,2A2,2,0,0,0,12,10.8Zm7-3.8H15.7L13.86,4.86A1.94,1.94,0,0,0,12.48,4H11.52a1.94,1.94,0,0,0-1.38.86L8.3,7H5a2,2,0,0,0-2,2v9a2,2,0,0,0,2,2H19a2,2,0,0,0,2-2V9A2,2,0,0,0,19,7Zm-7,9a4,4,0,1,1,4-4A4,4,0,0,1,12,16Z" />
          </svg>

          <div className="button-container">
            <button 
              className="btn btn-primary doctor" 
              onClick={() => navigate('/login', { state: { role: 'doctor' } })}
            >
              Doctor Dashboard
            </button>

            <button 
              className="btn btn-secondary patient" 
              onClick={() => navigate('/patient-login', { state: { role: 'patient' } })}
            >
              Patient View
            </button>
          </div>

          <div className="wave"></div>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;