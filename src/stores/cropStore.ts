// src/stores/cropStore.ts
import { defineStore } from 'pinia';
import type { CropParams, FaceDetectionResult, BatchImageFile } from '@/types';

interface CropState {
  templateImage: File | null;
  templateImageUrl: string | null; // Object URL for preview
  templateFaceResult: FaceDetectionResult | null;
  definedCropParams: CropParams | null;
  batchImages: BatchImageFile[];
  isProcessingBatch: boolean;
  successfullyCroppedCount: number;
  skippedImageInfos: { filename: string; reason: string }[];
}

export const useCropStore = defineStore('crop', {
  state: (): CropState => ({
    templateImage: null,
    templateImageUrl: null,
    templateFaceResult: null,
    definedCropParams: { top: 50, right: 50, bottom: 50, left: 50 }, // Default values
    batchImages: [],
    isProcessingBatch: false,
    successfullyCroppedCount: 0,
    skippedImageInfos: [],
  }),
  actions: {
    setTemplateImage(file: File) {
      this.templateImage = file;
      if (this.templateImageUrl) URL.revokeObjectURL(this.templateImageUrl);
      this.templateImageUrl = URL.createObjectURL(file);
      this.templateFaceResult = null; // Reset face detection on new image
    },
    setTemplateFaceResult(result: FaceDetectionResult | null) {
      this.templateFaceResult = result;
    },
    setCropParams(params: CropParams) {
      this.definedCropParams = params;
    },
    addBatchImages(files: FileList) {
      const newImages: BatchImageFile[] = Array.from(files).map((file, index) => ({
        id: `${Date.now()}-${index}`, // Simple unique ID
        file,
        originalUrl: URL.createObjectURL(file),
        status: 'pending',
      }));
      this.batchImages = [...this.batchImages, ...newImages];
    },
    updateBatchImageStatus(id: string, status: BatchImageFile['status'], croppedBlob?: Blob, skippedReason?: string) {
      const image = this.batchImages.find(img => img.id === id);
      if (image) {
        image.status = status;
        if (croppedBlob) image.croppedBlob = croppedBlob;
        if (skippedReason) image.skippedReason = skippedReason;

        if (status === 'cropped') this.successfullyCroppedCount++;
        if (status === 'skipped' && skippedReason) {
          this.skippedImageInfos.push({ filename: image.file.name, reason: skippedReason });
        }
      }
    },
    startBatchProcessing() {
      this.isProcessingBatch = true;
      this.successfullyCroppedCount = 0;
      this.skippedImageInfos = [];
      this.batchImages.forEach(img => { // Reset status for re-processing
        if(img.status !== 'pending') {
          img.status = 'pending';
          img.croppedBlob = undefined;
          img.skippedReason = undefined;
        }
      });
    },
    finishBatchProcessing() {
      this.isProcessingBatch = false;
    },
    clearBatch() {
      this.batchImages.forEach(img => {
        if (img.originalUrl) URL.revokeObjectURL(img.originalUrl);
      });
      this.batchImages = [];
      this.successfullyCroppedCount = 0;
      this.skippedImageInfos = [];
      this.isProcessingBatch = false;
    },
    resetTemplate() {
        this.templateImage = null;
        if (this.templateImageUrl) URL.revokeObjectURL(this.templateImageUrl);
        this.templateImageUrl = null;
        this.templateFaceResult = null;
        // Optionally reset definedCropParams or keep them
    }
  },
});
