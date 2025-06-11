<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { FaceDetectionResult, BoundingBox } from '@/types'; // Corrected: Uses BoundingBox

// --- START DEBUG ---
const DEBUG = true;
const log = (...args: any[]) => DEBUG && console.log('[ImagePreview]', ...args);
// --- END DEBUG ---

interface Props {
  imageUrl: string;
  faceResult?: FaceDetectionResult | null;
  pixelCropBoxToDraw?: BoundingBox | null; // Corrected: Uses BoundingBox
  interactive?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  interactive: false,
});

const emit = defineEmits<{
  // Corrected: Uses BoundingBox and ESLint convention for unused type params
  (_e: 'update:cropBox', _payload: BoundingBox): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const imageEl = new Image();

const isDragging = ref(false);
const activeHandle = ref<string | null>(null);
const lastPosition = ref({ x: 0, y: 0 });

// State variables for object-contain adjustments
let contentOffsetX = 0;
let contentOffsetY = 0;
let imageToContentScale = 1;

function updateDrawingParameters(): boolean {
  if (imageEl.complete && imageEl.naturalWidth > 0 && canvasRef.value) {
    const canvas = canvasRef.value;
    const imgWidth = imageEl.naturalWidth;
    const imgHeight = imageEl.naturalHeight;

    const canvasDisplayWidth = canvas.clientWidth;
    const canvasDisplayHeight = canvas.clientHeight;

    if (canvasDisplayWidth === 0 || canvasDisplayHeight === 0) {
        log('updateDrawingParameters: Canvas display size is zero. Aborting.');
        return false;
    }

    const imgAspectRatio = imgWidth / imgHeight;
    const canvasAspectRatio = canvasDisplayWidth / canvasDisplayHeight;

    let visibleContentWidth, visibleContentHeight;

    if (imgAspectRatio > canvasAspectRatio) {
      visibleContentWidth = canvasDisplayWidth;
      visibleContentHeight = canvasDisplayWidth / imgAspectRatio;
    } else {
      visibleContentHeight = canvasDisplayHeight;
      visibleContentWidth = canvasDisplayHeight * imgAspectRatio;
    }

    const newImageToContentScale = visibleContentWidth / imgWidth;
    const newContentOffsetX = (canvasDisplayWidth - visibleContentWidth) / 2;
    const newContentOffsetY = (canvasDisplayHeight - visibleContentHeight) / 2;

    let paramsChanged = false;
    if (Math.abs(imageToContentScale - newImageToContentScale) > 0.001) {
        imageToContentScale = newImageToContentScale;
        paramsChanged = true;
    }
    if (Math.abs(contentOffsetX - newContentOffsetX) > 0.001) {
        contentOffsetX = newContentOffsetX;
        paramsChanged = true;
    }
    if (Math.abs(contentOffsetY - newContentOffsetY) > 0.001) {
        contentOffsetY = newContentOffsetY;
        paramsChanged = true;
    }

    if (canvas.width !== Math.round(visibleContentWidth) || canvas.height !== Math.round(visibleContentHeight) || paramsChanged) {
        canvas.width = Math.round(visibleContentWidth);
        canvas.height = Math.round(visibleContentHeight);
        if (paramsChanged || DEBUG) { // Log if params changed or if DEBUG is on
             log(`updateDrawingParameters: Updated.
                Image: ${imgWidth}x${imgHeight}
                Canvas Display: ${canvasDisplayWidth}x${canvasDisplayHeight}
                Visible Content: ${canvas.width}x${canvas.height}
                Content Offset: X=${contentOffsetX.toFixed(1)}, Y=${contentOffsetY.toFixed(1)}
                Image to Content Scale: ${imageToContentScale.toFixed(3)}`);
        }
    }

    return true;
  }
  // log('updateDrawingParameters: Conditions not met (image/canvas not ready).'); // Can be too noisy
  return false;
}

function getEventPosition(canvas: HTMLCanvasElement, event: MouseEvent | TouchEvent) {
  const rect = canvas.getBoundingClientRect();
  let clientXVal: number, clientYVal: number;

  if (event instanceof TouchEvent) {
    clientXVal = event.touches[0].clientX;
    clientYVal = event.touches[0].clientY;
  } else {
    clientXVal = event.clientX;
    clientYVal = event.clientY;
  }

  const mouseXInBoundingBox = clientXVal - rect.left;
  const mouseYInBoundingBox = clientYVal - rect.top;

  const mouseXInContent = mouseXInBoundingBox - contentOffsetX;
  const mouseYInContent = mouseYInBoundingBox - contentOffsetY;

  return { x: mouseXInContent, y: mouseYInContent };
}

const getHandleAtPos = (mouseX: number, mouseY: number): string | null => {
  if (!props.pixelCropBoxToDraw || !canvasRef.value) return null;

  const { x, y, width, height } = props.pixelCropBoxToDraw;

  const h_x = x * imageToContentScale;
  const h_y = y * imageToContentScale;
  const h_w = width * imageToContentScale;
  const h_h = height * imageToContentScale;

  const clickHandleSize = 16;
  const halfClickHandle = clickHandleSize / 2;

  if (DEBUG) {
    log(`getHandleAtPos: Mouse in Content (${mouseX.toFixed(1)}, ${mouseY.toFixed(1)}). ImageToContentScale: ${imageToContentScale.toFixed(3)}`);
    log(`  Scaled Crop Box (on content): x:${h_x.toFixed(1)}, y:${h_y.toFixed(1)}, w:${h_w.toFixed(1)}, h:${h_h.toFixed(1)}`);
  }


  const handles = {
    left:   { x: h_x,                     y: h_y + h_h / 2, name: 'left' },
    right:  { x: h_x + h_w,               y: h_y + h_h / 2, name: 'right' },
    top:    { x: h_x + h_w / 2,           y: h_y,           name: 'top' },
    bottom: { x: h_x + h_w / 2,           y: h_y + h_h,     name: 'bottom' },
  };

  for (const handleData of Object.values(handles)) {
    const x_min = handleData.x - halfClickHandle;
    const x_max = handleData.x + halfClickHandle;
    const y_min = handleData.y - halfClickHandle;
    const y_max = handleData.y + halfClickHandle;

    if (DEBUG) {
        // log(`  Checking handle "${handleData.name}": Target point (${handleData.x.toFixed(1)}, ${handleData.y.toFixed(1)}). Click Area: x[${x_min.toFixed(1)} to ${x_max.toFixed(1)}], y[${y_min.toFixed(1)} to ${y_max.toFixed(1)}]`);
    }


    if (mouseX >= x_min && mouseX <= x_max &&
        mouseY >= y_min && mouseY <= y_max) {
      log(`    HIT! Mouse (${mouseX.toFixed(1)}, ${mouseY.toFixed(1)}) is within click area for "${handleData.name}".`);
      return handleData.name;
    }
  }
  // if (DEBUG) log(`  No handle hit.`); // Only log if no hit at all
  return null;
};

const onDragStart = (event: MouseEvent | TouchEvent) => {
  log('onDragStart: Event triggered', event.type);
  if (!props.interactive || !canvasRef.value) return;

  if (!updateDrawingParameters()) {
      log('onDragStart: Failed to update drawing parameters. Aborting.');
      return;
  }

  const pos = getEventPosition(canvasRef.value, event);
  const handle = getHandleAtPos(pos.x, pos.y);
  log('onDragStart: Identified handle:', handle, 'at content pos:', pos);

  if (handle) {
    if (event.cancelable) event.preventDefault();
    isDragging.value = true;
    activeHandle.value = handle;
    lastPosition.value = pos;
    canvasRef.value.style.cursor = getCursorForHandle(handle);
    log('onDragStart: DRAGGING STARTED on handle:', handle);

    if (event instanceof TouchEvent) {
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd, { passive: false });
        document.addEventListener('touchcancel', onDragEnd, { passive: false });
    } else {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    }
  } else {
      log('onDragStart: No handle hit.');
  }
};

const onDragMove = (event: MouseEvent | TouchEvent) => {
  if (!props.interactive || !canvasRef.value || !props.pixelCropBoxToDraw) return;

  if (!updateDrawingParameters()){ return; }

  if (isDragging.value && activeHandle.value) {
    if (event.cancelable) event.preventDefault();
    const pos = getEventPosition(canvasRef.value, event);

    const dx_content = pos.x - lastPosition.value.x;
    const dy_content = pos.y - lastPosition.value.y;

    if (imageToContentScale === 0) {
        log('onDragMove: imageToContentScale is zero, cannot calculate image delta.');
        return;
    }
    const dx_image = dx_content / imageToContentScale;
    const dy_image = dy_content / imageToContentScale;

    let { x, y, width, height } = { ...props.pixelCropBoxToDraw };

    switch (activeHandle.value) {
      case 'left':   x += dx_image; width -= dx_image; break;
      case 'right':  width += dx_image; break;
      case 'top':    y += dy_image; height -= dy_image; break;
      case 'bottom': height += dy_image; break;
    }
    lastPosition.value = pos;
    if (width > 20 && height > 20) {
      emit('update:cropBox', { x, y, width, height });
    }
  } else if (event instanceof MouseEvent && canvasRef.value) {
    const pos = getEventPosition(canvasRef.value, event);
    const handle = getHandleAtPos(pos.x, pos.y);
    canvasRef.value.style.cursor = getCursorForHandle(handle);
  }
};

const onDragEnd = (event: MouseEvent | TouchEvent) => {
  log('onDragEnd: Event triggered', event.type, 'IsDragging:', isDragging.value);
  if (isDragging.value) {
    if (event.cancelable) event.preventDefault();
    isDragging.value = false;
    activeHandle.value = null;
    if (canvasRef.value) canvasRef.value.style.cursor = 'default';
    log('onDragEnd: DRAGGING STOPPED');

    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('touchcancel', onDragEnd);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }
};

const getCursorForHandle = (handle: string | null): string => {
    if (!handle) return 'default';
    if (handle === 'left' || handle === 'right') return 'ew-resize';
    if (handle === 'top' || handle === 'bottom') return 'ns-resize';
    return 'default';
};

const drawInternal = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // log('drawInternal: Attempting to draw canvas'); // Less verbose
    if (!updateDrawingParameters()) {
        log('drawInternal: Drawing parameters update failed, aborting draw.');
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height);

    if (props.faceResult?.primaryBoundingBox) { // Use primaryBoundingBox for the red outline
        const { x, y, width, height } = props.faceResult.primaryBoundingBox;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * imageToContentScale, y * imageToContentScale, width * imageToContentScale, height * imageToContentScale);
    }
    if (props.pixelCropBoxToDraw) {
        const { x, y, width, height } = props.pixelCropBoxToDraw;
        const h_x = x * imageToContentScale;
        const h_y = y * imageToContentScale;
        const h_w = width * imageToContentScale;
        const h_h = height * imageToContentScale;

        ctx.strokeStyle = props.interactive ? 'rgba(0, 120, 255, 0.9)' : 'rgba(0, 0, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(h_x, h_y, h_w, h_h);
        ctx.setLineDash([]);
        if (props.interactive) {
            const drawnHandleSize = 10;
            const halfDrawnHandle = drawnHandleSize / 2;
            ctx.fillStyle = 'rgba(0, 120, 255, 1)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1;
            const handlesToDraw = [
              { x: h_x - halfDrawnHandle,                     y: h_y + h_h / 2 - halfDrawnHandle },
              { x: h_x + h_w - halfDrawnHandle,               y: h_y + h_h / 2 - halfDrawnHandle },
              { x: h_x + h_w / 2 - halfDrawnHandle,           y: h_y - halfDrawnHandle },
              { x: h_x + h_w / 2 - halfDrawnHandle,           y: h_y + h_h - halfDrawnHandle },
            ];
            handlesToDraw.forEach(handle => {
                ctx.fillRect(handle.x, handle.y, drawnHandleSize, drawnHandleSize);
                ctx.strokeRect(handle.x, handle.y, drawnHandleSize, drawnHandleSize);
            });
        }
    }
}

imageEl.onload = () => {
    log('imageEl.onload: Image loaded successfully.');
    if (canvasRef.value) {
        const ctx = canvasRef.value.getContext('2d');
        if (ctx) {
            log('imageEl.onload: Canvas context available, calling drawInternal.');
            drawInternal(ctx, canvasRef.value);
        } else { log('imageEl.onload: Canvas context NOT available.'); }
    } else { log('imageEl.onload: canvasRef.value is null.'); }
};
imageEl.onerror = () => { log('imageEl.onerror: Error loading image.'); };

onMounted(() => {
  log('onMounted: Component mounted.');
  const canvas = canvasRef.value;
  if (canvas) {
    log('onMounted: Canvas element found. Adding event listeners.');
    canvas.addEventListener('mousedown', onDragStart);
    canvas.addEventListener('touchstart', onDragStart, { passive: false });
    canvas.addEventListener('mousemove', onDragMove);

    if (props.imageUrl) {
        log('onMounted: ImageUrl provided, setting src:', props.imageUrl);
        imageEl.src = props.imageUrl;
    } else if (imageEl.complete && imageEl.naturalWidth > 0) {
        log('onMounted: Image already complete and cached, attempting to draw.');
        const ctx = canvas.getContext('2d');
        if (ctx) drawInternal(ctx, canvas);
    } else {
        log('onMounted: No imageUrl and image not cached/complete.');
    }
  } else { log('onMounted: canvasRef.value is null at onMounted listener attachment.'); }
});

onUnmounted(() => {
  log('onUnmounted: Component unmounting. Cleaning up listeners.');
  const canvas = canvasRef.value;
  if (canvas) {
    canvas.removeEventListener('mousedown', onDragStart);
    canvas.removeEventListener('touchstart', onDragStart);
    canvas.removeEventListener('mousemove', onDragMove);
  }
  document.removeEventListener('touchmove', onDragMove);
  document.removeEventListener('touchend', onDragEnd);
  document.removeEventListener('touchcancel', onDragEnd);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);

  imageEl.onload = null;
  imageEl.onerror = null;
  imageEl.src = '';
  log('onUnmounted: Cleanup complete.');
});

watch(() => props.imageUrl, (newUrl, oldUrl) => {
    log('watch imageUrl: Changed from', oldUrl, 'to', newUrl);
    if (newUrl && newUrl !== oldUrl) {
        log('watch imageUrl: Setting new image src.');
        imageEl.src = newUrl;
    } else if (!newUrl && canvasRef.value) {
        log('watch imageUrl: Clearing canvas (no URL).');
        const ctx = canvasRef.value.getContext('2d');
        ctx?.clearRect(0,0, canvasRef.value.width, canvasRef.value.height);
    }
});

watch(() => [props.faceResult, props.pixelCropBoxToDraw], (newValue, oldValue) => {
    if (JSON.stringify(newValue) === JSON.stringify(oldValue)) {
        return;
    }
    log('watch faceResult/pixelCropBoxToDraw: Props changed, attempting redraw.');
    if (imageEl.complete && imageEl.naturalWidth > 0 && canvasRef.value) {
        log('  Image complete, canvas available. Scheduling redraw.');
        nextTick(() => {
            if (canvasRef.value) {
                const ctx = canvasRef.value.getContext('2d');
                if (ctx) {
                    log('  Redrawing in nextTick.');
                    drawInternal(ctx, canvasRef.value);
                } else { log('  Redraw in nextTick: context not found.'); }
            } else { log('  Redraw in nextTick: canvasRef became null.'); }
        });
    } else { log('  Redraw condition not met (e.g. image not loaded yet or canvas gone).'); }
}, { deep: true });
</script>

<template>
  <div class="w-full aspect-video bg-slate-200 dark:bg-slate-700 rounded overflow-hidden relative touch-none">
    <canvas ref="canvasRef" class="w-full h-full object-contain"></canvas>
  </div>
</template>
