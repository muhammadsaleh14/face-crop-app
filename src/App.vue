<script setup lang="ts">
import { useHead } from '@vueuse/head' //
import { ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useCropStore } from './stores/cropStore'
import ImageUploader from './components/ImageUploader.vue'
import CropDefinitionEditor from './components/CropDefinitionEditor.vue'
import BatchProcessorUI from './components/BatchProcessorUI.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

useHead({
  title: 'Face-Centered Bulk Image Cropper | Automatic & Fast',
  meta: [
    {
      name: 'description',
      content:
        'Quickly crop hundreds of images around detected faces. Define a crop template, upload a batch, and download a ZIP. Perfect for profile pictures and team photos. Free & private.',
    },
    // Open Graph (for social sharing like Facebook, LinkedIn)
    { property: 'og:title', content: 'Face-Centered Bulk Image Cropper' },
    {
      property: 'og:description',
      content: 'Automatically crop batch images around faces with custom padding.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:image', content: 'https://freebulkfacecropapp.netlify.app/social-preview.png' }, // IMPORTANT: We will create this
    // Twitter Card
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'Face-Centered Bulk Image Cropper' },
    {
      name: 'twitter:description',
      content: 'Automatically crop batch images around faces with custom padding.',
    },
    {
      name: 'twitter:image',
      content: 'https://freebulkfacecropapp.netlify.app/social-preview.png',
    },
  ],
})

const store = useCropStore()
const { templateImage, batchImages } = storeToRefs(store)

const currentStep = ref(1) // 1: Define Crop, 2: Upload Batch, 3: Process & Download
const batchProcessorUIRef = ref<InstanceType<typeof BatchProcessorUI> | null>(null)

function proceedToBatchUpload() {
  if (store.templateFaceResult && store.definedCropParams) {
    currentStep.value = 2
  } else {
    alert('Please ensure a face is detected and crop parameters are set.')
  }
}

// MODIFIED: This now goes to the final step and triggers processing
function proceedToProcessing() {
  if (store.batchImages.length > 0) {
    currentStep.value = 3
    // Use nextTick to ensure the BatchProcessorUI component is mounted before we call its method
    nextTick(() => {
      batchProcessorUIRef.value?.processBatch()
    })
  } else {
    alert('Please upload batch images.')
  }
}

function resetApp() {
  store.resetTemplate()
  store.clearBatch()
  currentStep.value = 1
}
</script>

<template>
  <div
    class="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-50 p-4 md:p-8"
  >
    <header class="text-center mb-8">
      <h1 class="text-3xl md:text-4xl font-bold">Face-Centered Bulk Image Cropper</h1>
      <Button v-if="currentStep > 1" @click="resetApp" variant="outline" class="mt-4"
        >Start Over</Button
      >
    </header>

    <main class="max-w-4xl mx-auto space-y-6">
      <!-- Step 1: Define Crop -->
      <section v-if="currentStep === 1" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <!-- NEW: Onboarding Text -->
        <Card class="mb-6 border-dashed">
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent class="text-sm space-y-2">
            <p>
              <strong>1. Define Crop:</strong> Upload a template image. If multiple faces are found,
              the largest is used to define the crop. Drag the blue border to set padding.
            </p>
            <p>
              <strong>2. Upload Batch:</strong> Upload images. If an image has multiple faces, each
              will be cropped separately.
            </p>
            <p>
              <strong>3. Process & Download:</strong> All detected faces from your batch images will
              be cropped according to your template settings. Download as a ZIP.
            </p>
          </CardContent>
        </Card>

        <h2 class="text-2xl font-semibold mb-4">Step 1: Define Crop with Template Image</h2>
        <ImageUploader :mode="'template'" class="mb-4" />
        <CropDefinitionEditor v-if="templateImage" />
        <Button
          v-if="templateImage && store.templateFaceResult"
          @click="proceedToBatchUpload"
          class="mt-4 w-full"
        >
          Set Crop & Proceed to Batch Upload
        </Button>
      </section>

      <!-- Step 2: Upload Batch -->
      <section v-if="currentStep === 2" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4">Step 2: Upload Batch Images</h2>
        <ImageUploader :mode="'batch'" />
        <Button v-if="batchImages.length > 0" @click="proceedToProcessing" class="mt-4 w-full">
          Process Batch ({{ batchImages.length }} images)
        </Button>
        <Button @click="currentStep = 1" variant="outline" class="mt-2 w-full"
          >Back to Define Crop</Button
        >
      </section>

      <!-- Step 3: Process & Download -->
      <section v-if="currentStep === 3" class="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4">Step 3: Processing & Download</h2>
        <BatchProcessorUI ref="batchProcessorUIRef" />
        <Button @click="currentStep = 2" variant="outline" class="mt-4 w-full"
          >Back to Batch Upload</Button
        >
      </section>
    </main>
  </div>
</template>
