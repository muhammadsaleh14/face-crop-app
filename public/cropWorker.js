// public/cropWorker.js
self.onmessage = async (event) => {
  const {
    imageFile,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    outputFormat,
    quality,
    filename,
    originalFileId,
    faceIndex
  } = event.data;

  // --- WORKER DEBUG LOGGING ---
  console.log(`[Worker] Received task for: ${filename}, Face Index: ${faceIndex}, Original ID: ${originalFileId}`);
  console.log(`[Worker] Crop Params: X:${sourceX}, Y:${sourceY}, W:${sourceWidth}, H:${sourceHeight}`);
  console.log(`[Worker] Output Dims: W:${outputWidth}, H:${outputHeight}`);
  if (!imageFile) {
    console.error(`[Worker] FATAL: imageFile is undefined for ${filename}`);
    self.postMessage({ status: 'error', error: 'imageFile was undefined in worker', filename, originalFileId, faceIndex });
    return;
  }
  console.log(`[Worker] imageFile name: ${imageFile.name}, size: ${imageFile.size}, type: ${imageFile.type}`);

  try {
    console.log(`[Worker] Attempting createImageBitmap for ${filename}...`);
    const imageBitmap = await createImageBitmap(imageFile);
    console.log(`[Worker] createImageBitmap SUCCESS for ${filename}. Dimensions: ${imageBitmap.width}x${imageBitmap.height}`);

    if (sourceWidth <= 0 || sourceHeight <= 0 || outputWidth <= 0 || outputHeight <= 0) {
      console.error(`[Worker] Invalid crop dimensions for ${filename}:`, { sourceWidth, sourceHeight, outputWidth, outputHeight });
      throw new Error('Invalid crop dimensions received by worker.');
    }

    console.log(`[Worker] Creating OffscreenCanvas for ${filename}...`);
    const canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error(`[Worker] Failed to get 2D context for ${filename}`);
      throw new Error('Failed to get 2D context from OffscreenCanvas');
    }
    console.log(`[Worker] OffscreenCanvas context obtained for ${filename}.`);

    console.log(`[Worker] Drawing image to OffscreenCanvas for ${filename}...`);
    ctx.drawImage(
      imageBitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight
    );
    console.log(`[Worker] Image drawn for ${filename}. Closing bitmap.`);

    imageBitmap.close();

    console.log(`[Worker] Converting canvas to blob for ${filename}...`);
    const blob = await canvas.convertToBlob({ type: outputFormat, quality: quality });
    console.log(`[Worker] Canvas converted to blob for ${filename}. Size: ${blob.size}`);

    console.log(`[Worker] Posting 'cropped' message for ${filename}, Face: ${faceIndex}`);
    self.postMessage({
      status: 'cropped',
      blob,
      filename,
      originalFileId,
      faceIndex
    });

  } catch (error) {
    // --- DETAILED WORKER ERROR LOGGING ---
    console.error(`[Worker] CATCH BLOCK for ${filename}, Face Index: ${faceIndex}, Original ID: ${originalFileId}`);
    console.error(`[Worker] Error message: ${error.message}`);
    console.error(`[Worker] Error stack: ${error.stack}`);
    console.error(`[Worker] Error object:`, error);

    self.postMessage({
      status: 'error',
      error: error.message || 'Unknown worker error',
      filename,
      originalFileId,
      faceIndex
    });
  }
};
