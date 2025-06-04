<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCropStore } from './stores/cropStore';
import ImageUploader from './components/ImageUploader.vue';
import CropDefinitionEditor from './components/CropDefinitionEditor.vue';
import BatchProcessorUI from './components/BatchProcessorUI.vue';
import { Button } from '@/components/ui/button'; // Shadcn-vue component

const store = useCropStore();
const { templateImage, definedCropParams, batchImages } = storeToRefs(store);

// Simple step management
const currentStep = ref(1); // 1: Define Crop, 2: Upload Batch, 3: Process & Download

watch(definedCropParams, (newVal) => {
  if (newVal && templateImage.value) {
    // Could automatically move to next step, or user clicks a button
  }
});

function proceedToBatchUpload() {
  if (store.templateFaceResult && store.definedCropParams) {
    currentStep.value = 2;
  } else {
    alert("Please ensure a face is detected and crop parameters are set.");
  }
}
function proceedToProcessing() {
  if (store.batchImages.length > 0) {
    currentStep.value = 3;
  } else {
    alert("Please upload batch images.");
  }
}
function resetApp() {
  store.resetTemplate();
  store.clearBatch();
  currentStep.value = 1;
}
</script>

<template>
  <div class="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-50 p-4 md:p-8">
    <header class="text-center mb-8">
      <h1 class="text-3xl md:text-4xl font-bold">Face-Centered Bulk Image Cropper</h1>
      <Button v-if="currentStep > 1" @click="resetApp" variant="outline" class="mt-4">Start Over</Button>
    </header>

    <main class="max-w-4xl mx-auto space-y-6">
      <!-- Step 1: Define Crop -->
      <section v-if="currentStep === 1" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4">Step 1: Define Crop with Template Image</h2>
        <ImageUploader :mode="'template'" class="mb-4" />
        <CropDefinitionEditor v-if="templateImage" />
        <Button v-if="templateImage && store.templateFaceResult" @click="proceedToBatchUpload" class="mt-4 w-full">
          Set Crop & Proceed to Batch Upload
        </Button>
         <p v-if="templateImage && !store.templateFaceResult && !store.isProcessingBatch" class="text-amber-600 dark:text-amber-400 mt-2">
            Detecting face... If no face is detected, please try another template image.
        </p>
      </section>

      <!-- Step 2: Upload Batch -->
      <section v-if="currentStep === 2" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4">Step 2: Upload Batch Images</h2>
        <ImageUploader :mode="'batch'" />
        <Button v-if="batchImages.length > 0" @click="proceedToProcessing" class="mt-4 w-full">
          Process Batch ({{ batchImages.length }} images)
        </Button>
        <Button @click="currentStep = 1" variant="outline" class="mt-2 w-full">Back to Define Crop</Button>
      </section>

      <!-- Step 3: Process & Download -->
      <section v-if="currentStep === 3" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4">Step 3: Process & Download</h2>
        <BatchProcessorUI />
        <Button @click="currentStep = 2" variant="outline" class="mt-4 w-full">Back to Batch Upload</Button>
      </section>
    </main>

    <footer class="text-center mt-12 text-sm text-slate-600 dark:text-slate-400">
      <p>Powered by Vue, Mediapipe & Shadcn-vue</p>
    </footer>
  </div>
</template>
