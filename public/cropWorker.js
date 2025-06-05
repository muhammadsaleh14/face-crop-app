// public/cropWorker.js
self.onmessage = async (event) => {
  const {
    imageDataUrl,
    sourceX,         // Pixel value from main thread
    sourceY,         // Pixel value from main thread
    sourceWidth,     // Pixel value from main thread
    sourceHeight,    // Pixel value from main thread
    outputWidth,     // Pixel value from main thread (same as sourceWidth for this crop type)
    outputHeight,    // Pixel value from main thread (same as sourceHeight for this crop type)
    outputFormat,
    quality,
    filename,
  } = event.data;

  try {
    const response = await fetch(imageDataUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const imageBlob = await response.blob();
    const imageBitmap = await createImageBitmap(imageBlob);

    if (sourceWidth <= 0 || sourceHeight <= 0 || outputWidth <= 0 || outputHeight <= 0) {
      throw new Error('Invalid crop dimensions received by worker.');
    }

    const canvas = new OffscreenCanvas(outputWidth, outputHeight); // Use output dimensions
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');

    ctx.drawImage(
      imageBitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,               // destinationX (always 0 for the new canvas)
      0,               // destinationY (always 0 for the new canvas)
      outputWidth,     // destinationWidth
      outputHeight     // destinationHeight
    );

    imageBitmap.close();
    const blob = await canvas.convertToBlob({ type: outputFormat, quality: quality });
    self.postMessage({ status: 'cropped', blob, filename });

  } catch (error) {
    console.error('Worker error for', filename, ':', error);
    self.postMessage({ status: 'error', error: error.message, filename });
  }
};
