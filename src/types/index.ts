// src/types/index.ts
export interface FaceDetectionResult {
  center: { x: number; y: number };
  boundingBox: { x: number; y: number; width: number; height: number };
  imageWidth: number; // Natural width of the original image
  imageHeight: number; // Natural height of the original image
  detectionCount: number; // Total number of faces detected in the image
}

export interface CropParams {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BatchImageFile {
  id: string;
  file: File;
  originalUrl?: string; // Object URL for preview on main thread
  status: 'pending' | 'processing' | 'cropped' | 'skipped';
  croppedBlob?: Blob;
  skippedReason?: string;
}
