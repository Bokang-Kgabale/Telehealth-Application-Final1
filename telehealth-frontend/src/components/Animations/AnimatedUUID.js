import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import './AnimatedUUID.css';

const AnimatedUUID = ({ prefix = 'CPT', onFinalize }) => {
  const [displayId, setDisplayId] = useState(`${prefix}-XXXXXX`);
  const [isAnimating, setIsAnimating] = useState(true);
  const animationRef = useRef(null);
  const finalId = useRef('');

  const stages = React.useMemo(() => [
    { interval: 150, length: 3 },  // Slightly slower interval
    { interval: 200, length: 5 },
    { interval: 250, length: 8 }
  ], []);

  const [currentStage, setCurrentStage] = useState(0);

  const generatePartialId = useCallback((length) => {
    return uuidv4()
      .replace(/-/g, '')
      .substring(0, length)
      .toUpperCase();
  }, []);

  const finalizeAnimation = useCallback(() => {
    clearInterval(animationRef.current);
    finalId.current = `${prefix}-${generatePartialId(8)}`;
    setDisplayId(finalId.current);
    setIsAnimating(false);
    onFinalize?.(finalId.current);
  }, [prefix, generatePartialId, onFinalize]);

  useEffect(() => {
    if (!isAnimating) return;

    let timeoutId;
    const animateId = () => {
      const { interval, length } = stages[currentStage];
      
      // Clear any previous interval immediately
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }

      animationRef.current = setInterval(() => {
        const partialId = generatePartialId(length);
        setDisplayId(`${prefix}-${partialId}`);
      }, interval);

      timeoutId = setTimeout(() => {
        clearInterval(animationRef.current);
        if (currentStage < stages.length - 1) {
          setCurrentStage(currentStage + 1);
        } else {
          finalizeAnimation();
        }
      }, 2000);
    };

    animateId();

    return () => {
      clearInterval(animationRef.current);
      clearTimeout(timeoutId);
    };
  }, [isAnimating, currentStage, stages, prefix, generatePartialId, finalizeAnimation]);

  return (
    <div className="uuid-animation-container">
      <div className="uuid-display" key={displayId}>
        {displayId}
      </div>
      {isAnimating && (
        <div className="animation-progress">
          <div className="progress-bar" />
        </div>
      )}
    </div>
  );
};

export default AnimatedUUID;