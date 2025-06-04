// public/cropWorker.js

self.onmessage = async (event) => {
  const {
    imageDataUrl,
    faceCenterX,
    faceCenterY,
    cropParams,
    outputFormat,
    quality,
    filename,
  
  } = event.data;

  try {
    // Step 1: Fetch the image data
    const response = await fetch(imageDataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    // Step 2: Convert to Blob
    const imageBlob = await response.blob();

    // Step 3: Create an ImageBitmap from the Blob
    const imageBitmap = await createImageBitmap(imageBlob);

    // --- Cropping logic (uses imageBitmap dimensions directly) ---
    const { top, right, bottom, left } = cropParams;
    const cropX = Math.max(0, faceCenterX - left);
    const cropY = Math.max(0, faceCenterY - top);
    const cropWidth = left + right;
    const cropHeight = top + bottom;

    // Using imageBitmap.width and imageBitmap.height instead of passed imageNaturalWidth/Height
    // as these are the actual dimensions of the decoded image data.
    const finalCropX = Math.min(cropX, imageBitmap.width - 1);
    const finalCropY = Math.min(cropY, imageBitmap.height - 1);
    const finalCropWidth = Math.min(cropWidth, imageBitmap.width - finalCropX);
    const finalCropHeight = Math.min(cropHeight, imageBitmap.height - finalCropY);

    if (finalCropWidth <= 0 || finalCropHeight <= 0) {
      throw new Error('Crop dimensions result in zero or negative size.');
    }

    const canvas = new OffscreenCanvas(finalCropWidth, finalCropHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');

    ctx.drawImage(
      imageBitmap,
      finalCropX,      // sourceX
      finalCropY,      // sourceY
      finalCropWidth,  // sourceWidth
      finalCropHeight, // sourceHeight
      0,               // destinationX
      0,               // destinationY
      finalCropWidth,  // destinationWidth
      finalCropHeight  // destinationHeight
    );

    // Free up memory from the ImageBitmap if you no longer need it
    imageBitmap.close();

    const blob = await canvas.convertToBlob({ type: outputFormat, quality: quality });
    self.postMessage({ status: 'cropped', blob, filename });

  } catch (error) {
    console.error('Worker error for', filename, ':', error);
    self.postMessage({ status: 'error', error: error.message, filename });
  } finally {
    // Important: The main thread created imageDataUrl using URL.createObjectURL().
    // The main thread is responsible for revoking it.
    // If the worker signals completion/error, the main thread should revoke.
    // This can be done by passing the imageDataUrl back or just a signal that the worker is done with it.
  }
};
