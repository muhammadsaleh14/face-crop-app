<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCropStore } from '@/stores/cropStore'
import { detectLargestFace } from '@/services/faceDetector'
// cropImage function will be executed IN THE WORKER
import { createZip, triggerZipDownload } from '@/services/zipService'
import type { BatchImageFile } from '@/types'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress' // Shadcn-vue
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card' // Shadcn-vue
import { ScrollArea } from '@/components/ui/scroll-area' // Shadcn-vue
import { Loader2 } from 'lucide-vue-next'

const store = useCropStore()
const {
  batchImages,
  definedCropParams,
  isProcessingBatch,
  successfullyCroppedCount,
  skippedImageInfos,
} = storeToRefs(store)

const MAX_WORKERS = navigator.hardwareConcurrency || 4 // Use available cores, default to 4
const workers: Worker[] = []
let imageQueue: BatchImageFile[] = []
let activeWorkers = 0
const activeImageObjectURLs = new Map<string, string>()

const overallProgress = computed(() => {
  if (batchImages.value.length === 0) return 0
  const processedCount = batchImages.value.filter(
    (img) => img.status === 'cropped' || img.status === 'skipped',
  ).length
  return (processedCount / batchImages.value.length) * 100
})

function initializeWorkers() {
  for (let i = 0; i < MAX_WORKERS; i++) {
    // Ensure worker path is correct from public folder
    const worker = new Worker(new URL('/cropWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { status, blob, filename, error: workerError } = event.data
      const originalFile = batchImages.value.find((f) => f.file.name === filename) // Find by original filename

      // Revoke the Object URL
      const objectURLToRevoke = activeImageObjectURLs.get(filename)
      if (objectURLToRevoke) {
        URL.revokeObjectURL(objectURLToRevoke)
        activeImageObjectURLs.delete(filename)
      }

      if (originalFile) {
        if (status === 'cropped') {
          store.updateBatchImageStatus(originalFile.id, 'cropped', blob)
        } else {
          store.updateBatchImageStatus(
            originalFile.id,
            'skipped',
            undefined,
            workerError || 'Worker processing failed',
          )
        }
      }
      activeWorkers--
      processNextImageFromQueue()
    }
    worker.onerror = (error) => {
      console.error('Worker setup error:', error)
      // This onerror is for setup issues with the worker itself,
      // not for errors from onmessage (which are handled above).
      // We need a way to link this back to a specific file if a task was ongoing.
      // For now, let's assume this is a general worker error.
      // If there was an active task for this worker, try to mark it as skipped.
      // This part is a bit tricky to attribute without more state.

      // Simplistic: if a worker dies, try to find an image marked as "processing"
      // that hasn't completed and mark it as skipped.
      const processingImage = batchImages.value.find(
        (img) => img.status === 'processing' && !activeImageObjectURLs.has(img.file.name),
      )
      if (processingImage) {
        // Revoke if we can find its URL (might not be in activeImageObjectURLs if error was very early)
        const urlToRevoke = activeImageObjectURLs.get(processingImage.file.name)
        if (urlToRevoke) {
          URL.revokeObjectURL(urlToRevoke)
          activeImageObjectURLs.delete(processingImage.file.name)
        }
        store.updateBatchImageStatus(
          processingImage.id,
          'skipped',
          undefined,
          `Worker failed unexpectedly: ${error.message}`,
        )
      }

      activeWorkers--
      processNextImageFromQueue() // Attempt to continue with other workers/images
    }
    workers.push(worker)
  }
}

async function processBatch() {
  if (!definedCropParams.value || batchImages.value.length === 0) {
    alert('Crop parameters not set or no batch images.')
    return
  }
  store.startBatchProcessing()
  imageQueue = [...batchImages.value.filter((img) => img.status === 'pending')] // Get pending images

  // Start processing with available workers
  for (let i = 0; i < MAX_WORKERS; i++) {
    processNextImageFromQueue()
  }
}

async function processNextImageFromQueue() {
  if (imageQueue.length === 0) {
    if (activeWorkers === 0) {
      store.finishBatchProcessing()
      console.log('Batch processing complete.')
    }
    return
  }

  if (activeWorkers >= MAX_WORKERS) {
    return // All workers busy
  }

  const batchFile = imageQueue.shift()
  if (!batchFile || !definedCropParams.value) return

  activeWorkers++
  store.updateBatchImageStatus(batchFile.id, 'processing')

  try {
    // Perform face detection on the main thread
    const imageElement = await loadImageToElement(batchFile.file)
    const faceResult = await detectLargestFace(imageElement)

    if (faceResult && faceResult.center && definedCropParams.value) {
      // Add null check for definedCropParams.value
      const imageDataUrl = URL.createObjectURL(batchFile.file)
      activeImageObjectURLs.set(batchFile.file.name, imageDataUrl)

      // THE FIX for DataCloneError:
      const plainCropParams = { ...definedCropParams.value } // Create a plain JS object

      const worker = workers[activeWorkers % MAX_WORKERS] // Or your worker selection logic
      worker.postMessage({
        imageDataUrl,
        faceCenterX: faceResult.center.x,
        faceCenterY: faceResult.center.y,
        cropParams: plainCropParams, // Use the plain object copy
        outputFormat: 'image/png',
        quality: 0.9,
        filename: batchFile.file.name,
        imageNaturalWidth: imageElement.naturalWidth,
        imageNaturalHeight: imageElement.naturalHeight,
      })
      // Consider revoking imageDataUrl after worker is done or if it errors.
      // A simple way: worker.onmessage = (event) => { ... URL.revokeObjectURL(imageDataUrl); activeWorkers--; ... }
      // worker.onerror = (event) => { ... URL.revokeObjectURL(imageDataUrl); activeWorkers--; ... }
      // However, this means the worker message needs to echo back enough info to find the URL.
      // Or, store these temporary URLs in a map and clear them.
      // For now, existing logic revokes `batchFile.originalUrl` on `clearBatch`,
      // which might be sufficient if `imageDataUrl` is same as `batchFile.originalUrl`.
      // If not, you'll need to manage `imageDataUrl` revocation more carefully.
      // Let's assume batchFile.originalUrl IS the imageDataUrl for simplicity or that current revocation is enough for now.
    } else {
      let reason = 'No face detected'
      if (!definedCropParams.value) {
        reason = 'Crop parameters not defined'
      }
      store.updateBatchImageStatus(batchFile.id, 'skipped', undefined, reason)
      activeWorkers--
      processNextImageFromQueue()
    }
  } catch (error) {
    console.error(`Error processing ${batchFile.file.name}:`, error)
    store.updateBatchImageStatus(batchFile.id, 'skipped', undefined, `Error: ${error}`)
    activeWorkers-- // Decrement as this path failed before worker dispatch
    processNextImageFromQueue()
  }
}

function loadImageToElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleDownloadZip() {
  const filesToZip = batchImages.value
    .filter((img) => img.status === 'cropped' && img.croppedBlob)
    .map((img) => ({
      filename: `cropped_${img.file.name}`, // Add prefix or change extension
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
  // If returning to this step with pending images, an option to auto-start or manual start
  // if (batchImages.value.some(img => img.status === 'pending') && !isProcessingBatch.value) {
  //   processBatch(); // Or require a button click
  // }
})

// Clean up workers when component is unmounted
// onUnmounted(() => {
//   workers.forEach(worker => worker.terminate());
// });
// Terminating workers on unmount can be problematic if App.vue structure re-renders this component often.
// Better to initialize once and keep them, or manage lifecycle carefully.
// For this app, since it's a distinct step, it might be okay.
</script>

<template>
  <div class="space-y-6">
    <Button
      @click="processBatch"
      :disabled="isProcessingBatch || batchImages.length === 0 || !definedCropParams"
      class="w-full"
    >
      <Loader2 v-if="isProcessingBatch" class="mr-2 h-4 w-4 animate-spin" />
      {{ isProcessingBatch ? 'Processing...' : 'Start Batch Processing' }}
    </Button>

    <div v-if="batchImages.length > 0">
      <h3 class="text-lg font-medium mb-2">Processing Progress</h3>
      <Progress :model-value="overallProgress" class="w-full" />
      <p class="text-sm text-slate-600 dark:text-slate-400 mt-1">
        {{ successfullyCroppedCount }} cropped / {{ skippedImageInfos.length }} skipped /
        {{ batchImages.length }} total
      </p>
    </div>

    <Card v-if="isProcessingBatch || skippedImageInfos.length > 0 || successfullyCroppedCount > 0">
      <CardHeader>
        <CardTitle>Processing Summary</CardTitle>
        <CardDescription>Status of the batch processing.</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="isProcessingBatch && overallProgress < 100">Processing... please wait.</p>
        <div
          v-if="
            !isProcessingBatch && (skippedImageInfos.length > 0 || successfullyCroppedCount > 0)
          "
        >
          <Alert variant="default" class="mb-4">
            <AlertTitle>Batch Processing Complete!</AlertTitle>
            <AlertDescription>
              {{ successfullyCroppedCount }} image(s) successfully cropped. <br />
              {{ skippedImageInfos.length }} image(s) were skipped.
            </AlertDescription>
          </Alert>

          <div v-if="skippedImageInfos.length > 0">
            <h4 class="font-semibold mb-2">Skipped Images:</h4>
            <ScrollArea class="h-40 w-full rounded-md border p-2 bg-slate-50 dark:bg-slate-700">
              <ul>
                <li v-for="(skipped, index) in skippedImageInfos" :key="index" class="text-sm py-1">
                  <strong>{{ skipped.filename }}</strong
                  >: {{ skipped.reason }}
                </li>
              </ul>
            </ScrollArea>
          </div>
        </div>
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
      Clear Batch & Start New
    </Button>
  </div>
</template>
