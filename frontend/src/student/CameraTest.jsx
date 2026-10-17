import React, { useState, useRef, useEffect } from 'react'
import { loadModels, areModelsLoaded } from '../face/loadModels.js'
import { getDescriptor, euclideanDistance } from '../face/detect.js'

export default function CameraTest() {
  // Camera state
  const [isActive, setIsActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const isMountedRef = useRef(true)

  // AI Model state (Step 1.4)
  const [modelStatus, setModelStatus] = useState(areModelsLoaded() ? 'All models loaded' : 'Not loaded')
  const [modelProgress, setModelProgress] = useState(areModelsLoaded() ? 100 : 0)
  const [isModelLoading, setIsModelLoading] = useState(false)

  // Biometric Verification state (Step 1.6)
  const [sample1, setSample1] = useState(null)
  const [sample2, setSample2] = useState(null)
  const [distance, setDistance] = useState(null)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      stopCamera()
    }
  }, [])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (isMountedRef.current) {
      setIsActive(false)
    }
  }

  const startCamera = async () => {
    setError(null)
    setIsLoading(true)

    if (!window.isSecureContext) {
      setError('Camera access requires HTTPS or localhost. Please open this site over a secure HTTPS connection.')
      setIsLoading(false)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API is not supported by your browser.')
      setIsLoading(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })

      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play()
      }

      setIsActive(true)
    } catch (err) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (!isMountedRef.current) return
      console.error('Camera access error:', err)

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera permission was denied. Please allow camera access in your browser settings and retry.')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera was found on your device.')
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera is in use by another application (e.g., Zoom, Teams) or a hardware error occurred.')
      } else {
        setError(`Unable to access camera: ${err.message}`)
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }

  // Load models on button click with progress
  const handleLoadModels = async () => {
    setIsModelLoading(true)
    try {
      await loadModels((pct, msg) => {
        if (isMountedRef.current) {
          setModelProgress(pct)
          setModelStatus(msg)
        }
      })
    } catch (err) {
      if (isMountedRef.current) {
        setModelStatus(`Error: ${err.message}`)
      }
    } finally {
      if (isMountedRef.current) {
        setIsModelLoading(false)
      }
    }
  }

  // Capture descriptor from active video feed
  const handleCapture = async (slot) => {
    setFeedback(null)
    if (!areModelsLoaded()) {
      setFeedback({ type: 'error', text: 'Please load AI models first!' })
      return
    }

    if (!isActive || !videoRef.current) {
      setFeedback({ type: 'error', text: 'Please start the camera first!' })
      return
    }

    setFeedback({ type: 'info', text: 'Extracting face descriptor...' })
    const desc = await getDescriptor(videoRef.current)

    if (!desc) {
      setFeedback({
        type: 'error',
        text: 'Detection failed: Either no face was found, or more than 1 face is in the frame. Look directly at the camera alone.',
      })
      return
    }

    if (slot === 1) {
      setSample1(desc)
      if (sample2) {
        const d = euclideanDistance(desc, sample2)
        setDistance(d)
      }
      setFeedback({ type: 'success', text: `Sample 1 captured! (${desc.length} dimensions)` })
    } else {
      setSample2(desc)
      if (sample1) {
        const d = euclideanDistance(sample1, desc)
        setDistance(d)
      }
      setFeedback({ type: 'success', text: `Sample 2 captured! (${desc.length} dimensions)` })
    }
  }

  const handleResetSamples = () => {
    setSample1(null)
    setSample2(null)
    setDistance(null)
    setFeedback(null)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-950 text-gray-100">
      <div className="w-full max-w-md bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
        <h2 className="text-xl font-bold text-center mb-1">Camera & Edge AI Verification</h2>
        <p className="text-xs text-gray-400 text-center mb-4">FE2 Hardware & Descriptor Matching</p>

        {/* ─── Model Loading Bar (Step 1.4) ─── */}
        <div className="mb-4 p-3 bg-gray-950/70 border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-400">Models: {modelStatus}</span>
            <span className="font-semibold text-cyan-400">{modelProgress}%</span>
          </div>
          <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden mb-2">
            <div
              className="bg-gradient-to-r from-cyan-500 to-purple-600 h-full transition-all duration-300"
              style={{ width: `${modelProgress}%` }}
            />
          </div>
          {!areModelsLoaded() && (
            <button
              onClick={handleLoadModels}
              disabled={isModelLoading}
              className="w-full py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-cyan-300 border border-cyan-800/50 transition-all disabled:opacity-50"
            >
              {isModelLoading ? 'Loading Neural Networks...' : 'Load AI Models (~7 MB)'}
            </button>
          )}
        </div>

        {/* ─── Video Preview ─── */}
        <div className="relative aspect-[4/3] w-full bg-black/60 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center mb-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] ${isActive ? 'block' : 'hidden'}`}
          />
          {!isActive && (
            <p className="text-sm text-gray-500">Camera is off</p>
          )}
        </div>

        {error && (
          <div className="mb-3 p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        {/* ─── Camera Start / Stop Button ─── */}
        <button
          onClick={isActive ? stopCamera : startCamera}
          disabled={isLoading}
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 shadow-lg shadow-cyan-500/20 disabled:opacity-50 mb-4"
        >
          {isLoading ? 'Starting Camera...' : isActive ? 'Stop Camera' : 'Start Camera'}
        </button>

        {/* ─── Step 1.6 Descriptor & Distance Verification ─── */}
        <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl">
          <div className="text-xs font-semibold text-gray-300 mb-2">Descriptor Distance Testing (Step 1.6)</div>
          
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => handleCapture(1)}
              disabled={!isActive || !areModelsLoaded()}
              className={`py-2 px-3 text-xs rounded-lg font-medium border transition-all ${
                sample1
                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                  : 'bg-gray-800/80 border-gray-700 text-gray-300 hover:border-gray-600 disabled:opacity-40'
              }`}
            >
              {sample1 ? '✓ Sample 1 Captured' : 'Capture Sample 1'}
            </button>

            <button
              onClick={() => handleCapture(2)}
              disabled={!isActive || !areModelsLoaded()}
              className={`py-2 px-3 text-xs rounded-lg font-medium border transition-all ${
                sample2
                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                  : 'bg-gray-800/80 border-gray-700 text-gray-300 hover:border-gray-600 disabled:opacity-40'
              }`}
            >
              {sample2 ? '✓ Sample 2 Captured' : 'Capture Sample 2'}
            </button>
          </div>

          {feedback && (
            <div
              className={`p-2 rounded-lg text-xs mb-3 ${
                feedback.type === 'error'
                  ? 'bg-red-950/60 border border-red-800/60 text-red-300'
                  : feedback.type === 'success'
                  ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300'
                  : 'bg-cyan-950/60 border border-cyan-800/60 text-cyan-300'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* ─── Euclidean Distance Result ─── */}
          {distance !== null && (
            <div className="p-3 bg-gray-900 border border-gray-700 rounded-lg text-center">
              <div className="text-xs text-gray-400">Euclidean Distance</div>
              <div className="text-2xl font-mono font-bold text-cyan-300 my-1">
                {distance.toFixed(4)}
              </div>
              <div
                className={`text-xs font-semibold px-2 py-1 rounded inline-block ${
                  distance < 0.55
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-red-950 text-red-300 border border-red-700'
                }`}
              >
                {distance < 0.55 ? 'MATCH: Same Person (< 0.55)' : 'NO MATCH: Different Person (>= 0.55)'}
              </div>

              <button
                onClick={handleResetSamples}
                className="block mx-auto mt-2 text-[11px] text-gray-400 underline hover:text-gray-200"
              >
                Reset Samples
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
