<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useCropStore } from '@/stores/cropStore'
import { detectAllFaces } from '@/services/faceDetector'
import { calculatePixelCropBox } from '@/utils/cropUtils'
import { createZip, triggerZipDownload } from '@/services/zipService'
import type { BatchImageFile, FaceDetectionResult } from '@/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-vue-next'

// --- START DEBUG ---
const DEBUG = true
const log = (...args: any[]) => DEBUG && console.log('[BatchProcessorUI]', ...args)
// --- END DEBUG ---

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
type QueueItem = BatchImageFile | { resumeImage: BatchImageFile; resumeFaceIndex: number }
let imageQueue: QueueItem[] = []
let activeWorkersCount = 0
const imageProcessState = ref<
  Record<
    string,
    {
      totalOriginalFaces: number
      facesDispatchedToWorker: number
      facesReportedByWorker: number
      facesSkippedLocally: number
    }
  >
>({})

const workersInitialized = ref(false)
let initializeWorkersPromise: Promise<void> | null = null

const overallProgress = computed(() => {
  if (batchImages.value.length === 0) return 0
  const processedImagesCount = batchImages.value.filter(
    (img) => img.status === 'cropped' || img.status === 'skipped' || img.status === 'error',
  ).length
  return (processedImagesCount / batchImages.value.length) * 100
})

async function initializeWorkersFn(): Promise<void> {
  log('Attempting to initialize workers. Max:', MAX_WORKERS)
  if (workersInitialized.value && workers.length === MAX_WORKERS) {
    log('Workers already successfully initialized.')
    return Promise.resolve()
  }
  if (initializeWorkersPromise) {
    log('Worker initialization already in progress, returning existing promise.')
    return initializeWorkersPromise
  }

  workers.forEach((w) => w.terminate())
  workers.length = 0
  workersInitialized.value = false

  initializeWorkersPromise = (async () => {
    try {
      for (let i = 0; i < MAX_WORKERS; i++) {
        const worker = new Worker(new URL('/cropWorker.js', import.meta.url), { type: 'module' })
        worker.onmessage = (event) => {
          const {
            status,
            blob,
            filename,
            error: workerError,
            originalFileId,
            faceIndex,
          } = event.data
          log(
            `Worker message for ${filename}, originalFileId: ${originalFileId}, faceIndex: ${faceIndex}, status: ${status}`,
          )

          if (activeWorkersCount > 0) activeWorkersCount--
          log(`Active workers after message: ${activeWorkersCount}`)

          if (originalFileId && imageProcessState.value[originalFileId]) {
            imageProcessState.value[originalFileId].facesReportedByWorker++
            const state = imageProcessState.value[originalFileId]
            log(
              `Image ${originalFileId} face reported. State: Dispatched=${state.facesDispatchedToWorker}, Reported=${state.facesReportedByWorker}, SkippedLocally=${state.facesSkippedLocally}, TotalOriginal=${state.totalOriginalFaces}`,
            )

            if (status === 'cropped' && blob) {
              store.addCroppedBlobToImage(
                originalFileId,
                blob,
                `_face${faceIndex !== undefined ? faceIndex + 1 : 'unknown'}`,
              )
            } else {
              log(`Worker error for ${filename}, face ${faceIndex}: ${workerError || 'Unknown'}`)
              store.updateBatchImageStatus(
                originalFileId,
                'error',
                undefined,
                `Face ${faceIndex !== undefined ? faceIndex + 1 : 'unknown'} crop failed: ${workerError || 'Error'}`,
              )
            }

            const totalAccountedFor = state.facesReportedByWorker + state.facesSkippedLocally
            if (totalAccountedFor >= state.totalOriginalFaces) {
              log(`All ${state.totalOriginalFaces} faces accounted for image ${originalFileId}.`)
              const img = batchImages.value.find((i) => i.id === originalFileId)
              if (img && img.status !== 'error' && img.status !== 'skipped') {
                if (img.croppedBlobs && img.croppedBlobs.length > 0) {
                  store.updateBatchImageStatus(originalFileId, 'cropped')
                } else {
                  store.updateBatchImageStatus(
                    originalFileId,
                    'skipped',
                    'No faces were successfully cropped (all failed or were invalid).',
                  )
                }
              }
            }
          } else {
            log(
              `Error: No process state for originalFileId: ${originalFileId} from worker message. File: ${filename}`,
            )
          }

          processNextImageFromQueue()
        }
        worker.onerror = (error) => {
          log('Critical worker error:', error)
          if (activeWorkersCount > 0) activeWorkersCount--
          processNextImageFromQueue()
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

async function processImageFaces(imageFile: BatchImageFile, startingFaceIndex: number = 0) {
  log(
    `processImageFaces START for ${imageFile.file.name} (ID: ${imageFile.id}), starting face index ${startingFaceIndex}`,
  )

  if (!workersInitialized.value || workers.length === 0) {
    log(
      `processImageFaces for ${imageFile.file.name}: Workers not ready. Updating status to error.`,
    )
    store.updateBatchImageStatus(
      imageFile.id,
      'error',
      undefined,
      'Internal error: Workers not ready.',
    )
    return
  }

  let imageElement: HTMLImageElement | null = null
  let faceDetectionResult: FaceDetectionResult | null = null
  let localErrorOccurred = false

  try {
    log(`processImageFaces: Loading image "${imageFile.file.name}" into element.`)
    imageElement = await loadImageToElement(imageFile.file)
    log(
      `processImageFaces: loadImageToElement completed for "${imageFile.file.name}". imageElement defined: ${!!imageElement}, naturalWidth: ${imageElement?.naturalWidth}`,
    )

    if (!imageElement || imageElement.naturalWidth === 0) {
      log(`processImageFaces: CRITICAL - loadImageToElement invalid for "${imageFile.file.name}".`)
      throw new Error(`Failed to load image data for ${imageFile.file.name}`)
    }

    log(`processImageFaces: Calling detectAllFaces for "${imageFile.file.name}".`)
    faceDetectionResult = await detectAllFaces(imageElement)
    log(
      `processImageFaces: detectAllFaces completed for "${imageFile.file.name}". Result:`,
      faceDetectionResult ? `${faceDetectionResult.detectionCount} faces` : 'null',
    )

    if (
      faceDetectionResult &&
      faceDetectionResult.allDetectedBoundingBoxes.length > 0 &&
      definedCropParams.value
    ) {
      const allFaces = faceDetectionResult.allDetectedBoundingBoxes
      log(
        `${imageFile.file.name}: Found ${allFaces.length} total faces. Processing from index ${startingFaceIndex}.`,
      )

      if (!imageProcessState.value[imageFile.id] || startingFaceIndex === 0) {
        imageProcessState.value[imageFile.id] = {
          totalOriginalFaces: allFaces.length,
          facesDispatchedToWorker: 0,
          facesReportedByWorker: 0,
          facesSkippedLocally: 0,
        }
      }
      const currentState = imageProcessState.value[imageFile.id]
      currentState.totalOriginalFaces = allFaces.length

      for (let i = startingFaceIndex; i < allFaces.length; i++) {
        if (activeWorkersCount >= MAX_WORKERS) {
          log(`Workers full. Re-queuing ${imageFile.file.name} to resume from face index ${i}.`)
          imageQueue.unshift({ resumeImage: imageFile, resumeFaceIndex: i })
          return
        }

        const faceBox = allFaces[i]
        const pixelCropSourceBox = calculatePixelCropBox(
          faceBox,
          definedCropParams.value,
          imageElement.naturalWidth,
          imageElement.naturalHeight,
        )

        if (pixelCropSourceBox) {
          activeWorkersCount++
          currentState.facesDispatchedToWorker++
          const workerIndex = (currentState.facesDispatchedToWorker - 1) % workers.length
          const workerToUse = workers[workerIndex]

          log(
            `Dispatching ${imageFile.file.name} - Face ${i + 1} (index ${i}). Active: ${activeWorkersCount}`,
          )
          workerToUse.postMessage({
            imageFile: imageFile.file,
            sourceX: pixelCropSourceBox.x,
            sourceY: pixelCropSourceBox.y,
            sourceWidth: pixelCropSourceBox.width,
            sourceHeight: pixelCropSourceBox.height,
            outputWidth: pixelCropSourceBox.width,
            outputHeight: pixelCropSourceBox.height,
            outputFormat: 'image/png',
            quality: 0.9,
            filename: imageFile.file.name,
            originalFileId: imageFile.id,
            faceIndex: i,
          })
        } else {
          log(`Skipping face ${i + 1} in ${imageFile.file.name} (invalid local crop box).`)
          currentState.facesSkippedLocally++
        }
      }

      const dispatchInfo = imageProcessState.value[imageFile.id]
      if (
        dispatchInfo.facesDispatchedToWorker === 0 &&
        allFaces.length > 0 &&
        startingFaceIndex === 0
      ) {
        log(`${imageFile.file.name}: No faces were dispatched (all invalid).`)
        store.updateBatchImageStatus(
          imageFile.id,
          'skipped',
          `All ${allFaces.length} detected faces resulted in invalid crop dimensions.`,
        )
      }
    } else {
      let reason = 'No faces detected in image (or no valid bounding boxes returned).'
      if (!definedCropParams.value) reason = 'Crop parameters not defined.'
      log(`Skipping ${imageFile.file.name}: ${reason}`)
      store.updateBatchImageStatus(imageFile.id, 'skipped', reason)
      if (!imageProcessState.value[imageFile.id]) {
        imageProcessState.value[imageFile.id] = {
          totalOriginalFaces: 0,
          facesDispatchedToWorker: 0,
          facesReportedByWorker: 0,
          facesSkippedLocally: 0,
        }
      }
    }
  } catch (error: any) {
    localErrorOccurred = true
    log(
      `CRITICAL Error during main thread processing for ${imageFile.file.name}:`,
      error.message,
      error.stack,
    )
    store.updateBatchImageStatus(
      imageFile.id,
      'error',
      undefined,
      `Main thread error processing ${imageFile.file.name}: ${error.message}`,
    )
  } finally {
    log(`processImageFaces FINALLY for ${imageFile.file.name}.`)
    const currentState = imageProcessState.value[imageFile.id]
    const wasReQueued = imageQueue.some((item) =>
      typeof item === 'string'
        ? false
        : 'resumeImage' in item && item.resumeImage.id === imageFile.id,
    )

    if (!wasReQueued) {
      let shouldTriggerPNIQ = false
      if (localErrorOccurred) {
        log(`processImageFaces for ${imageFile.file.name} had local error. Triggering PNIQ.`)
        shouldTriggerPNIQ = true
      } else if (currentState && currentState.facesDispatchedToWorker === 0) {
        log(`processImageFaces for ${imageFile.file.name}: No tasks dispatched. Triggering PNIQ.`)
        shouldTriggerPNIQ = true
      } else if (!currentState && !faceDetectionResult) {
        log(
          `processImageFaces for ${imageFile.file.name}: No face detection result and no state. Triggering PNIQ.`,
        )
        shouldTriggerPNIQ = true
      }

      if (shouldTriggerPNIQ) {
        processNextImageFromQueue()
      } else {
        log(
          `processImageFaces for ${imageFile.file.name}: Tasks were dispatched or re-queued. PNIQ will be called by workers.`,
        )
      }
    } else {
      log(
        `processImageFaces for ${imageFile.file.name} was re-queued. PNIQ will be triggered by other events.`,
      )
    }
  }
}

async function processNextImageFromQueue() {
  log(`PNIQ Start. Queue: ${imageQueue.length}, Active Workers: ${activeWorkersCount}`)
  if (imageQueue.length === 0 && activeWorkersCount === 0) {
    log('PNIQ: Queue empty & workers idle. Finishing batch.')
    store.finishBatchProcessing()
    return
  }
  if (activeWorkersCount >= MAX_WORKERS && imageQueue.length > 0) {
    log('PNIQ: Workers full. Waiting for a worker to free up.')
    return
  }
  if (imageQueue.length === 0) {
    log(`PNIQ: Queue empty, but ${activeWorkersCount} workers still active. Waiting.`)
    return
  }

  const nextItem = imageQueue[0] // Peek
  if (!nextItem) {
    log('PNIQ: Queue had an item, but it was null/undefined. This should not happen. Trying again.')
    imageQueue.shift() // Remove the bad item
    processNextImageFromQueue()
    return
  }

  imageQueue.shift() // Now take it for real

  if (typeof nextItem === 'object' && 'resumeImage' in nextItem) {
    log(
      `PNIQ: Resuming image ${nextItem.resumeImage.file.name} from face index ${nextItem.resumeFaceIndex}`,
    )
    await processImageFaces(nextItem.resumeImage, nextItem.resumeFaceIndex)
  } else {
    const imageFile = nextItem as BatchImageFile
    if (imageFile.status === 'pending') {
      store.updateBatchImageStatus(imageFile.id, 'processing')
      log(`PNIQ: Processing new image ${imageFile.file.name}`)
      await processImageFaces(imageFile)
    } else {
      log(
        `PNIQ: Image ${imageFile.file.name} status is ${imageFile.status}, not 'pending'. Trying next.`,
      )
      processNextImageFromQueue()
    }
  }
}

async function processBatch() {
  log('Process Batch button clicked.')
  if (!definedCropParams.value || batchImages.value.length === 0 || isProcessingBatch.value) {
    log('Process Batch: Conditions not met or already processing.')
    return
  }

  await initializeWorkersFn()
  if (!workersInitialized.value || workers.length === 0) {
    log('Process Batch: Worker initialization failed. Cannot start batch.')
    alert('Error: Could not initialize processing workers. Please try refreshing the page.')
    return
  }

  imageProcessState.value = {}
  store.startBatchProcessing()
  imageQueue = batchImages.value
    .filter((img) => img.status === 'pending')
    .map((img) => ({ ...img }))
  log('Process Batch: Initializing queue with pending items:', imageQueue.length)

  for (let i = 0; i < MAX_WORKERS; i++) {
    if (imageQueue.length > 0 && activeWorkersCount < MAX_WORKERS) {
      processNextImageFromQueue()
    } else {
      break
    }
  }
}

function loadImageToElement(file: File): Promise<HTMLImageElement> {
  log(`loadImageToElement: Starting for file "${file.name}"`)
  return new Promise((resolve, reject) => {
    if (!(file instanceof File)) {
      log(
        `loadImageToElement: CRITICAL - input is not a File object for "${file?.name || 'unknown file'}"`,
      )
      reject(new Error(`Invalid input: not a File object for "${file?.name || 'unknown file'}"`))
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      log(`loadImageToElement: FileReader onload for "${file.name}"`)
      const img = new Image()
      img.onload = () => {
        log(
          `loadImageToElement: HTMLImageElement onload for "${file.name}". Dimensions: ${img.naturalWidth}x${img.naturalHeight}. Resolving.`,
        )
        resolve(img)
      }
      img.onerror = (errEvent) => {
        log(`loadImageToElement: HTMLImageElement onerror for "${file.name}".`, errEvent)
        reject(new Error(`Failed to load image file "${file.name}" into HTMLImageElement.`))
      }
      if (e.target?.result) {
        img.src = e.target.result as string
      } else {
        log(`loadImageToElement: FileReader result was null for "${file.name}". Rejecting.`)
        reject(new Error(`FileReader result was null for file "${file.name}".`))
      }
    }
    reader.onerror = (errEvent) => {
      log(`loadImageToElement: FileReader onerror for "${file.name}".`, errEvent)
      reject(new Error(`FileReader failed to read file "${file.name}".`))
    }
    reader.readAsDataURL(file)
  })
}

async function handleDownloadZip() {
  const filesToZip: { filename: string; blob: Blob }[] = []
  batchImages.value.forEach((img) => {
    if (
      (img.status === 'cropped' ||
        (img.status === 'error' && img.croppedBlobs && img.croppedBlobs.length > 0)) &&
      img.croppedBlobs &&
      img.croppedBlobs.length > 0
    ) {
      const filenameParts = img.file.name.split('.')
      const extension = filenameParts.length > 1 ? filenameParts.pop() || 'png' : 'png'
      const baseFilename = filenameParts.join('.') || img.file.name

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

onMounted(async () => {
  initializeWorkersFn().catch((err) => {
    console.error('Failed to initialize workers on mount:', err)
  })
})

onUnmounted(() => {
  log('BatchProcessorUI unmounted. Terminating workers.')
  workers.forEach((worker) => worker.terminate())
  workers.length = 0
  imageQueue = []
  activeWorkersCount = 0
  workersInitialized.value = false
  initializeWorkersPromise = null
})

defineExpose({
  processBatch,
})
</script>

<template>
  <div class="space-y-6">
    <Button :disabled="true" class="w-full" aria-live="polite">
      <Loader2 v-if="isProcessingBatch" class="mr-2 h-4 w-4 animate-spin" />
      {{
        isProcessingBatch
          ? `Processing ${activeWorkersCount} active tasks... (${imageQueue.length} items pending in queue)`
          : 'Starting...'
      }}
    </Button>

    <div v-if="batchImages.length > 0 || isProcessingBatch">
      <h3 class="text-lg font-medium mb-2">Overall Progress (Images)</h3>
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
