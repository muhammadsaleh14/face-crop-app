// src/services/faceDetector.ts
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision'; // Corrected: Removed FaceLandmarker
import type { FaceDetectionResult } from '@/types';

let faceDetector: FaceDetector | null = null;

async function initializeFaceDetector(): Promise<void> {
  if (faceDetector) return;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm' // Path to WASM assets
    );
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        // Ensure this model is in your public/models/ directory
        modelAssetPath: `/models/blaze_face_short_range.tflite`,
        delegate: 'GPU', // Or 'CPU'
      },
      runningMode: 'IMAGE', // For processing single images
      minDetectionConfidence: 0.5, // Adjust as needed
    });
    console.log('FaceDetector initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize FaceDetector:', error);
    // Consider how to propagate this error to the UI if initialization fails critically
    throw error;
  }
}

export async function detectLargestFace(imageElement: HTMLImageElement): Promise<FaceDetectionResult | null> {
  if (!faceDetector) {
    try {
      await initializeFaceDetector();
    } catch (initError) {
        console.error("FaceDetector initialization failed, cannot detect faces.", initError);
        return null; // Cannot proceed if detector isn't initialized
    }
    if (!faceDetector) { // Double check after attempt
        console.error("FaceDetector not available after initialization attempt.");
        return null;
    }
  }

  try {
    // The result from FaceDetector.detect() is of type FaceDetectorResult
    // which has a `detections: Detection[]` property.
    // Each `Detection` has a `boundingBox` (if found).
    const mediapipeDetections = faceDetector.detect(imageElement);

    if (!mediapipeDetections || mediapipeDetections.detections.length === 0) {
      return null; // No faces detected
    }

    let largestFace: FaceDetectionResult | null = null;
    let maxArea = 0;

    mediapipeDetections.detections.forEach(detection => {
      // The boundingBox from FaceDetector can be null if confidence is too low,
      // but minDetectionConfidence should filter these. Still good to check.
      if (!detection.boundingBox) return;

      const bb = detection.boundingBox; // This is a BoundingBox object
      const area = bb.width * bb.height;

      if (area > maxArea) {
        maxArea = area;
        largestFace = {
          center: {
            x: bb.originX + bb.width / 2,
            y: bb.originY + bb.height / 2,
          },
          boundingBox: { // Store the original bounding box values
            x: bb.originX,
            y: bb.originY,
            width: bb.width,
            height: bb.height,
          },
          imageWidth: imageElement.naturalWidth,
          imageHeight: imageElement.naturalHeight,
          detectionCount: mediapipeDetections.detections.length, // Total faces found in this image
        };
      }
    });

    return largestFace; // This will be the largest face found, or null if none met criteria

  } catch (error) {
    console.error('Error during face detection:', error);
    return null;
  }
}
