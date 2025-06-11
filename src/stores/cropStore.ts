import { defineStore } from 'pinia'
import type { CropParams, FaceDetectionResult, BatchImageFile } from '@/types'

// --- START DEBUG ---
const DEBUG = true
const log = (...args: any[]) => DEBUG && console.log('[CropStore]', ...args)
// --- END DEBUG ---

interface CropState {
  templateImage: File | null
  templateImageUrl: string | null
  templateFaceResult: FaceDetectionResult | null
  definedCropParams: CropParams
  batchImages: BatchImageFile[]
  isProcessingBatch: boolean
  successfullyCroppedImageCount: number
  totalIndividualCropsMade: number
  skippedImageInfos: { filename: string; reason: string }[]
}

export const useCropStore = defineStore('crop', {
  state: (): CropState => ({
    templateImage: null,
    templateImageUrl: null,
    templateFaceResult: null,
    definedCropParams: {
      leftPaddingPercent: 50,
      rightPaddingPercent: 50,
      topPaddingPercent: 25,
      bottomPaddingPercent: 25,
    },
    batchImages: [],
    isProcessingBatch: false,
    successfullyCroppedImageCount: 0,
    totalIndividualCropsMade: 0,
    skippedImageInfos: [],
  }),
  actions: {
    setTemplateImage(file: File) {
      log('setTemplateImage', file.name)
      this.templateImage = file
      if (this.templateImageUrl) URL.revokeObjectURL(this.templateImageUrl)
      this.templateImageUrl = URL.createObjectURL(file)
      this.templateFaceResult = null
    },
    setTemplateFaceResult(result: FaceDetectionResult | null) {
      log('setTemplateFaceResult', result)
      this.templateFaceResult = result
    },
    setCropParams(params: CropParams) {
      log('setCropParams', params)
      this.definedCropParams = params
    },
    addBatchImages(files: FileList) {
      log('addBatchImages, count:', files.length)
      const newImages: BatchImageFile[] = Array.from(files).map((file, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`, // More unique ID
        file,
        originalUrl: URL.createObjectURL(file),
        status: 'pending',
        croppedBlobs: [],
        skippedReason: undefined,
        errorMessage: undefined,
      }))
      this.batchImages = [...this.batchImages, ...newImages]
      log('Batch images updated', this.batchImages.length)
    },

    updateBatchImageStatus(
      id: string,
      status: BatchImageFile['status'],
      skippedReason?: string,
      errorMessage?: string,
    ) {
      const image = this.batchImages.find((img) => img.id === id)
      if (image) {
        log(
          `updateBatchImageStatus: ID ${id}, Current status ${image.status}, New status ${status}, Reason: ${skippedReason}, Error: ${errorMessage}`,
        )
        // Allow updating to 'error' even if already 'cropped' or 'skipped' (if an error occurs late)
        // Allow updating from 'processing' to any other state.
        // Don't revert from a final state (cropped, skipped, error) to 'processing' or 'pending' unless it's a reset.
        if (
          image.status === 'pending' ||
          image.status === 'processing' ||
          status === 'error' ||
          (image.status !== 'error' && (status === 'cropped' || status === 'skipped'))
        ) {
          image.status = status
        }

        if (skippedReason) image.skippedReason = skippedReason
        if (errorMessage) image.errorMessage = errorMessage

        if (status === 'skipped' && skippedReason) {
          if (
            !this.skippedImageInfos.find(
              (info) => info.filename === image.file.name && info.reason === skippedReason,
            )
          ) {
            this.skippedImageInfos.push({ filename: image.file.name, reason: skippedReason })
          }
        }
      } else {
        log(`updateBatchImageStatus: Image with ID ${id} not found.`)
      }
    },

    addCroppedBlobToImage(imageId: string, blob: Blob, filenameSuffix: string) {
      const image = this.batchImages.find((img) => img.id === imageId)
      if (image) {
        log(`addCroppedBlobToImage: ID ${imageId}, Suffix: ${filenameSuffix}`)
        if (!image.croppedBlobs) {
          image.croppedBlobs = []
        }
        image.croppedBlobs.push({ blob, filenameSuffix })
        this.totalIndividualCropsMade++ // Increment for every successful blob

        // If the image wasn't already marked as error/skipped, mark it as cropped.
        if (image.status !== 'error' && image.status !== 'skipped') {
          image.status = 'cropped'
        }
      } else {
        log(`addCroppedBlobToImage: Image with ID ${imageId} not found for adding blob.`)
      }
    },

    startBatchProcessing() {
      log('startBatchProcessing')
      this.isProcessingBatch = true
      this.successfullyCroppedImageCount = 0
      this.totalIndividualCropsMade = 0
      this.skippedImageInfos = []
      this.batchImages.forEach((img) => {
        img.status = 'pending'
        img.croppedBlobs = []
        img.skippedReason = undefined
        img.errorMessage = undefined
      })
    },

    finishBatchProcessing() {
      log('finishBatchProcessing')
      this.isProcessingBatch = false
      // successfullyCroppedImageCount is number of images that have at least one successful crop
      // and are not in an 'error' or 'skipped' state.
      this.successfullyCroppedImageCount = this.batchImages.filter(
        (img) => img.status === 'cropped' && img.croppedBlobs && img.croppedBlobs.length > 0,
      ).length
      log(
        `Batch finished. Total individual crops: ${this.totalIndividualCropsMade}, Images with crops: ${this.successfullyCroppedImageCount}`,
      )
    },

    clearBatch() {
      log('clearBatch')
      this.batchImages.forEach((img) => {
        if (img.originalUrl) URL.revokeObjectURL(img.originalUrl)
      })
      this.batchImages = []
      this.successfullyCroppedImageCount = 0
      this.totalIndividualCropsMade = 0
      this.skippedImageInfos = []
      this.isProcessingBatch = false
    },

    resetTemplate() {
      log('resetTemplate')
      this.templateImage = null
      if (this.templateImageUrl) URL.revokeObjectURL(this.templateImageUrl)
      this.templateImageUrl = null
      this.templateFaceResult = null
    },
  },
})
