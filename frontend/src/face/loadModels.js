import * as faceapi from '@vladmandic/face-api/dist/face-api.esm.js';

// ─── Singleton State ─────────────────────────────────────────────────────────
// These two variables live at module scope, meaning they persist for the entire
// browser session. They are NOT reset on React re-renders.

let isLoaded = false      // true once all 3 models are in GPU/CPU memory
let loadingPromise = null // holds the in-flight Promise to prevent duplicate loads

// ─── Public Helper ────────────────────────────────────────────────────────────
// Lets any component check if models are ready without needing to await anything.
export function areModelsLoaded() {
  return isLoaded
}

// ─── Main Loader ──────────────────────────────────────────────────────────────
// onProgress(percent, message) - optional callback to update a loading UI
// modelPath - where the .bin and manifest files are served from (default: /models)
//
// Known trade-off: models are cached in JS memory only. A hard page refresh
// re-downloads them. Persistent caching via Service Worker is planned for Phase 3.
export async function loadModels(onProgress = () => {}, modelPath = '/models') {

  // Case 1: all models are already sitting in memory - return immediately
  if (isLoaded) {
    onProgress(100, 'Models already loaded')
    return true
  }

  // Case 2: another component already started loading - share that same Promise
  // instead of starting a second parallel download of 7 MB
  if (loadingPromise) {
    return loadingPromise
  }

  // Case 3: first call - kick off the sequential load
  loadingPromise = (async () => {
    try {

      // Step 1 of 3: TinyFaceDetector (193 KB)
      // Detects where in the video frame a face is located (bounding box).
      // "Tiny" means it is optimized for speed on mobile, not accuracy.
      onProgress(10, 'Loading face detector...')
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath)

      // Step 2 of 3: FaceLandmark68Net (356 KB)
      // Maps 68 anatomical points on the face: eyebrows, eyes, nose, mouth, jaw.
      // We use the eye-corner points (indices 36-47) to compute eye openness for blink detection.
      onProgress(40, 'Loading landmark model...')
      await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath)

      // Step 3 of 3: FaceRecognitionNet (6.4 MB - the heavy one)
      // A ResNet-based neural network that converts the aligned face into a
      // 128-dimensional float array (the descriptor). This is the biometric fingerprint.
      onProgress(70, 'Loading recognition network...')
      await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)

      // All 3 models are now initialized in WebGL memory
      isLoaded = true
      onProgress(100, 'All models loaded')
      return true

    } catch (err) {
      // Reset state so the caller can retry (e.g. student had network drop)
      loadingPromise = null
      isLoaded = false
      onProgress(0, `Failed to load models: ${err.message}`)
      // Re-throw so the calling component can catch and show an error message
      throw err
    }
  })()

  return loadingPromise
}

// Re-export the faceapi object so face/detect.js and other modules
// import from here instead of from @vladmandic/face-api directly.
// This guarantees every file in our codebase shares the same instance.
export { faceapi }
