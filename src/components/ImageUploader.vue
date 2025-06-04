<script setup lang="ts">
import { ref } from 'vue';
import { useCropStore } from '@/stores/cropStore';
import { Input } from '@/components/ui/input'; // Shadcn-vue
import { Label } from '@/components/ui/label'; // Shadcn-vue

interface Props {
  mode: 'template' | 'batch';
}
const props = defineProps<Props>();

const store = useCropStore();
const fileInput = ref<HTMLInputElement | null>(null);

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    if (props.mode === 'template') {
      store.setTemplateImage(target.files[0]);
    } else {
      store.addBatchImages(target.files);
    }
    // Reset file input to allow uploading the same file again if needed
    if(fileInput.value) fileInput.value.value = '';
  }
};
</script>

<template>
  <div class="space-y-2">
    <Label :for="mode + '-uploader'">
      {{ mode === 'template' ? 'Upload Template Image' : 'Upload Batch Images' }}
    </Label>
    <Input
      :id="mode + '-uploader'"
      ref="fileInput"
      type="file"
      :accept="'image/*'"
      :multiple="mode === 'batch'"
      @change="handleFileChange"
      class="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
    />
    <p v-if="mode === 'template' && store.templateImage" class="text-sm text-slate-600 dark:text-slate-400">
      Selected: {{ store.templateImage.name }}
    </p>
    <p v-if="mode === 'batch' && store.batchImages.length > 0" class="text-sm text-slate-600 dark:text-slate-400">
      {{ store.batchImages.length }} image(s) selected for batch.
    </p>
  </div>
</template>
