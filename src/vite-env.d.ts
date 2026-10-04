/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the DETRPose ONNX model is served from. */
  readonly VITE_POSE_MODEL_URL?: string
  /** 'mediapipe' (default) or 'detrpose'. */
  readonly VITE_POSE_ENGINE?: string
  /** Set by the artifact build: binary assets are shipped as base64 text. */
  readonly VITE_PACKED_ASSETS?: string
}
