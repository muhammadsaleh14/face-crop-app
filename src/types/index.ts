// src/types/index.ts
export interface CropParams {
  leftPaddingPercent: number // e.g., 50 means 50% of face width
  rightPaddingPercent: number // e.g., 50 means 50% of face width
  topPaddingPercent: number // e.g., 25 means 25% of face height
  bottomPaddingPercent: number // e.g., 25 means 25% of face height
}

// FaceDetectionResult and BatchImageFile remain the same
export interface FaceDetectionResult {
  center: { x: number; y: number } // Still useful for other things, or drawing a marker
  boundingBox: { x: number; y: number; width: number; height: number } // Crucial for the new logic
  imageWidth: number
  imageHeight: number
  detectionCount: number
}

export interface BatchImageFile {
  // ... same as before
  id: string
  file: File
  originalUrl?: string
  status: 'pending' | 'processing' | 'cropped' | 'skipped'
  croppedBlob?: Blob
  skippedReason?: string
}
