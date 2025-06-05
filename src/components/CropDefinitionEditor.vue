<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useCropStore } from '@/stores/cropStore';
import { detectLargestFace } from '@/services/faceDetector';
import { calculatePixelCropBox } from '@/utils/cropUtils'; // Import the new utility
import ImagePreview from './ImagePreview.vue';
import type { CropParams, FaceDetectionResult } from '@/types'; // CropParams is now percentage based
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2 } from 'lucide-vue-next';

const store = useCropStore();
// definedCropParams from store IS the percentage-based object
const { templateImageUrl, templateFaceResult, definedCropParams } = storeToRefs(store);

// localCropParams directly reflects the structure of definedCropParams from the store
// Initialize with a deep copy from the store's current value
const localCropParams = ref<CropParams>({ ...definedCropParams.value });

const detectionError = ref<string | null>(null);
const isDetecting = ref(false);
const imageElementForDetection = new Image();

// Watcher 1: Local UI (localCropParams) changes -> update store
watch(localCropParams, (newLocalParams) => {
  // Only update the store if the params are actually different,
  // to prevent potential recursive updates if store updates trigger this watcher.
  if (JSON.stringify(newLocalParams) !== JSON.stringify(definedCropParams.value)) {
    store.setCropParams({ ...newLocalParams }); // Send a fresh copy
  }
}, { deep: true });

// Watcher 2: Store (definedCropParams) changes -> update local UI (localCropParams)
watch(definedCropParams, (newStoreParams) => {
  // Only update local if the store's value is actually different from local,
  // to prevent potential recursive updates.
  if (newStoreParams && JSON.stringify(newStoreParams) !== JSON.stringify(localCropParams.value)) {
    localCropParams.value = { ...newStoreParams };
  }
}, { deep: true });

watch(templateImageUrl, async (newUrl) => {
    if (newUrl) {
        isDetecting.value = true;
        detectionError.value = null;
        store.setTemplateFaceResult(null); // Clear previous face result

        imageElementForDetection.onload = async () => {
            try {
                const faceResult = await detectLargestFace(imageElementForDetection);
                store.setTemplateFaceResult(faceResult); // This updates reactive templateFaceResult
                if (!faceResult) {
                    detectionError.value = "No face detected in the template image. Please try another one.";
                }
            } catch (error: any) {
                console.error("Face detection failed in CropDefinitionEditor:", error);
                detectionError.value = `Face detection service failed: ${error.message || 'Unknown error'}`;
            } finally {
                isDetecting.value = false;
            }
        };
        imageElementForDetection.onerror = () => {
            detectionError.value = "Error: Failed to load the template image for processing. The file might be corrupted or an invalid image format.";
            isDetecting.value = false;
            store.setTemplateFaceResult(null);
        };
        imageElementForDetection.src = ''; // Reset src before setting it again
        imageElementForDetection.src = newUrl;
    } else {
        store.setTemplateFaceResult(null);
        isDetecting.value = false;
        detectionError.value = null;
        if (imageElementForDetection) imageElementForDetection.src = '';
    }
}, { immediate: true });


// This computed property calculates the *actual pixel crop box* for the preview
const previewPixelCropBox = computed(() => {
  if (templateFaceResult.value && templateFaceResult.value.boundingBox && localCropParams.value) {
    return calculatePixelCropBox(
      templateFaceResult.value.boundingBox,
      localCropParams.value, // These are the percentage-based params from user input
      templateFaceResult.value.imageWidth,
      templateFaceResult.value.imageHeight
    );
  }
  return null;
});

onUnmounted(() => {
    if (imageElementForDetection) {
        imageElementForDetection.onload = null;
        imageElementForDetection.onerror = null;
        imageElementForDetection.src = '';
    }
});

</script>

<template>
  <div class="space-y-4">
    <ImagePreview
      v-if="templateImageUrl && templateFaceResult"
      :image-url="templateImageUrl"
      :face-result="templateFaceResult"
      :pixel-crop-box-to-draw="previewPixelCropBox"
    />
    <div v-else-if="templateImageUrl && isDetecting" class="w-full aspect-video bg-slate-200 dark:bg-slate-700 rounded flex items-center justify-center">
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
        <p class="ml-2">Detecting face...</p>
    </div>
     <Alert v-else-if="templateImageUrl && !isDetecting && !templateFaceResult" variant="default">
        <AlertTitle>No Face Detected or Error</AlertTitle>
        <AlertDescription>
            {{ detectionError || "Could not detect a face in the template image. Please try a different image." }}
        </AlertDescription>
    </Alert>


    <Alert v-if="isDetecting" variant="default" class="mt-4">
      <Loader2 class="h-4 w-4 animate-spin" />
      <AlertTitle>Analyzing Template</AlertTitle>
      <AlertDescription>
        Detecting face in the template image...
      </AlertDescription>
    </Alert>

    <Alert v-if="!isDetecting && detectionError" variant="destructive" class="mt-4">
      <AlertTitle>Detection Problem</AlertTitle>
      <AlertDescription>{{ detectionError }}</AlertDescription>
    </Alert>

    <Alert v-if="!isDetecting && templateFaceResult && templateFaceResult.detectionCount > 1" variant="default" class="mt-4">
        <AlertTitle>Multiple Faces Detected</AlertTitle>
        <AlertDescription>
            {{ templateFaceResult.detectionCount }} faces were found. The largest face (outlined in red) is used as the reference for cropping.
        </AlertDescription>
    </Alert>

    <div v-if="templateFaceResult" class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
      <div>
        <Label for="crop-top-percent">Top Padding (%)</Label>
        <Input id="crop-top-percent" type="number" v-model.number="localCropParams.topPaddingPercent" min="0" placeholder="e.g., 25" />
      </div>
      <div>
        <Label for="crop-bottom-percent">Bottom Padding (%)</Label>
        <Input id="crop-bottom-percent" type="number" v-model.number="localCropParams.bottomPaddingPercent" min="0" placeholder="e.g., 25" />
      </div>
      <div>
        <Label for="crop-left-percent">Left Padding (%)</Label>
        <Input id="crop-left-percent" type="number" v-model.number="localCropParams.leftPaddingPercent" min="0" placeholder="e.g., 50" />
      </div>
      <div>
        <Label for="crop-right-percent">Right Padding (%)</Label>
        <Input id="crop-right-percent" type="number" v-model.number="localCropParams.rightPaddingPercent" min="0" placeholder="e.g., 50" />
      </div>
    </div>
     <Alert v-else-if="templateImageUrl && !isDetecting" variant="default" class="mt-4">
        <AlertTitle>Define Crop Area</AlertTitle>
        <AlertDescription>
            If a face is detected (outlined in red), you can adjust the percentage-based padding around it using the controls above. These settings will be applied to all batch images.
        </AlertDescription>
    </Alert>
  </div>
</template>
