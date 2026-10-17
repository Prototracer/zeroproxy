import { faceapi, areModelsLoaded } from './loadModels.js'

// ─── Detector Options ────────────────────────────────────────────────────────
// inputSize: 320x320 is the sweet spot for mobile real-time inference (fast & low CPU).
// scoreThreshold: 0.5 ignores any detections where confidence is below 50%.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
})

/**
 * Extracts a 128-dimensional biometric descriptor from an active video element.
 * 
 * Handbook Rule (Section 10 Step 1):
 * Must return Float32Array(128) if exactly one face is detected.
 * Must return null if no face is found OR if more than one face is present.
 * 
 * @param {HTMLVideoElement} videoEl - The live video DOM element
 * @returns {Promise<Float32Array|null>} 128-d vector or null
 */
export async function getDescriptor(videoEl) {
  // Guard 1: Verify models are loaded in memory
  if (!areModelsLoaded()) {
    console.warn('getDescriptor called before models are loaded')
    return null
  }

  // Guard 2: Verify video element exists and has received at least one valid frame
  // readyState >= 2 means HAVE_CURRENT_DATA (frame buffer is ready for analysis)
  if (!videoEl || videoEl.readyState < 2) {
    return null
  }

  try {
    // Detect all faces in current video frame to enforce the single-face rule
    const allDetections = await faceapi
      .detectAllFaces(videoEl, DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptors()

    // Enforce strict attendance security:
    // If 0 faces -> student not in frame
    // If 2+ faces -> potential proxy attempt or multiple people
    if (!allDetections || allDetections.length !== 1) {
      return null
    }

    // Return a plain 128-number array (JSON & Pydantic friendly)
    return Array.from(allDetections[0].descriptor)
  } catch (err) {
    console.error('Error during descriptor extraction:', err)
    return null
  }
}

/**
 * Computes standard Euclidean distance between two 128-d face descriptors.
 * Matching decision logic (Ashrith / BE2):
 * Distance < threshold (typically ~0.5 to 0.6) = SAME person.
 * Distance >= threshold = DIFFERENT person.
 * 
 * @param {Float32Array|number[]} desc1 
 * @param {Float32Array|number[]} desc2 
 * @returns {number|null} Euclidean distance or null if invalid inputs
 */
export function euclideanDistance(desc1, desc2) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    return null
  }
  let sum = 0
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}
