<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCropStore } from '@/stores/cropStore'
import { detectLargestFace } from '@/services/faceDetector'
import { calculatePixelCropBox } from '@/utils/cropUtils' // For calculating final crop pixels
import { createZip, triggerZipDownload } from '@/services/zipService'
import type { BatchImageFile, FaceDetectionResult } from '@/types'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-vue-next'

const store = useCropStore()
// definedCropParams from store ARE the percentage-based params
const {
  batchImages,
  definedCropParams,
  isProcessingBatch,
  successfullyCroppedCount,
  skippedImageInfos,
} = storeToRefs(store)

const MAX_WORKERS = navigator.hardwareConcurrency || 4
const workers: Worker[] = []
let imageQueue: BatchImageFile[] = [] // Queue of images waiting for a worker
let activeWorkersCount = 0 // Count of workers currently busy

// Map to store Object URLs for images sent to workers, to revoke them later
const activeImageObjectURLs = new Map<string, string>() // filename -> objectURL

const overallProgress = computed(() => {
  if (batchImages.value.length === 0) return 0
  const processedCount = batchImages.value.filter(
    (img) => img.status === 'cropped' || img.status === 'skipped',
  ).length
  return (processedCount / batchImages.value.length) * 100
})

function initializeWorkers() {
  if (workers.length > 0) return // Already initialized

  for (let i = 0; i < MAX_WORKERS; i++) {
    const worker = new Worker(new URL('/cropWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { status, blob, filename, error: workerError } = event.data
      const originalBatchFile = batchImages.value.find((f) => f.file.name === filename)

      const objectURLToRevoke = activeImageObjectURLs.get(filename)
      if (objectURLToRevoke) {
        URL.revokeObjectURL(objectURLToRevoke)
        activeImageObjectURLs.delete(filename)
      }

      if (originalBatchFile) {
        if (status === 'cropped') {
          store.updateBatchImageStatus(originalBatchFile.id, 'cropped', blob)
        } else {
          store.updateBatchImageStatus(
            originalBatchFile.id,
            'skipped',
            undefined,
            workerError || 'Worker processing failed',
          )
        }
      }
      activeWorkersCount--
      processNextImageFromQueue() // Try to process another image
    }
    worker.onerror = (error) => {
      console.error('Worker instance error (onerror):', error)
      // This indicates a more fundamental issue with a worker instance.
      // Try to find an image that might have been "stuck" with this worker.
      // This is hard to attribute perfectly.
      // For simplicity, we just decrement and try to continue.
      // A more robust system might try to re-queue the "lost" task.
      activeWorkersCount--
      processNextImageFromQueue()
    }
    workers.push(worker)
  }
}

async function processBatch() {
  if (!definedCropParams.value || batchImages.value.length === 0) {
    alert('Crop parameters not set or no batch images.')
    return
  }
  if (isProcessingBatch.value) return

  store.startBatchProcessing() // Resets counts and sets isProcessingBatch
  imageQueue = [
    ...batchImages.value.filter((img) => img.status === 'pending' || img.status === 'processing'),
  ] // Re-queue if some were stuck

  for (let i = 0; i < MAX_WORKERS; i++) {
    if (activeWorkersCount < MAX_WORKERS) {
      // Check before calling
      processNextImageFromQueue()
    }
  }
}

async function processNextImageFromQueue() {
  if (imageQueue.length === 0) {
    if (activeWorkersCount === 0) {
      // All images processed and all workers idle
      store.finishBatchProcessing()
    }
    return // No more images in queue
  }

  if (activeWorkersCount >= MAX_WORKERS) {
    return // All workers are currently busy
  }

  const batchFile = imageQueue.shift() // Get next image from queue
  if (!batchFile) return // Should not happen if queue wasn't empty

  activeWorkersCount++
  store.updateBatchImageStatus(batchFile.id, 'processing')

  try {
    const imageElement = await loadImageToElement(batchFile.file)
    const faceResult: FaceDetectionResult | null = await detectLargestFace(imageElement)

    if (faceResult && faceResult.boundingBox && definedCropParams.value) {
      const pixelCropSourceBox = calculatePixelCropBox(
        faceResult.boundingBox,
        definedCropParams.value, // These are the percentage-based params
        imageElement.naturalWidth,
        imageElement.naturalHeight,
      )

      if (pixelCropSourceBox) {
        const imageDataUrl = URL.createObjectURL(batchFile.file)
        activeImageObjectURLs.set(batchFile.file.name, imageDataUrl)

        // Find an available worker (the first one not tracked by activeWorkersCount is simplest way)
        // This assumes workers are roughly equivalent. A true pool might be better.
        const workerToUse = workers[activeWorkersCount - (1 % MAX_WORKERS)] // % workers.length
        if (!workerToUse) {
          // Should not happen if workers are initialized
          throw new Error('No available worker found.')
        }

        workerToUse.postMessage({
          imageDataUrl,
          sourceX: pixelCropSourceBox.x,
          sourceY: pixelCropSourceBox.y,
          sourceWidth: pixelCropSourceBox.width,
          sourceHeight: pixelCropSourceBox.height,
          outputWidth: pixelCropSourceBox.width,
          outputHeight: pixelCropSourceBox.height,
          outputFormat: 'image/png',
          quality: 0.9,
          filename: batchFile.file.name,
        })
      } else {
        // Crop box calculation failed (e.g., zero size, face too close to edge with large padding)
        store.updateBatchImageStatus(
          batchFile.id,
          'skipped',
          undefined,
          'Calculated crop dimensions were invalid',
        )
        activeWorkersCount-- // Worker was not used
        processNextImageFromQueue() // Try next image
      }
    } else {
      let reason = 'No face detected or face data incomplete'
      if (!definedCropParams.value) reason = 'Crop parameters not defined (should not happen)'
      store.updateBatchImageStatus(batchFile.id, 'skipped', undefined, reason)
      activeWorkersCount-- // Worker was not used
      processNextImageFromQueue() // Try next image
    }
  } catch (error: any) {
    console.error(`Error processing ${batchFile.file.name} on main thread:`, error)
    store.updateBatchImageStatus(
      batchFile.id,
      'skipped',
      undefined,
      `Main thread error: ${error.message}`,
    )
    activeWorkersCount-- // Worker was not used
    processNextImageFromQueue() // Try next image
  }
}

function loadImageToElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = (errEvent) => {
        console.error('Failed to load image into HTMLImageElement:', errEvent)
        reject(new Error('Failed to load image file for processing.'))
      }
      img.src = e.target?.result as string
    }
    reader.onerror = (errEvent) => {
      console.error('FileReader error:', errEvent)
      reject(new Error('FileReader failed to read the image file.'))
    }
    reader.readAsDataURL(file)
  })
}

async function handleDownloadZip() {
  const filesToZip = batchImages.value
    .filter((img) => img.status === 'cropped' && img.croppedBlob)
    .map((img) => ({
      filename: `cropped_${img.file.name.split('.').slice(0, -1).join('.') || img.file.name}.png`, // Enforce png for now
      blob: img.croppedBlob!,
    }))

  if (filesToZip.length === 0) {
    alert('No images were successfully cropped to download.')
    return
  }

  try {
    const zipBlob = await createZip(filesToZip)
    triggerZipDownload(zipBlob, 'cropped_images_batch.zip')
  } catch (error) {
    console.error('Failed to create ZIP:', error)
    alert('Error creating ZIP file. Check console for details.')
  }
}

onMounted(() => {
  initializeWorkers()
})

onUnmounted(() => {
  // Terminate workers and clear object URLs if any are left (though they should be cleared by worker messages)
  workers.forEach((worker) => worker.terminate())
  workers.length = 0 // Clear the array
  activeImageObjectURLs.forEach((url) => URL.revokeObjectURL(url))
  activeImageObjectURLs.clear()
})
</script>

<template>
  <div class="space-y-6">
    <Button
      @click="processBatch"
      :disabled="isProcessingBatch || batchImages.length === 0 || !definedCropParams"
      class="w-full"
    >
      <Loader2 v-if="isProcessingBatch" class="mr-2 h-4 w-4 animate-spin" />
      {{
        isProcessingBatch
          ? `Processing ${activeWorkersCount} / ${batchImages.length}...`
          : 'Start Batch Processing'
      }}
    </Button>

    <div v-if="batchImages.length > 0 || isProcessingBatch">
      <h3 class="text-lg font-medium mb-2">Overall Progress</h3>
      <Progress :model-value="overallProgress" class="w-full" />
      <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">
        {{ batchImages.filter((img) => img.status === 'cropped').length }} cropped /
        {{ batchImages.filter((img) => img.status === 'skipped').length }} skipped /
        {{ batchImages.length }} total
      </p>
    </div>

    <Card
      v-if="!isProcessingBatch && (skippedImageInfos.length > 0 || successfullyCroppedCount > 0)"
    >
      <CardHeader>
        <CardTitle>Batch Processing Complete</CardTitle>
        <CardDescription>
          {{ successfullyCroppedCount }} image(s) successfully cropped.
          {{ skippedImageInfos.length }} image(s) were skipped.
        </CardDescription>
      </CardHeader>
      <CardContent v-if="skippedImageInfos.length > 0">
        <h4 class="font-semibold mb-2">Details for Skipped Images:</h4>
        <ScrollArea class="h-40 w-full rounded-md border p-2 bg-slate-50 dark:bg-slate-700">
          <ul>
            <li v-for="(skipped, index) in skippedImageInfos" :key="index" class="text-sm py-1">
              <strong>{{ skipped.filename }}</strong
              >: {{ skipped.reason }}
            </li>
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>

    <Button
      v-if="!isProcessingBatch && successfullyCroppedCount > 0"
      @click="handleDownloadZip"
      class="w-full mt-4"
      variant="default"
    >
      Download Cropped Images ({{ successfullyCroppedCount }}) as ZIP
    </Button>
    <Button
      v-if="!isProcessingBatch && batchImages.length > 0"
      @click="store.clearBatch()"
      variant="destructive"
      class="w-full mt-2"
    >
      Clear Current Batch
    </Button>
  </div>
</template>
