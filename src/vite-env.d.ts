/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the DETRPose ONNX model is served from. */
  readonly VITE_POSE_MODEL_URL?: string
}
