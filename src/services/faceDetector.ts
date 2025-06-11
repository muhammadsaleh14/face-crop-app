import { FilesetResolver, FaceDetector, type Detection } from '@mediapipe/tasks-vision'
import type { FaceDetectionResult, BoundingBox } from '@/types'

let faceDetector: FaceDetector | null = null
const DEBUG = true
const log = (...args: any[]) => DEBUG && console.log('[FaceDetector]', ...args)

function getModelPath(modelFileName: string): string {
  const base = import.meta.env.BASE_URL
  let path = `${base}models/${modelFileName}`
  path = path.replace(/\/\//g, '/')
  return path
}

async function initializeFaceDetector(): Promise<void> {
  if (faceDetector) return
  log('Initializing FaceDetector...')
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    )
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: getModelPath('blaze_face_short_range.tflite'),
        delegate: 'GPU', // Or 'CPU'
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    })
    log('FaceDetector initialized successfully.')
  } catch (error) {
    console.error('Failed to initialize FaceDetector:', error)
    throw error
  }
}

export async function detectAllFaces(
  imageElement: HTMLImageElement,
): Promise<FaceDetectionResult | null> {
  if (!faceDetector) {
    try {
      await initializeFaceDetector()
    } catch (initError) {
      console.error('FaceDetector initialization failed, cannot detect faces.', initError)
      return null
    }
    if (!faceDetector) {
      console.error('FaceDetector not available after initialization attempt.')
      return null
    }
  }

  try {
    log(
      'Detecting faces in image element (src starts with):',
      imageElement.src.substring(0, 60) + (imageElement.src.length > 60 ? '...' : ''),
    )
    const mediapipeFaceDetectorResult = faceDetector.detect(imageElement)

    if (!mediapipeFaceDetectorResult || mediapipeFaceDetectorResult.detections.length === 0) {
      log('No faces detected by Mediapipe.')
      return null
    }

    log(`Mediapipe detected ${mediapipeFaceDetectorResult.detections.length} raw detections.`)

    const allDetectedBoundingBoxes: BoundingBox[] = []
    mediapipeFaceDetectorResult.detections.forEach((detection: Detection) => {
      if (detection.boundingBox) {
        allDetectedBoundingBoxes.push({
          x: detection.boundingBox.originX,
          y: detection.boundingBox.originY,
          width: detection.boundingBox.width,
          height: detection.boundingBox.height,
        })
      }
    })

    if (allDetectedBoundingBoxes.length === 0) {
      log('No valid bounding boxes extracted from detections.')
      return null
    }

    log(`Extracted ${allDetectedBoundingBoxes.length} valid bounding boxes.`)

    let largestFaceBox: BoundingBox | null = null
    let maxArea = 0
    allDetectedBoundingBoxes.forEach((bb) => {
      const area = bb.width * bb.height
      if (area > maxArea) {
        maxArea = area
        largestFaceBox = bb
      }
    })

    if (largestFaceBox) {
      log('Largest face box identified:', largestFaceBox)
    } else if (allDetectedBoundingBoxes.length > 0) {
      // If no largest (e.g. all zero area, unlikely), but boxes exist, pick first for template
      largestFaceBox = allDetectedBoundingBoxes[0]
      log('No largest face box with positive area, picked first available for template.')
    } else {
      log('No largest face box identified and no other boxes available.')
    }

    return {
      primaryBoundingBox: largestFaceBox,
      allDetectedBoundingBoxes: allDetectedBoundingBoxes,
      imageWidth: imageElement.naturalWidth,
      imageHeight: imageElement.naturalHeight,
      detectionCount: allDetectedBoundingBoxes.length,
    }
  } catch (error) {
    console.error('Error during face detection process:', error)
    return null
  }
}
