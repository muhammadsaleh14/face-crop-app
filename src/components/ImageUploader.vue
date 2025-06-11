<!-- File: src\components\ImageUploader.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useCropStore } from '@/stores/cropStore';
import IconUpload from './icons/IconUpload.vue'; // NEW: Import custom icon

interface Props {
  mode: 'template' | 'batch';
}
const props = defineProps<Props>();

const store = useCropStore();
const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false); // NEW: State for drag-over styling

// NEW: Unified function to handle file selection
const handleFileChange = (files: FileList | null) => {
  if (files && files.length > 0) {
    if (props.mode === 'template') {
      store.setTemplateImage(files[0]);
    } else {
      store.addBatchImages(files);
    }
    // Reset file input to allow uploading the same file again if needed
    if (fileInput.value) fileInput.value.value = '';
  }
};

// NEW: Programmatically clicks the hidden file input
const triggerFileInput = () => {
  fileInput.value?.click();
};

// NEW: Handles the drop event for drag-and-drop
const handleDrop = (event: DragEvent) => {
  isDragging.value = false;
  const files = event.dataTransfer?.files;
  if (files) {
    handleFileChange(files);
  }
};
</script>

<template>
  <div class="space-y-4">
    <!-- Hidden file input, controlled by our custom UI -->
    <input
      :id="mode + '-uploader'"
      ref="fileInput"
      type="file"
      :accept="'image/*'"
      :multiple="mode === 'batch'"
      @change="handleFileChange(($event.target as HTMLInputElement).files)"
      class="hidden"
    />

    <!-- NEW: Drag and Drop Zone -->
    <div
      @click="triggerFileInput"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
      :class="[
        'flex flex-col items-center justify-center w-full p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
        isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
      ]"
    >
      <IconUpload class="w-12 h-12 text-muted-foreground mb-4" />
      <p class="text-center text-muted-foreground">
        <span class="font-semibold text-primary">Click to upload</span> or drag and drop
      </p>
      <p class="text-xs text-muted-foreground mt-1">
        {{ mode === 'template' ? 'A single image (PNG, JPG, etc.)' : 'Multiple images supported' }}
      </p>
    </div>

    <!-- NEW: Cleanly display selected file name(s) below the dropzone -->
    <div v-if="mode === 'template' && store.templateImage" class="p-3 border rounded-md bg-muted/50 text-center">
      <p class="text-sm font-medium text-foreground">Selected Template:</p>
      <p class="text-sm text-muted-foreground truncate">{{ store.templateImage.name }}</p>
    </div>

    <div v-if="mode === 'batch' && store.batchImages.length > 0" class="p-3 border rounded-md bg-muted/50 text-center">
       <p class="text-sm font-medium text-foreground">{{ store.batchImages.length }} image(s) selected for batch processing.</p>
    </div>
  </div>
</template>
