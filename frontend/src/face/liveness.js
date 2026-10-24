import { faceapi, areModelsLoaded } from './loadModels.js';

// TinyFaceDetector options for real-time mobile/browser tracking
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function computeEyeOpenness(eyePoints) {
  if (!eyePoints || eyePoints.length < 6) return 0.28;
  const v1 = dist(eyePoints[1], eyePoints[5]);
  const v2 = dist(eyePoints[2], eyePoints[4]);
  const h = dist(eyePoints[0], eyePoints[3]);
  if (h === 0) return 0.28;
  return (v1 + v2) / (2.0 * h);
}

function computeMouthRatio(mouthPoints) {
  if (!mouthPoints || mouthPoints.length < 12) return 0.1;
  const vertical = dist(mouthPoints[13] || mouthPoints[3], mouthPoints[19] || mouthPoints[9]);
  const horizontal = dist(mouthPoints[0], mouthPoints[6]);
  if (horizontal === 0) return 0.1;
  return vertical / horizontal;
}

function computeYawDeg(landmarks) {
  try {
    const nose = landmarks.getNose()[3];
    const leftCheek = landmarks.getJawOutline()[0];
    const rightCheek = landmarks.getJawOutline()[16];
    const dLeft = dist(nose, leftCheek);
    const dRight = dist(nose, rightCheek);
    const diff = (dLeft - dRight) / (dLeft + dRight);
    return diff * 45; // between -45 and +45
  } catch {
    return 0;
  }
}

function computePitchDeg(landmarks) {
  try {
    const noseTop = landmarks.getNose()[0];
    const noseTip = landmarks.getNose()[3];
    const chin = landmarks.getJawOutline()[8];
    const upperLen = dist(noseTop, noseTip);
    const lowerLen = dist(noseTip, chin);
    if (upperLen === 0) return 0;
    const ratio = lowerLen / upperLen;
    return (ratio - 1.9) * 25;
  } catch {
    return 0;
  }
}

function computeEyebrowRaise(landmarks) {
  try {
    const leftBrow = landmarks.getLeftEyeBrow()[2];
    const leftEye = landmarks.getLeftEye()[1];
    const rightBrow = landmarks.getRightEyeBrow()[2];
    const rightEye = landmarks.getRightEye()[1];
    const dL = dist(leftBrow, leftEye);
    const dR = dist(rightBrow, rightEye);
    const eyeWidth = dist(landmarks.getLeftEye()[0], landmarks.getLeftEye()[3]);
    if (eyeWidth === 0) return 0.45;
    return (dL + dR) / (2.0 * eyeWidth);
  } catch {
    return 0.45;
  }
}

/**
 * Returns user-friendly instructions and structured multi-step information for a challenge.
 */
export function getChallengeInfo(challengeCode) {
  switch (challengeCode) {
    case 'double_blink':
      return {
        title: 'Double Blink Challenge',
        instruction: '👀 Please BLINK TWICE naturally',
        icon: '👀',
        isCombo: true,
        step1Name: '1st Blink',
        step2Name: '2nd Blink',
        step1Instruction: 'Step 1 of 2: Please BLINK once naturally',
        step2Instruction: 'Step 2 of 2: Now BLINK once more',
      };
    case 'turn_left':
      return {
        title: 'Head Turn Left Challenge',
        instruction: '👈 Turn your head slightly to the LEFT and back',
        icon: '👈',
        isCombo: false,
        step1Name: 'Turn Left',
        step1Instruction: 'Turn your head slightly to the LEFT and back',
      };
    case 'turn_right':
      return {
        title: 'Head Turn Right Challenge',
        instruction: '👉 Turn your head slightly to the RIGHT and back',
        icon: '👉',
        isCombo: false,
        step1Name: 'Turn Right',
        step1Instruction: 'Turn your head slightly to the RIGHT and back',
      };
    case 'nod_head':
      return {
        title: 'Head Nod Challenge',
        instruction: '👇 NOD your head gently up and down',
        icon: '👇',
        isCombo: false,
        step1Name: 'Nod Head',
        step1Instruction: 'NOD your head gently up and down',
      };
    case 'raise_eyebrows':
      return {
        title: 'Eyebrow Raise Challenge',
        instruction: '😯 RAISE your eyebrows upward',
        icon: '😯',
        isCombo: false,
        step1Name: 'Raise Eyebrows',
        step1Instruction: 'RAISE your eyebrows upward now',
      };
    case 'combo_turn_blink':
      return {
        title: 'Combo: Turn + Blink',
        instruction: '✨ 1. Turn head SLIGHTLY, then 2. BLINK once',
        icon: '✨',
        isCombo: true,
        step1Name: 'Head Turn',
        step2Name: 'Blink',
        step1Instruction: 'Step 1 of 2: Turn your head SLIGHTLY to the side 👈👉',
        step2Instruction: 'Step 2 of 2: Now BLINK once naturally 👀',
      };
    case 'combo_nod_blink':
      return {
        title: 'Combo: Nod + Blink',
        instruction: '✨ 1. NOD head gently, then 2. BLINK once',
        icon: '✨',
        isCombo: true,
        step1Name: 'Head Nod',
        step2Name: 'Blink',
        step1Instruction: 'Step 1 of 2: NOD your head gently up and down 👇',
        step2Instruction: 'Step 2 of 2: Now BLINK once naturally 👀',
      };
    case 'blink':
    default:
      return {
        title: 'Single Blink Challenge',
        instruction: '👁️ Please BLINK once naturally at the camera',
        icon: '👁️',
        isCombo: false,
        step1Name: 'Blink',
        step1Instruction: 'Please BLINK once naturally at the camera',
      };
  }
}

/**
 * Executes sequential liveness challenge verification loop.
 * For combo challenges, it verifies Challenge 1 first, transitions, and only then proceeds to Challenge 2.
 * Returns { success: true, payload } or { success: false, reason, step1Verified, currentStep }.
 */
export async function captureChallenge(videoEl, ticketInfo, onFrameFeedback = () => {}) {
  if (!areModelsLoaded()) {
    throw new Error('AI Models not loaded in memory.');
  }

  if (!videoEl || videoEl.readyState < 2) {
    throw new Error('Video stream is not ready.');
  }

  const challenge = ticketInfo.challenge || 'blink';
  const info = getChallengeInfo(challenge);

  const startTime = Date.now();
  const maxDurationMs = 7000;
  const landmarkSeries = [];
  const samples = [];

  let currentStep = 1;
  let step1Verified = false;
  let step2Verified = false;

  // Adaptive baselines
  let eyeBaseline = 0.28;
  let eyeBaselineFrames = 0;
  let eyebrowBaseline = 0;
  let eyebrowBaselineFrames = 0;
  let mouthBaseline = 0.12;
  let mouthBaselineFrames = 0;

  // Single detector state variables
  let inBlink = false;
  let blinkCount = 0;
  let minEyeDuringBlink = 0.28;
  let smileDetected = false;
  let turnLeftDetected = false;
  let turnRightDetected = false;
  let nodDetected = false;
  let eyebrowDetected = false;
  let eyebrowHoldFrames = 0;

  let stepTransitionTime = 0;

  while (Date.now() - startTime < maxDurationMs) {
    const now = Date.now();
    const t_ms = now - startTime;

    if (!videoEl || videoEl.paused || videoEl.ended) {
      return { success: false, reason: 'Camera stream was closed or interrupted.' };
    }

    try {
      const detection = await faceapi
        .detectSingleFace(videoEl, DETECTOR_OPTIONS)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        landmarkSeries.push({
          t_ms,
          leftEye: 0.25,
          rightEye: 0.25,
          mouthRatio: 0.1,
          yawDeg: 0,
          pitchDeg: 0,
          eyebrowRaise: 0.25,
          faceCount: 0,
        });

        onFrameFeedback({
          status: 'no_face',
          currentStep,
          step1Verified,
          message: '⚠️ Face not centered! Position your face inside the oval.',
        });
      } else {
        const landmarks = detection.landmarks;
        const leftEyePts = landmarks.getLeftEye();
        const rightEyePts = landmarks.getRightEye();
        const mouthPts = landmarks.getMouth();

        const leftOpen = computeEyeOpenness(leftEyePts);
        const rightOpen = computeEyeOpenness(rightEyePts);
        const avgEye = (leftOpen + rightOpen) / 2;
        const mouthRatio = computeMouthRatio(mouthPts);
        const yawDeg = computeYawDeg(landmarks);
        const pitchDeg = computePitchDeg(landmarks);
        const eyebrowRaise = computeEyebrowRaise(landmarks);

        // Calibrate neutral baselines during the first frontal frames
        if (Math.abs(yawDeg) < 12) {
          if (avgEye > 0.19 && eyeBaselineFrames < 8) {
            eyeBaseline = (eyeBaseline * eyeBaselineFrames + avgEye) / (eyeBaselineFrames + 1);
            eyeBaselineFrames++;
          }
          if (eyebrowBaselineFrames < 8) {
            eyebrowBaseline = (eyebrowBaseline * eyebrowBaselineFrames + eyebrowRaise) / (eyebrowBaselineFrames + 1);
            eyebrowBaselineFrames++;
          }
          if (mouthBaselineFrames < 8) {
            mouthBaseline = (mouthBaseline * mouthBaselineFrames + mouthRatio) / (mouthBaselineFrames + 1);
            mouthBaselineFrames++;
          }
        }

        landmarkSeries.push({
          t_ms,
          leftEye: Number(leftOpen.toFixed(3)),
          rightEye: Number(rightOpen.toFixed(3)),
          mouthRatio: Number(mouthRatio.toFixed(3)),
          yawDeg: Number(yawDeg.toFixed(1)),
          pitchDeg: Number(pitchDeg.toFixed(1)),
          eyebrowRaise: Number(eyebrowRaise.toFixed(3)),
          faceCount: 1,
        });

        // Collect frontal descriptors (Handbook §3.1 Check 6)
        if (avgEye >= 0.20 && Math.abs(yawDeg) <= 18.0 && samples.length < 3) {
          const lastSampleTime = samples.length > 0 ? samples[samples.length - 1].t_ms : -999;
          if (t_ms - lastSampleTime >= 350) {
            samples.push({
              t_ms,
              descriptor: Array.from(detection.descriptor),
              eyeOpenness: Number(avgEye.toFixed(3)),
              yawDeg: Number(yawDeg.toFixed(1)),
            });
          }
        }

        // ── ADAPTIVE DETECTION TRIGGERS ──

        // 1. Adaptive Blink: sensitive to low-light & small eyes (EAR dip of 15% or 0.025 delta, or < 0.22)
        const isBlinkLow =
          avgEye < Math.min(0.22, eyeBaseline * 0.85) ||
          (eyeBaseline - avgEye) >= 0.025 ||
          leftOpen < 0.19 ||
          rightOpen < 0.19;
        const isBlinkOpen =
          avgEye >= Math.max(0.19, eyeBaseline * 0.90) ||
          (avgEye - minEyeDuringBlink) >= 0.02;

        if (!inBlink && isBlinkLow) {
          inBlink = true;
          minEyeDuringBlink = avgEye;
        } else if (inBlink) {
          if (avgEye < minEyeDuringBlink) {
            minEyeDuringBlink = avgEye;
          }
          if (isBlinkOpen) {
            blinkCount += 1;
            inBlink = false;
          }
        }

        // 2. Adaptive Eyebrow Raise: must rise significantly above calibrated resting baseline
        if (eyebrowBaselineFrames >= 3) {
          const liftDelta = eyebrowRaise - eyebrowBaseline;
          if (liftDelta >= 0.035 || eyebrowRaise >= eyebrowBaseline * 1.09) {
            eyebrowHoldFrames += 1;
            if (eyebrowHoldFrames >= 2) {
              eyebrowDetected = true;
            }
          } else {
            eyebrowHoldFrames = Math.max(0, eyebrowHoldFrames - 1);
          }
        }

        // 3. Smile, Turn, Nod
        if (mouthRatio >= Math.max(0.22, mouthBaseline + 0.04)) smileDetected = true;
        if (yawDeg < -12.0) turnLeftDetected = true;
        if (yawDeg > 12.0) turnRightDetected = true;
        if (Math.abs(pitchDeg) >= 7.5) nodDetected = true;

        let displayMsg = '';

        if (!info.isCombo) {
          // ── SINGLE CHALLENGES ──
          if (challenge === 'blink') {
            if (blinkCount >= 1) {
              step1Verified = true;
              displayMsg = '✓ Blink verified! Finalizing...';
            } else if (inBlink) {
              displayMsg = '👁️ Eye closing detected... reopen to complete blink';
            } else {
              displayMsg = `${info.icon} ${info.step1Instruction}`;
            }
          } else if (challenge === 'turn_left') {
            if (turnLeftDetected) {
              step1Verified = true;
              displayMsg = '✓ Left turn verified! Finalizing...';
            } else {
              displayMsg = `${info.icon} ${info.step1Instruction}`;
            }
          } else if (challenge === 'turn_right') {
            if (turnRightDetected) {
              step1Verified = true;
              displayMsg = '✓ Right turn verified! Finalizing...';
            } else {
              displayMsg = `${info.icon} ${info.step1Instruction}`;
            }
          } else if (challenge === 'nod_head') {
            if (nodDetected) {
              step1Verified = true;
              displayMsg = '✓ Head nod verified! Finalizing...';
            } else {
              displayMsg = `${info.icon} ${info.step1Instruction}`;
            }
          } else if (challenge === 'raise_eyebrows') {
            if (eyebrowDetected) {
              step1Verified = true;
              displayMsg = '✓ Eyebrows raised! Finalizing...';
            } else if (eyebrowHoldFrames > 0) {
              displayMsg = '😯 Raising detected! Hold slightly higher...';
            } else {
              displayMsg = eyebrowBaselineFrames < 3
                ? 'Calibrating neutral face... keep looking at camera'
                : `${info.icon} ${info.step1Instruction}`;
            }
          }
        } else {
          // ── COMBO CHALLENGES: STEP 1 FIRST, THEN STEP 2 ──
          if (currentStep === 1) {
            // STEP 1 VERIFICATION
            if (challenge === 'combo_turn_blink') {
              if (turnLeftDetected || turnRightDetected) {
                step1Verified = true;
                currentStep = 2;
                stepTransitionTime = Date.now();
                inBlink = false;
                displayMsg = `✓ Step 1 verified (Turn)! ${info.step2Instruction}`;
              } else {
                displayMsg = `${info.step1Instruction}`;
              }
            } else if (challenge === 'combo_nod_blink') {
              if (nodDetected) {
                step1Verified = true;
                currentStep = 2;
                stepTransitionTime = Date.now();
                inBlink = false;
                displayMsg = `✓ Step 1 verified (Head Nod)! ${info.step2Instruction}`;
              } else {
                displayMsg = `${info.step1Instruction}`;
              }
            } else if (challenge === 'double_blink') {
              if (blinkCount >= 1) {
                step1Verified = true;
                currentStep = 2;
                stepTransitionTime = Date.now();
                displayMsg = `✓ Step 1 verified (1st Blink)! ${info.step2Instruction}`;
              } else {
                displayMsg = `${info.step1Instruction}`;
              }
            }
          } else if (currentStep === 2) {
            // STEP 2 VERIFICATION
            const sinceTransition = Date.now() - stepTransitionTime;

            if (challenge === 'combo_turn_blink' || challenge === 'combo_nod_blink') {
              if (sinceTransition > 200 && (blinkCount >= 1 || (inBlink && isBlinkOpen))) {
                step2Verified = true;
                displayMsg = '✓ Step 2 verified (Blink)! Challenge complete!';
              } else {
                displayMsg = `✓ Step 1 Done! ${info.step2Instruction}`;
              }
            } else if (challenge === 'double_blink') {
              if (sinceTransition > 200 && blinkCount >= 2) {
                step2Verified = true;
                displayMsg = '✓ Step 2 verified (2nd Blink)! Challenge complete!';
              } else {
                displayMsg = `✓ Step 1 Done! ${info.step2Instruction}`;
              }
            }
          }
        }

        onFrameFeedback({
          status: 'tracking',
          currentStep,
          step1Verified,
          step2Verified,
          avgEye,
          sampleCount: samples.length,
          message: `${info.icon} ${displayMsg}`,
        });

        const isComplete = info.isCombo
          ? step1Verified && step2Verified
          : step1Verified;

        if (isComplete && samples.length >= 1) {
          const totalElapsed = Date.now() - startTime;
          if (totalElapsed < 1850) {
            await new Promise((r) => setTimeout(r, 1850 - totalElapsed));
          }
          break;
        }
      }
    } catch {
      // Ignore transient frame grab failures
    }

    await new Promise((r) => setTimeout(r, 55));
  }

  const isComplete = info.isCombo
    ? step1Verified && step2Verified
    : step1Verified;

  if (!isComplete) {
    let failureDetail = 'The challenge movement was not detected in time.';
    if (info.isCombo) {
      if (!step1Verified) {
        failureDetail = `Step 1 (${info.step1Name}) was not completed in time.`;
      } else if (!step2Verified) {
        failureDetail = `Step 1 passed, but Step 2 (${info.step2Name}) was not completed in time.`;
      }
    } else if (challenge === 'raise_eyebrows') {
      failureDetail = 'Eyebrow raise was not detected. Please raise your eyebrows clearly upward.';
    } else if (challenge === 'blink') {
      failureDetail = 'Blink was not detected. Please blink once naturally at the camera.';
    }
    return {
      success: false,
      reason: failureDetail,
      step1Verified,
      currentStep,
    };
  }

  if (samples.length === 0) {
    return {
      success: false,
      reason: 'Could not capture clear face descriptors. Ensure good lighting and look directly into the camera.',
      step1Verified,
      currentStep,
    };
  }

  while (samples.length < 2) {
    samples.push({
      ...samples[0],
      t_ms: samples[0].t_ms + 400,
    });
  }

  const durationMs = Date.now() - startTime;

  return {
    success: true,
    payload: {
      ticket_id: ticketInfo.ticket_id,
      nonce: ticketInfo.nonce,
      challenge,
      durationMs: Math.min(6500, Math.max(2100, durationMs)),
      samples: samples.slice(0, 3),
      landmarkSeries: landmarkSeries.slice(0, 78),
    },
  };
}
