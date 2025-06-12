<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCropStore } from '@/stores/cropStore'
import { detectAllFaces, initializeFaceDetector } from '@/services/faceDetector'
import { calculatePixelCropBox } from '@/utils/cropUtils'
import { createZip, triggerZipDownload } from '@/services/zipService'
import type { BatchImageFile, FaceDetectionResult } from '@/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-vue-next'

// --- DEBUG LOGGING ---
const log = (...args: any[]) => {
  if (import.meta.env.DEV) {
    console.log('[BatchProcessorUI]', ...args)
  }
}

// --- NEW ARCHITECTURE: "Prepare-Then-Process" ---
// This component now uses a two-stage approach to eliminate race conditions.
// STAGE 1 (Preparation): All images are analyzed for faces on the main thread first.
// A simple, flat "to-do list" (cropTaskQueue) of every single crop operation is created.
// STAGE 2 (Processing): This flat queue is fed to the worker pool. The logic is now
// trivial: if a worker is free and a task exists, dispatch it. This is much more
// robust than the previous "resume" logic.

interface CropTask {
  imageFile: File
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  outputFormat: string
  quality: number
  filename: string
  originalFileId: string // To map the result back to the correct BatchImageFile
  faceIndex: number // To create a unique filename for each face
}

const store = useCropStore()
const {
  batchImages,
  definedCropParams,
  isProcessingBatch,
  skippedImageInfos,
  successfullyCroppedImageCount,
  totalIndividualCropsMade,
} = storeToRefs(store)

const MAX_WORKERS = navigator.hardwareConcurrency || 4
const workers: Worker[] = []
const workersInitialized = ref(false)

// --- NEW STATE MANAGEMENT FOR PROCESSING ---
const cropTaskQueue = ref<CropTask[]>([])
const activeWorkersCount = ref(0)
const totalTasksInBatch = ref(0)
let initializeWorkersPromise: Promise<void> | null = null

// Progress calculation is now simpler and more accurate
const overallProgress = computed(() => {
  if (totalTasksInBatch.value === 0) return 0
  const tasksCompleted =
    totalTasksInBatch.value - (cropTaskQueue.value.length + activeWorkersCount.value)
  return (tasksCompleted / totalTasksInBatch.value) * 100
})

// --- WORKER INITIALIZATION ---
// This remains largely the same, but the onmessage handler is simplified.
async function initializeWorkersFn(): Promise<void> {
  if (workersInitialized.value) return Promise.resolve()
  if (initializeWorkersPromise) return initializeWorkersPromise

  log(`Initializing ${MAX_WORKERS} workers...`)
  workers.forEach((w) => w.terminate())
  workers.length = 0

  initializeWorkersPromise = (async () => {
    try {
      for (let i = 0; i < MAX_WORKERS; i++) {
        const worker = new Worker(new URL('/cropWorker.js', import.meta.url), { type: 'module' })

        worker.onmessage = (event) => {
          const {
            status,
            blob,
            error: workerError,
            originalFileId,
            faceIndex,
            filename,
          } = event.data
          log(`[Main] Worker message for ${filename}, face ${faceIndex + 1}: ${status}`)

          activeWorkersCount.value-- // A worker is now free

          if (status === 'cropped' && blob) {
            store.addCroppedBlobToImage(originalFileId, blob, `_face${faceIndex + 1}`)
          } else {
            log(`Worker error for ${filename}, face ${faceIndex + 1}: ${workerError}`)
            store.updateBatchImageStatus(
              originalFileId,
              'error',
              undefined,
              `Face ${faceIndex + 1} crop failed: ${workerError || 'Unknown Error'}`,
            )
          }
          // The key to the new architecture: simply try to process the next task.
          processNextTaskFromQueue()
        }

        worker.onerror = (error) => {
          console.error('Critical worker error:', error)
          activeWorkersCount.value--
          processNextTaskFromQueue()
        }
        workers.push(worker)
      }
      workersInitialized.value = true
      log('Workers initialized successfully.')
    } catch (err) {
      console.error('Failed to initialize workers:', err)
      workersInitialized.value = false
    } finally {
      initializeWorkersPromise = null
    }
  })()
  return initializeWorkersPromise
}

// --- STAGE 1: PREPARATION ---
async function createCropTaskQueue() {
  log('--- Starting Stage 1: Creating Crop Task Queue ---')
  const tasks: CropTask[] = []

  for (const image of store.batchImages) {
    try {
      store.updateBatchImageStatus(image.id, 'processing')
      const imageElement = await loadImageToElement(image.file)
      const faceResult = await detectAllFaces(imageElement)

      console.log(`[DIAGNOSTIC] For ${image.file.name}, face detection result:`, faceResult)

      if (faceResult && faceResult.allDetectedBoundingBoxes.length > 0 && definedCropParams.value) {
        log(`Found ${faceResult.detectionCount} faces in ${image.file.name}.`)

        for (let i = 0; i < faceResult.allDetectedBoundingBoxes.length; i++) {
          const faceBox = faceResult.allDetectedBoundingBoxes[i]
          const pixelCropBox = calculatePixelCropBox(
            faceBox,
            definedCropParams.value,
            imageElement.naturalWidth,
            imageElement.naturalHeight,
          )

          if (pixelCropBox) {
            tasks.push({
              imageFile: image.file, // Pass the actual File object
              sourceX: pixelCropBox.x,
              sourceY: pixelCropBox.y,
              sourceWidth: pixelCropBox.width,
              sourceHeight: pixelCropBox.height,
              outputWidth: pixelCropBox.width,
              outputHeight: pixelCropBox.height,
              outputFormat: 'image/png',
              quality: 0.9,
              filename: image.file.name,
              originalFileId: image.id,
              faceIndex: i,
            })
          }
        }
      } else {
        log(`Skipping ${image.file.name}: No faces detected.`)
        store.updateBatchImageStatus(image.id, 'skipped', 'No faces detected in image.')
      }
    } catch (error: any) {
      log(`Error preparing ${image.file.name}: ${error.message}`)
      store.updateBatchImageStatus(
        image.id,
        'error',
        undefined,
        `Failed to analyze image: ${error.message}`,
      )
    }
  }

  log(`--- Stage 1 Complete. Created ${tasks.length} total crop tasks. ---`)
  cropTaskQueue.value = tasks
  totalTasksInBatch.value = tasks.length
}

// --- STAGE 2: PROCESSING ---
// --- STAGE 2: PROCESSING ---
function processNextTaskFromQueue() {
  // Check for completion: Is the queue empty and are no workers busy?
  if (cropTaskQueue.value.length === 0 && activeWorkersCount.value === 0) {
    log('Queue empty & all workers idle. Finalizing batch.')

    // Final check to update status for all processed images.
    // This ensures images with partial errors but some successes are marked 'cropped'.
    store.batchImages.forEach((img) => {
      // If the image has cropped blobs and wasn't already marked as a total error...
      if (img.croppedBlobs && img.croppedBlobs.length > 0) {
        if (img.status !== 'error') {
          store.updateBatchImageStatus(img.id, 'cropped')
        }
      } else if (img.status === 'processing') {
        // If an image was being processed but yielded no blobs (e.g., all faces were invalid or failed)
        // mark it as 'skipped' so it doesn't stay in the 'processing' state forever.
        store.updateBatchImageStatus(
          img.id,
          'skipped',
          'All detected faces resulted in invalid or failed crops.',
        )
      }
    })

    store.finishBatchProcessing()
    return // Stop the process
  }

  // Check if we can dispatch more tasks: Is there work to do and is a worker free?
  if (cropTaskQueue.value.length > 0 && activeWorkersCount.value < MAX_WORKERS) {
    activeWorkersCount.value++

    // Take the next task from the queue. This is a Vue reactivity proxy.
    const taskProxy = cropTaskQueue.value.shift()!

    // Find an available worker
    const workerIndex = (totalTasksInBatch.value - cropTaskQueue.value.length - 1) % workers.length
    const workerToUse = workers[workerIndex]

    log(
      `Dispatching task for ${taskProxy.filename} (Face ${taskProxy.faceIndex + 1}). Tasks in queue: ${cropTaskQueue.value.length}. Active workers: ${activeWorkersCount.value}`,
    )

    // FIX: Create a new, plain JavaScript object from the proxy to make it cloneable.
    // This strips the non-cloneable Vue reactivity wrapper before sending it to the worker.
    const plainTask = {
      imageFile: taskProxy.imageFile,
      sourceX: taskProxy.sourceX,
      sourceY: taskProxy.sourceY,
      sourceWidth: taskProxy.sourceWidth,
      sourceHeight: taskProxy.sourceHeight,
      outputWidth: taskProxy.outputWidth,
      outputHeight: taskProxy.outputHeight,
      outputFormat: taskProxy.outputFormat,
      quality: taskProxy.quality,
      filename: taskProxy.filename,
      originalFileId: taskProxy.originalFileId,
      faceIndex: taskProxy.faceIndex,
    }

    // Send the plain, cloneable object to the worker.
    workerToUse.postMessage(plainTask)
  }
}

// --- MAIN ORCHESTRATOR ---
async function processBatch() {
  log('Process Batch triggered.')
  if (!definedCropParams.value || batchImages.value.length === 0 || isProcessingBatch.value) {
    return
  }

  await initializeWorkersFn()
  if (!workersInitialized.value || workers.length === 0) {
    alert('Error: Could not initialize processing workers. Please refresh the page.')
    return
  }

  store.startBatchProcessing()

  // Run Stage 1 and wait for it to complete
  await createCropTaskQueue()

  // Kick off Stage 2 by populating the worker pool
  log('--- Starting Stage 2: Processing Task Queue ---')
  for (let i = 0; i < MAX_WORKERS; i++) {
    processNextTaskFromQueue()
  }
}

// --- UTILITY FUNCTIONS (Unchanged) ---

function loadImageToElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = (err) =>
        reject(new Error(`Failed to load image file into element: ${file.name}`))
      if (e.target?.result) img.src = e.target.result as string
      else reject(new Error(`FileReader result was null for file: ${file.name}`))
    }
    reader.onerror = () => reject(new Error(`FileReader failed to read file: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function handleDownloadZip() {
  const filesToZip: { filename: string; blob: Blob }[] = []
  batchImages.value.forEach((img) => {
    if (img.croppedBlobs && img.croppedBlobs.length > 0) {
      const filenameParts = img.file.name.split('.')
      const extension = filenameParts.length > 1 ? filenameParts.pop() || 'png' : 'png'
      const baseFilename = filenameParts.join('.')

      img.croppedBlobs.forEach((cb) => {
        filesToZip.push({
          filename: `cropped_${baseFilename}${cb.filenameSuffix}.${extension}`,
          blob: cb.blob,
        })
      })
    }
  })

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

// --- LIFECYCLE HOOKS ---
onMounted(async () => {
  initializeWorkersFn().catch((err) => {
    console.error('Failed to initialize workers on mount:', err)
  })
  initializeFaceDetector().catch((err) => {
    console.error('Failed to initialize face detector on mount:', err)
    // You could show an error to the user here if you wanted.
    alert(
      'Could not initialize the face detection model. The app may not work correctly. Please check your internet connection and refresh the page.',
    )
  })
})

onUnmounted(() => {
  log('BatchProcessorUI unmounted. Terminating workers.')
  workers.forEach((worker) => worker.terminate())
  workers.length = 0
  cropTaskQueue.value = []
  activeWorkersCount.value = 0
  workersInitialized.value = false
  initializeWorkersPromise = null
})

// Expose the main method to be called by the parent component (App.vue)
defineExpose({
  processBatch,
})
</script>

<template>
  <div class="space-y-6">
    <Button v-if="isProcessingBatch" :disabled="true" class="w-full" aria-live="polite">
      <Loader2 class="mr-2 h-4 w-4 animate-spin" />
      {{
        `Processing... (${totalTasksInBatch - (cropTaskQueue.length + activeWorkersCount)} / ${totalTasksInBatch} faces)`
      }}
    </Button>

    <div v-if="batchImages.length > 0">
      <h3 class="text-lg font-medium mb-2">Overall Progress (Faces)</h3>
      <Progress :model-value="overallProgress" class="w-full" />
      <p class="text-sm text-slate-600 dark:text-slate-400 mt-1 text-center">
        {{ successfullyCroppedImageCount }} images with crops / {{ totalIndividualCropsMade }} total
        faces cropped / {{ batchImages.filter((img) => img.status === 'skipped').length }} images
        skipped
      </p>
    </div>

    <Card
      v-if="
        !isProcessingBatch &&
        (skippedImageInfos.length > 0 ||
          successfullyCroppedImageCount > 0 ||
          batchImages.some((img) => img.status === 'error'))
      "
    >
      <CardHeader>
        <CardTitle>Batch Processing Complete</CardTitle>
        <CardDescription>
          Processing finished. {{ successfullyCroppedImageCount }} image(s) yielded successful crops
          (total of {{ totalIndividualCropsMade }} faces cropped).
          {{ batchImages.filter((img) => img.status === 'skipped').length }} image(s) were skipped
          entirely.
          {{
            batchImages.filter(
              (img) =>
                img.status === 'error' && (!img.croppedBlobs || img.croppedBlobs.length === 0),
            ).length
          }}
          image(s) encountered errors without any successful crops.
        </CardDescription>
      </CardHeader>
      <CardContent
        v-if="skippedImageInfos.length > 0 || batchImages.some((img) => img.status === 'error')"
      >
        <h4 class="font-semibold mb-2">Details for Skipped/Errored Images:</h4>
        <ScrollArea class="h-40 w-full rounded-md border p-2 bg-slate-50 dark:bg-slate-700">
          <ul>
            <li
              v-for="skipped in skippedImageInfos"
              :key="skipped.filename + '-skip-' + skipped.reason"
              class="text-sm py-1 text-amber-700 dark:text-amber-500"
            >
              <strong>{{ skipped.filename }} (Skipped)</strong>: {{ skipped.reason }}
            </li>
            <li
              v-for="imageWithError in batchImages.filter((img) => img.status === 'error')"
              :key="imageWithError.id + '-error'"
              class="text-sm py-1 text-red-700 dark:text-red-500"
            >
              <strong>{{ imageWithError.file.name }} (Error)</strong>:
              {{ imageWithError.errorMessage || 'An unspecified error occurred.' }}
              <span v-if="imageWithError.croppedBlobs && imageWithError.croppedBlobs.length > 0">
                (However, {{ imageWithError.croppedBlobs.length }} faces were successfully cropped
                from this image.)</span
              >
            </li>
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>

    <Button
      v-if="!isProcessingBatch && totalIndividualCropsMade > 0"
      @click="handleDownloadZip"
      class="w-full mt-4"
    >
      Download {{ totalIndividualCropsMade }} Cropped Faces as ZIP
    </Button>
  </div>
</template>
