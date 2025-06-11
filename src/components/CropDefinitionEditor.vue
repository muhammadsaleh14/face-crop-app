<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useCropStore } from '@/stores/cropStore';
import { detectAllFaces } from '@/services/faceDetector';
import { calculatePixelCropBox, calculatePercentageParamsFromPixelBox } from '@/utils/cropUtils';
import ImagePreview from './ImagePreview.vue';
import type { CropParams, FaceDetectionResult, BoundingBox } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Info } from 'lucide-vue-next';

// --- START DEBUG ---
const DEBUG = true;
const log = (...args: any[]) => DEBUG && console.log('[CropDefinitionEditor]', ...args);
// --- END DEBUG ---

const store = useCropStore();
const { templateImageUrl, templateFaceResult, definedCropParams } = storeToRefs(store);

const localCropParams = ref<CropParams>({ ...definedCropParams.value });
const detectionError = ref<string | null>(null);
const isDetecting = ref(false);
const imageElementForDetection = new Image();

const previewPixelCropBox = computed(() => {
  if (templateFaceResult.value?.primaryBoundingBox && templateFaceResult.value.imageWidth > 0 && templateFaceResult.value.imageHeight > 0) {
    return calculatePixelCropBox(
      templateFaceResult.value.primaryBoundingBox,
      localCropParams.value,
      templateFaceResult.value.imageWidth,
      templateFaceResult.value.imageHeight
    );
  }
  log('previewPixelCropBox: Conditions not met', templateFaceResult.value);
  return null;
});

const handleCropBoxUpdate = (newPixelBox: BoundingBox) => {
    if (templateFaceResult.value?.primaryBoundingBox &&
        templateFaceResult.value.imageWidth > 0 && // Ensure image dimensions are valid
        templateFaceResult.value.imageHeight > 0) {
        log('handleCropBoxUpdate: Received new pixel box from preview', newPixelBox);
        const newPercentageParams = calculatePercentageParamsFromPixelBox(
            templateFaceResult.value.primaryBoundingBox,
            newPixelBox
            // REMOVED: imageWidth and imageHeight are not needed by this function
        );
        log('handleCropBoxUpdate: Calculated new percentage params', newPercentageParams);
        localCropParams.value = newPercentageParams;
    } else {
        log('handleCropBoxUpdate: No primary bounding box or invalid image dimensions to calculate from.');
    }
};

watch(localCropParams, (newLocalParams) => {
  if (JSON.stringify(newLocalParams) !== JSON.stringify(definedCropParams.value)) {
    log('watch localCropParams: Updating store with new params', newLocalParams);
    store.setCropParams({ ...newLocalParams });
  }
}, { deep: true });

watch(definedCropParams, (newStoreParams) => {
  if (newStoreParams && JSON.stringify(newStoreParams) !== JSON.stringify(localCropParams.value)) {
    log('watch definedCropParams: Updating local params from store', newStoreParams);
    localCropParams.value = { ...newStoreParams };
  }
}, { deep: true });

watch(templateImageUrl, async (newUrl) => {
    log('watch templateImageUrl: New URL', newUrl);
    if (newUrl) {
        isDetecting.value = true;
        detectionError.value = null;
        store.setTemplateFaceResult(null);
        imageElementForDetection.onload = async () => {
            log('imageElementForDetection.onload: Image loaded in CropDefinitionEditor');
            try {
                const faceResult: FaceDetectionResult | null = await detectAllFaces(imageElementForDetection);
                log('imageElementForDetection.onload: Face detection result', faceResult);
                store.setTemplateFaceResult(faceResult);
                if (!faceResult || faceResult.detectionCount === 0) {
                    detectionError.value = "No face detected in the template image. Please try another one.";
                    log('imageElementForDetection.onload: No face detected.');
                } else if (faceResult.detectionCount > 1) {
                    detectionError.value = null;
                    log(`imageElementForDetection.onload: ${faceResult.detectionCount} faces detected.`);
                } else {
                    detectionError.value = null;
                    log('imageElementForDetection.onload: 1 face detected.');
                }
            } catch (error: any) {
                detectionError.value = `Face detection service failed: ${error.message || 'Unknown error'}`;
                log('imageElementForDetection.onload: Face detection error', error);
            }
            finally { isDetecting.value = false; }
        };
        imageElementForDetection.onerror = () => {
            detectionError.value = "Error: Failed to load the template image for processing.";
            isDetecting.value = false;
            store.setTemplateFaceResult(null);
            log('imageElementForDetection.onerror: Image load failed.');
        };
        imageElementForDetection.src = ''; // Reset src before setting it again for onload to trigger
        imageElementForDetection.src = newUrl;
    } else {
        store.setTemplateFaceResult(null);
        isDetecting.value = false;
        detectionError.value = null;
        if(imageElementForDetection) imageElementForDetection.src = '';
        log('watch templateImageUrl: URL is null, cleared state.');
    }
}, { immediate: true });

onUnmounted(() => {
    log('onUnmounted: Cleaning up CropDefinitionEditor');
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
      v-if="templateImageUrl && templateFaceResult?.primaryBoundingBox"
      :image-url="templateImageUrl"
      :face-result="templateFaceResult"
      :pixel-crop-box-to-draw="previewPixelCropBox"
      :interactive="true"
      @update:crop-box="handleCropBoxUpdate"
    />
    <div v-else-if="templateImageUrl && isDetecting" class="w-full aspect-video bg-slate-200 dark:bg-slate-700 rounded flex items-center justify-center">
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
        <p class="ml-2">Detecting face...</p>
    </div>
     <Alert v-else-if="templateImageUrl && !isDetecting && (!templateFaceResult || templateFaceResult.detectionCount === 0)" variant="destructive">
        <AlertTitle>Detection Problem</AlertTitle>
        <AlertDescription>
            {{ detectionError || "No face detected. Please try a different image or adjust lighting." }}
        </AlertDescription>
    </Alert>

    <Alert v-if="templateFaceResult && templateFaceResult.detectionCount > 1" variant="default" class="mt-4">
      <Info class="h-4 w-4" />
      <AlertTitle>Multiple Faces Detected in Template</AlertTitle>
      <AlertDescription>
        {{ templateFaceResult.detectionCount }} faces were found. The largest face (outlined in red) is
        used to define the crop settings. When processing the batch, <strong>all detected faces</strong> in each batch image will be cropped individually.
      </AlertDescription>
    </Alert>

    <div v-if="templateFaceResult?.primaryBoundingBox" class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
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
     <Alert v-else-if="templateImageUrl && !isDetecting && !templateFaceResult?.primaryBoundingBox" variant="default" class="mt-4">
        <AlertTitle>Define Crop Area</AlertTitle>
        <AlertDescription>
            Once a face is detected (it will be outlined in red), you can adjust the percentage-based padding around it.
            These settings will be applied to all batch images. If no face is detected, the crop definition controls will not appear.
        </AlertDescription>
    </Alert>
  </div>
</template>
