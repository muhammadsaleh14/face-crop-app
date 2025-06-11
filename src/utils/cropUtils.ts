// src/utils/cropUtils.ts
import type { CropParams } from '@/types'

interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

// Add this new function to the existing file
export function calculatePercentageParamsFromPixelBox(
  faceBoundingBox: BoundingBox,
  pixelCropBox: BoundingBox,
): CropParams {
  const { x: faceX, y: faceY, width: faceWidth, height: faceHeight } = faceBoundingBox

  // Calculate pixel padding from the difference between the face box and the crop box
  const pxLeftPadding = faceX - pixelCropBox.x
  const pxRightPadding = (pixelCropBox.x + pixelCropBox.width) - (faceX + faceWidth)
  const pxTopPadding = faceY - pixelCropBox.y
  const pxBottomPadding = (pixelCropBox.y + pixelCropBox.height) - (faceY + faceHeight)

  // Convert pixel padding to percentage of the face's dimensions
  // Ensure we don't divide by zero if face dimensions are 0
  const leftPaddingPercent = faceWidth > 0 ? (pxLeftPadding / faceWidth) * 100 : 0;
  const rightPaddingPercent = faceWidth > 0 ? (pxRightPadding / faceWidth) * 100 : 0;
  const topPaddingPercent = faceHeight > 0 ? (pxTopPadding / faceHeight) * 100 : 0;
  const bottomPaddingPercent = faceHeight > 0 ? (pxBottomPadding / faceHeight) * 100 : 0;

  return {
    // Clamp to 0 to prevent negative padding values if box is dragged inside the face
    leftPaddingPercent: Math.max(0, leftPaddingPercent),
    rightPaddingPercent: Math.max(0, rightPaddingPercent),
    topPaddingPercent: Math.max(0, topPaddingPercent),
    bottomPaddingPercent: Math.max(0, bottomPaddingPercent),
  }
}

export function calculatePixelCropBox(
  faceBoundingBox: BoundingBox,
  percentageParams: CropParams,
  imageWidth: number,
  imageHeight: number,
): BoundingBox | null {
  const { leftPaddingPercent, rightPaddingPercent, topPaddingPercent, bottomPaddingPercent } =
    percentageParams
  const { x: faceX, y: faceY, width: faceWidth, height: faceHeight } = faceBoundingBox

  if (faceWidth <= 0 || faceHeight <= 0) {
    console.warn('Cannot calculate crop for zero-dimension face bounding box.')
    return null
  }

  const pxLeftPadding = (leftPaddingPercent / 100) * faceWidth
  const pxRightPadding = (rightPaddingPercent / 100) * faceWidth
  const pxTopPadding = (topPaddingPercent / 100) * faceHeight
  const pxBottomPadding = (bottomPaddingPercent / 100) * faceHeight

  // Calculate the desired crop box edges based on face and padding
  const desiredX1 = faceX - pxLeftPadding
  const desiredY1 = faceY - pxTopPadding
  const desiredX2 = faceX + faceWidth + pxRightPadding
  const desiredY2 = faceY + faceHeight + pxBottomPadding

  // Clamp these desired edges to the actual image boundaries
  const finalX1 = Math.max(0, desiredX1)
  const finalY1 = Math.max(0, desiredY1)
  const finalX2 = Math.min(imageWidth, desiredX2)
  const finalY2 = Math.min(imageHeight, desiredY2)

  // Calculate final width and height from clamped edges
  const finalWidth = finalX2 - finalX1
  const finalHeight = finalY2 - finalY1

  if (finalWidth <= 0 || finalHeight <= 0) {
    // This can happen if the face is too close to an edge and padding pushes it "off" the image.
    console.warn('Calculated crop dimensions are zero or negative after clamping.')
    return null
  }

  return {
    x: finalX1,
    y: finalY1,
    width: finalWidth,
    height: finalHeight,
  }
}
