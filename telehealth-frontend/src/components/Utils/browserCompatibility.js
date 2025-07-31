/**
 * Comprehensive browser compatibility checker for WebRTC/Firebase applications
 * Returns detailed compatibility information and suggestions
 */
export function checkBrowserCompatibility() {
  const userAgent = navigator.userAgent;
  const isChrome = /Chrome/.test(userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdge = /Edg/.test(userAgent);
  const isFirefox = /Firefox/.test(userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const isOpera = /OPR/.test(userAgent);
  const isBrave = navigator.brave !== undefined;
  const isIE = /Trident/.test(userAgent);
  
  // Check for tracking protection features
  const hasStrictTrackingProtection = 
    (isFirefox && navigator.doNotTrack === '1') ||
    (isSafari && navigator.webkitTrackingPreventionEnabled) ||
    (isBrave);

  // Check for WebRTC support
  const hasWebRTC = !!(
    window.RTCPeerConnection ||
    window.webkitRTCPeerConnection ||
    window.mozRTCPeerConnection
  );

  // Check for Firebase storage access
  const hasIndexedDB = 'indexedDB' in window;
  const hasLocalStorage = 'localStorage' in window;

  // Determine compatibility level
  let compatibility = {
    browser: {
      name: isChrome ? 'Chrome' : 
            isEdge ? 'Edge' : 
            isFirefox ? 'Firefox' : 
            isSafari ? 'Safari' : 
            isOpera ? 'Opera' : 
            isBrave ? 'Brave' : 
            isIE ? 'Internet Explorer' : 'Unknown',
      version: userAgent.match(/(?:Chrome|Firefox|Safari|Opera|Edge|Brave|MSIE|rv:)[\/\s](\d+)/)?.[1] || 'unknown',
      isMobile: /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)
    },
    features: {
      webRTC: hasWebRTC,
      indexedDB: hasIndexedDB,
      localStorage: hasLocalStorage,
      trackingProtection: hasStrictTrackingProtection
    },
    compatible: true,
    level: 'optimal', // optimal, partial, problematic
    message: '',
    actions: []
  };

  // Compatibility logic
  if (isIE) {
    compatibility.compatible = false;
    compatibility.level = 'problematic';
    compatibility.message = 'Internet Explorer is not supported. Please use a modern browser.';
    compatibility.actions = ['Use Chrome, Edge, or Firefox'];
  } 
  else if (!hasWebRTC) {
    compatibility.compatible = false;
    compatibility.level = 'problematic';
    compatibility.message = 'WebRTC is not supported in your browser.';
    compatibility.actions = ['Update your browser', 'Enable WebRTC in settings'];
  }
  else if (hasStrictTrackingProtection) {
    compatibility.compatible = 'partial';
    compatibility.level = 'partial';
    compatibility.message = 'Your browser may block required features due to strict privacy settings.';
    
    if (isSafari) {
      compatibility.actions = [
        'Go to Safari > Preferences > Privacy',
        'Disable "Prevent cross-site tracking" for this site',
        'Enable cookies for this domain'
      ];
    } else if (isFirefox) {
      compatibility.actions = [
        'Click the shield icon in the address bar',
        'Select "Disable Tracking Protection for This Site"'
      ];
    } else if (isBrave) {
      compatibility.actions = [
        'Go to brave://settings/shields',
        'Set "Trackers & ads blocking" to "Disabled" for this site'
      ];
    }
  }
  else if (!hasIndexedDB || !hasLocalStorage) {
    compatibility.compatible = 'partial';
    compatibility.level = 'partial';
    compatibility.message = 'Some features may be limited due to storage restrictions.';
    compatibility.actions = ['Enable cookies and site data'];
  }
  else {
    compatibility.message = 'Your browser is fully compatible with all features.';
  }

  // Additional mobile-specific checks
  if (compatibility.browser.isMobile) {
    compatibility.actions.push(
      'For best results on mobile, use Chrome or Firefox',
      'Ensure you have a stable internet connection'
    );
    
    if (/iPhone|iPad|iPod/.test(userAgent)) {
      compatibility.actions.push(
        'iOS may require you to explicitly allow camera/microphone access'
      );
    }
  }

  return compatibility;
}

// Helper function to display compatibility info
export function displayCompatibilityInfo(containerId = 'compatibility-warning') {
  const compat = checkBrowserCompatibility();
  const container = document.getElementById(containerId) || createWarningContainer();
  
  if (compat.compatible === true) return;

  let html = `
    <div class="browser-warning ${compat.level}">
      <h3>Browser Compatibility Notice</h3>
      <p><strong>${compat.browser.name} ${compat.browser.version}</strong> - ${compat.message}</p>
      ${compat.actions.length ? `
        <ul>
          ${compat.actions.map(action => `<li>${action}</li>`).join('')}
        </ul>
      ` : ''}
      <p>Supported browsers: Chrome, Edge, Firefox, Safari (with adjusted privacy settings)</p>
    </div>
  `;

  container.innerHTML = html;
  container.style.display = 'block';

  function createWarningContainer() {
    const div = document.createElement('div');
    div.id = containerId;
    div.style.position = 'fixed';
    div.style.bottom = '0';
    div.style.left = '0';
    div.style.right = '0';
    div.style.padding = '15px';
    div.style.backgroundColor = '#fff3cd';
    div.style.borderTop = '1px solid #ffeeba';
    div.style.zIndex = '1000';
    document.body.appendChild(div);
    return div;
  }
}