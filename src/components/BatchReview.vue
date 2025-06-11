<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useCropStore } from '@/stores/cropStore';
import { storeToRefs } from 'pinia';
import { detectLargestFace } from '@/services/faceDetector';
import { calculatePixelCropBox } from '@/utils/cropUtils';
import ImagePreview from './ImagePreview.vue';
import { Loader2 } from 'lucide-vue-next';

const store = useCropStore();
const { batchImages, definedCropParams } = storeToRefs(store);

const isAnalyzing = ref(true);

const imagesWithFace = computed(() => store.batchImages.filter(img => img.faceResult));
const imagesWithoutFace = computed(() => store.batchImages.filter(img => img.faceResult === null));

// This function will run face detection on all batch images when the component mounts
onMounted(async () => {
  isAnalyzing.value = true;
  await store.analyzeBatchImages(); // We need to create this action
  isAnalyzing.value = false;
});
</script>

<template>
  <div class="space-y-6">
    <div v-if="isAnalyzing" class="flex flex-col items-center justify-center p-8 border rounded-lg">
      <Loader2 class="h-8 w-8 animate-spin text-primary" />
      <p class="mt-4 text-muted-foreground">Analyzing batch images for faces...</p>
    </div>

    <div v-else>
      <!-- Summary Card -->
      <Card class="mb-6">
        <CardHeader>
          <CardTitle>Batch Summary</CardTitle>
          <CardDescription>
            Ready to crop {{ batchImages.length }} image(s).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-1 text-sm">
            <p class="text-green-600">{{ imagesWithFace.length }} image(s) have a detected face.</p>
            <p class="text-red-600">{{ imagesWithoutFace.length }} image(s) will be skipped (no face found).</p>
          </div>
        </CardContent>
      </Card>

      <!-- Thumbnail Previews -->
      <h3 class="font-semibold mb-2">Sample Previews</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        <div v-for="image in batchImages.slice(0, 8)" :key="image.id" class="relative">
          <ImagePreview
            :image-url="image.originalUrl!"
            :face-result="image.faceResult"
            :pixel-crop-box-to-draw="image.faceResult ? calculatePixelCropBox(image.faceResult.boundingBox, definedCropParams, image.faceResult.imageWidth, image.faceResult.imageHeight) : null"
          />
          <Badge v-if="!image.faceResult" variant="destructive" class="absolute top-2 right-2">No Face</Badge>
        </div>
      </div>
      <p v-if="batchImages.length > 8" class="text-sm text-center mt-4 text-muted-foreground">
        ... and {{ batchImages.length - 8 }} more images.
      </p>
    </div>
  </div>
</template>
