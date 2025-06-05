<script setup lang="ts">
import { ref, watch, onMounted, nextTick, onUnmounted } from 'vue';
import type { FaceDetectionResult } from '@/types';

// Interface for the final pixel-based crop box that will be drawn
interface PixelBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  faceResult?: FaceDetectionResult | null;       // Contains face bounding box and image dimensions
  pixelCropBoxToDraw?: PixelBoundingBox | null;  // The final pixel crop box (calculated by parent)
}
const props = defineProps<Props>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const imageEl = new Image();
let resizeObserver: ResizeObserver | null = null;

const draw = () => {
  if (!canvasRef.value || !props.imageUrl) return;
  // If imageEl's src isn't set or isn't the current imageUrl, or image isn't loaded,
  // set src and let the onload handler call drawInternal.
  if (!imageEl.src || imageEl.src !== props.imageUrl || !imageEl.complete) {
    imageEl.src = props.imageUrl; // This will trigger onload if src changes or wasn't loaded
    return;
  }
  // If image is already loaded and src matches, draw immediately.
  drawInternal(canvasRef.value.getContext('2d')!, canvasRef.value);
};

const drawInternal = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const imgWidth = imageEl.naturalWidth;
    const imgHeight = imageEl.naturalHeight;

    if (imgWidth === 0 || imgHeight === 0) {
      // console.warn("ImagePreview: drawInternal called with zero image dimensions.");
      return; // Avoid drawing if image not really loaded
    }

    const parentElement = canvas.parentElement;
    const maxWidth = parentElement?.clientWidth || 600; // Fallback width
    const scale = Math.min(1, maxWidth / imgWidth);

    canvas.width = imgWidth * scale;
    canvas.height = imgHeight * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height);

    // Draw face bounding box if available (from props.faceResult)
    if (props.faceResult && props.faceResult.boundingBox) {
        const { x, y, width, height } = props.faceResult.boundingBox;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red for face
        ctx.lineWidth = Math.max(1, 2 / scale);
        ctx.strokeRect(x * scale, y * scale, width * scale, height * scale);
    }

    // Draw crop preview if pixelCropBoxToDraw is available
    if (props.pixelCropBoxToDraw) {
        const { x, y, width, height } = props.pixelCropBoxToDraw;
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.7)'; // Blue for crop area
        ctx.lineWidth = Math.max(1, 3 / scale);
        ctx.setLineDash([Math.max(2,6 / scale), Math.max(1,3 / scale)]);
        ctx.strokeRect(x * scale, y * scale, width * scale, height * scale);
        ctx.setLineDash([]); // Reset line dash
    }
}

// Setup image onload and onerror handlers once
imageEl.onload = () => {
  if (canvasRef.value) {
    drawInternal(canvasRef.value.getContext('2d')!, canvasRef.value);
  }
};
imageEl.onerror = () => {
  console.error("ImagePreview: Failed to load image src:", props.imageUrl);
  if (canvasRef.value) {
      const ctx = canvasRef.value.getContext('2d');
      if(ctx) {
          ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          ctx.fillRect(0,0, canvasRef.value.width, canvasRef.value.height);
          ctx.fillStyle = 'red';
          ctx.textAlign = 'center';
          ctx.fillText("Error loading image", canvasRef.value.width / 2, canvasRef.value.height / 2);
      }
  }
};

onMounted(() => {
  if (canvasRef.value?.parentElement) {
    // Draw initially and on resize of parent
    resizeObserver = new ResizeObserver(() => {
        // Ensure image is loaded before redrawing on resize
        if (imageEl.complete && imageEl.naturalWidth > 0) {
            draw();
        }
    });
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  // Initial draw attempt (will rely on onload if image not yet cached/loaded)
  draw();
});

onUnmounted(() => {
    if (resizeObserver && canvasRef.value?.parentElement) {
        resizeObserver.unobserve(canvasRef.value.parentElement);
    }
    resizeObserver = null;
    imageEl.onload = null; // Clean up handlers
    imageEl.onerror = null;
    imageEl.src = ''; // Help GC
});

watch(() => props.imageUrl, (newUrl) => {
    if (newUrl && newUrl !== imageEl.src) {
        imageEl.src = newUrl; // Trigger load & draw via onload
    } else if (!newUrl) {
        // Clear canvas if URL is removed
        if(canvasRef.value) {
            const ctx = canvasRef.value.getContext('2d');
            ctx?.clearRect(0,0, canvasRef.value.width, canvasRef.value.height);
        }
    }
}, { immediate: true }); // Immediate to load initial URL

// Watch other props that affect drawing, but rely on image already being loaded
watch(() => [props.faceResult, props.pixelCropBoxToDraw], () => {
  // Only redraw if image is already loaded; imageUrl change handles loading.
  if (imageEl.complete && imageEl.naturalWidth > 0) {
    nextTick(draw);
  }
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
