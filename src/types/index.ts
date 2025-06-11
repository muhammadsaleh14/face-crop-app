// src/types/index.ts
export interface CropParams {
  leftPaddingPercent: number // e.g., 50 means 50% of face width
  rightPaddingPercent: number // e.g., 50 means 50% of face width
  topPaddingPercent: number // e.g., 25 means 25% of face height
  bottomPaddingPercent: number // e.g., 25 means 25% of face height
}
export interface BoundingBox {
  // Renamed from PixelBoundingBox for clarity
  x: number
  y: number
  width: number
  height: number
}

// FaceDetectionResult and BatchImageFile remain the same
export interface FaceDetectionResult {
  primaryBoundingBox: BoundingBox | null // The largest face, or a selected one for the template
  allDetectedBoundingBoxes: BoundingBox[] // All faces found
  imageWidth: number
  imageHeight: number
  detectionCount: number // Total number of valid bounding boxes found
}

export interface BatchImageFile {
  id: string
  file: File
  originalUrl?: string
  status: 'pending' | 'processing' | 'cropped' | 'skipped' | 'error' // Added 'error'
  // For batch processing, we might store the full detection result
  // to avoid re-detecting faces if we enhance the review step later.
  // For now, BatchProcessorUI will call detectAllFaces.
  croppedBlobs?: { blob: Blob; filenameSuffix: string }[] // Array of blobs if multiple faces
  skippedReason?: string
  errorMessage?: string // For critical errors during processing one image
}
