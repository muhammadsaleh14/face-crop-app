<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import type { FaceDetectionResult, CropParams } from '@/types';

interface Props {
  imageUrl: string;
  faceResult?: FaceDetectionResult | null;
  cropParams?: CropParams | null;
  imageWidth?: number; // Natural width of the image
  imageHeight?: number; // Natural height of the image
}
const props = defineProps<Props>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const imageEl = new Image();

const draw = () => {
  if (!canvasRef.value || !props.imageUrl) return;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Ensure image is loaded before trying to access naturalWidth/Height or drawing
  if (!imageEl.src || imageEl.src !== props.imageUrl || !imageEl.complete) {
    imageEl.onload = () => { // Re-assign onload for subsequent draws with new src
        drawInternal(ctx, canvas);
    };
    imageEl.onerror = () => {
        console.error("Failed to load image for preview:", props.imageUrl);
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas on error
        ctx.fillStyle = 'red';
        ctx.fillText("Error loading image", 10, 20);
    };
    imageEl.src = props.imageUrl;
    return; // Exit, onload will trigger drawInternal
  }
  // If image is already loaded (e.g. src hasn't changed, just params)
  drawInternal(ctx, canvas);
};

const drawInternal = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const imgWidth = imageEl.naturalWidth;
    const imgHeight = imageEl.naturalHeight;

    // Scale canvas to fit image while maintaining aspect ratio
    const maxWidth = canvas.parentElement?.clientWidth || 600; // Max width of container
    const scale = Math.min(1, maxWidth / imgWidth);
    canvas.width = imgWidth * scale;
    canvas.height = imgHeight * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height); // Draw scaled image

    // Draw face bounding box if available
    if (props.faceResult && props.faceResult.boundingBox) {
        const { x, y, width, height } = props.faceResult.boundingBox;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red
        ctx.lineWidth = 2 / scale; // Adjust line width based on scale
        ctx.strokeRect(x * scale, y * scale, width * scale, height * scale);

        // Draw center point
        const { x: cx, y: cy } = props.faceResult.center;
        ctx.fillStyle = 'rgba(0, 255, 0, 0.9)'; // Green
        ctx.beginPath();
        ctx.arc(cx * scale, cy * scale, 5 / scale, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Draw crop preview if params and face result are available
    if (props.cropParams && props.faceResult) {
        const { top, right, bottom, left } = props.cropParams;
        const { center } = props.faceResult;

        const cropX = (center.x - left) * scale;
        const cropY = (center.y - top) * scale;
        const cropWidth = (left + right) * scale;
        const cropHeight = (top + bottom) * scale;

        ctx.strokeStyle = 'rgba(0, 0, 255, 0.7)'; // Blue
        ctx.lineWidth = 3 / scale;
        ctx.setLineDash([6 / scale, 3 / scale]); // Dashed line
        ctx.strokeRect(cropX, cropY, cropWidth, cropHeight);
        ctx.setLineDash([]); // Reset line dash
    }
}

onMounted(() => {
  draw();
  // Observe parent width changes to redraw (simple approach)
  if (canvasRef.value?.parentElement) {
    new ResizeObserver(draw).observe(canvasRef.value.parentElement);
  }
});
watch(() => [props.imageUrl, props.faceResult, props.cropParams], () => {
  nextTick(draw); // Ensure DOM is updated if canvas size changes
}, { deep: true });
</script>

<template>
  <div class="w-full aspect-video bg-slate-200 dark:bg-slate-700 rounded overflow-hidden relative">
    <canvas ref="canvasRef" class="w-full h-full object-contain"></canvas>
    <p v-if="!imageUrl" class="absolute inset-0 flex items-center justify-center text-slate-500">
      No image loaded for preview
    </p>
  </div>
</template>
