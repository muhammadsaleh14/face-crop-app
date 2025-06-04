<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useCropStore } from '@/stores/cropStore';
import { detectLargestFace } from '@/services/faceDetector';
import ImagePreview from './ImagePreview.vue';
import type { CropParams } from '@/types'; // Make sure CropParams can't be null here
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2 } from 'lucide-vue-next';

const store = useCropStore();
const { templateImageUrl, templateFaceResult, definedCropParams } = storeToRefs(store);

// Initialize localCropParams from the store or use defaults.
// Ensure localCropParams always holds a CropParams object, not null.
const initialCropParams = definedCropParams.value
  ? { ...definedCropParams.value }
  : { top: 100, right: 100, bottom: 100, left: 100 };
const localCropParams = ref<CropParams>({ ...initialCropParams }); // Always a full object

const detectionError = ref<string | null>(null);
const isDetecting = ref(false);

const imageElementForDetection = new Image();

// Watcher 1: Local UI changes (localCropParams) -> update store
watch(localCropParams, (newLocalParams) => {
  // console.log('localCropParams changed, updating store:', newLocalParams);
  store.setCropParams({ ...newLocalParams }); // Send a fresh copy to the store
}, { deep: true });

// Watcher 2: Store changes (definedCropParams) -> update local UI (localCropParams)
watch(definedCropParams, (newStoreParams) => {
  if (newStoreParams) {
    // console.log('definedCropParams from store changed:', newStoreParams);
    // Only update localCropParams if the values are actually different
    if (
      localCropParams.value.top !== newStoreParams.top ||
      localCropParams.value.right !== newStoreParams.right ||
      localCropParams.value.bottom !== newStoreParams.bottom ||
      localCropParams.value.left !== newStoreParams.left
    ) {
      // console.log('Store is different, updating localCropParams.');
      localCropParams.value = { ...newStoreParams };
    }
  }
  // If newStoreParams is null, localCropParams retains its current value or you could reset to defaults:
  // else { localCropParams.value = { top: 100, right: 100, bottom: 100, left: 100 }; }
}, { deep: true });


watch(templateImageUrl, async (newUrl, oldUrl) => {
  // console.log(`templateImageUrl watcher: new=${newUrl}, old=${oldUrl}`);
  if (newUrl) {
    // Prevent re-processing if the URL hasn't actually changed,
    // unless explicitly needed (e.g. forcing re-detection).
    // if (newUrl === oldUrl && !isDetecting.value && (templateFaceResult.value || detectionError.value)) return;

    isDetecting.value = true;
    detectionError.value = null;
    store.setTemplateFaceResult(null); // Clear previous result

    imageElementForDetection.onload = async () => {
      // console.log('Image loaded for detection:', newUrl);
      try {
        const faceResult = await detectLargestFace(imageElementForDetection);
        store.setTemplateFaceResult(faceResult); // This will update templateFaceResult
        if (!faceResult) {
          detectionError.value = "No face detected in the template image. Please try another one.";
        }
      } catch (error: any) {
        console.error("Face detection failed:", error);
        detectionError.value = `Face detection service failed: ${error.message || 'Unknown error'}`;
      } finally {
        isDetecting.value = false;
      }
    };
    imageElementForDetection.onerror = () => {
      // This is line 47 referenced in your error
      // console.error("Failed to load template image for detection in imageElement.onerror:", newUrl);
      detectionError.value = "Error: Failed to load the template image for processing. The file might be corrupted or an invalid image format.";
      isDetecting.value = false;
      store.setTemplateFaceResult(null); // Ensure face result is cleared
    };

    imageElementForDetection.src = ''; // Reset src before setting it again, might help with some browser caching issues
    imageElementForDetection.src = newUrl; // Start loading
    // console.log("Set imageElementForDetection.src to:", newUrl);

  } else { // newUrl is null or undefined
    // console.log("templateImageUrl is now null/undefined in watcher.");
    store.setTemplateFaceResult(null);
    isDetecting.value = false;
    detectionError.value = null;
    if (imageElementForDetection) imageElementForDetection.src = ''; // Clear src
  }
}, { immediate: true }); // `immediate: true` runs this watcher when the component is mounted

const naturalImageDimensions = computed(() => {
    // Use templateFaceResult which stores these from detection
    if (store.templateFaceResult) {
        return {
            width: store.templateFaceResult.imageWidth,
            height: store.templateFaceResult.imageHeight
        };
    }
    // Fallback if image loaded but no face, or if image failed to load (less accurate)
    else if (imageElementForDetection.complete && imageElementForDetection.naturalWidth > 0) {
      return {
        width: imageElementForDetection.naturalWidth,
        height: imageElementForDetection.naturalHeight
      }
    }
    return null;
});

onUnmounted(() => {
    if (imageElementForDetection) {
        imageElementForDetection.onload = null;
        imageElementForDetection.onerror = null;
        imageElementForDetection.src = ''; // Prevent memory leaks or continued loading
    }
});

</script>

<template>
  <div class="space-y-4">
    <ImagePreview
      v-if="templateImageUrl"
      :image-url="templateImageUrl"
      :face-result="templateFaceResult"
      :crop-params="localCropParams"
      :image-width="naturalImageDimensions?.width"
      :image-height="naturalImageDimensions?.height"
    />

    <Alert v-if="isDetecting" variant="default">
      <Loader2 class="h-4 w-4 animate-spin" />
      <AlertTitle>Detecting Face</AlertTitle>
      <AlertDescription>
        Please wait while we analyze the template image...
    </AlertDescription>
    </Alert>

    <Alert v-if="detectionError && !isDetecting" variant="destructive">
      <AlertTitle>Detection Error</AlertTitle>
      <AlertDescription>{{ detectionError }}</AlertDescription>
    </Alert>

    <Alert v-if="!isDetecting && templateImageUrl && templateFaceResult && templateFaceResult.detectionCount > 1" variant="default">
    <AlertTitle>Multiple Faces Detected</AlertTitle>
    <AlertDescription>
        {{ templateFaceResult.detectionCount }} faces were found in the template image. The largest face (highlighted in red) will be used as the reference for cropping.
    </AlertDescription>
</Alert>

    <div v-if="templateFaceResult" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div>
        <Label for="crop-top">Top (px)</Label>
        <Input id="crop-top" type="number" v-model.number="localCropParams.top" min="0" />
      </div>
      <div>
        <Label for="crop-bottom">Bottom (px)</Label>
        <Input id="crop-bottom" type="number" v-model.number="localCropParams.bottom" min="0" />
      </div>
      <div>
        <Label for="crop-left">Left (px)</Label>
        <Input id="crop-left" type="number" v-model.number="localCropParams.left" min="0" />
      </div>
      <div>
        <Label for="crop-right">Right (px)</Label>
        <Input id="crop-right" type="number" v-model.number="localCropParams.right" min="0" />
      </div>
    </div>
  </div>
</template>
