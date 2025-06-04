// src/services/imageCropper.ts
import type { CropParams } from '@/types';

export async function cropImage(
  imageElement: HTMLImageElement,
  faceCenterX: number,
  faceCenterY: number,
  cropParams: CropParams,
  outputFormat: 'image/png' | 'image/jpeg' = 'image/png',
  quality: number = 0.92 // For JPEG
): Promise<Blob | null> {
  const { top, right, bottom, left } = cropParams;

  // Calculate crop box relative to image coordinates
  const cropX = Math.max(0, faceCenterX - left);
  const cropY = Math.max(0, faceCenterY - top);
  const cropWidth = left + right;
  const cropHeight = top + bottom;

  // Ensure crop box is within image boundaries
  const finalCropX = Math.min(cropX, imageElement.naturalWidth - 1);
  const finalCropY = Math.min(cropY, imageElement.naturalHeight - 1);
  const finalCropWidth = Math.min(cropWidth, imageElement.naturalWidth - finalCropX);
  const finalCropHeight = Math.min(cropHeight, imageElement.naturalHeight - finalCropY);

  if (finalCropWidth <= 0 || finalCropHeight <= 0) {
    console.warn("Crop dimensions result in zero or negative size.");
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = finalCropWidth;
  canvas.height = finalCropHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.error('Failed to get 2D context from canvas');
    return null;
  }

  ctx.drawImage(
    imageElement,
    finalCropX,      // sourceX
    finalCropY,      // sourceY
    finalCropWidth,  // sourceWidth
    finalCropHeight, // sourceHeight
    0,               // destinationX
    0,               // destinationY
    finalCropWidth,  // destinationWidth
    finalCropHeight  // destinationHeight
  );

  return new Promise((resolve) => {
    if (outputFormat === 'image/jpeg') {
      canvas.toBlob(resolve, outputFormat, quality);
    } else {
      canvas.toBlob(resolve, outputFormat);
    }
  });
}
