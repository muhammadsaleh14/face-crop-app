// src/services/zipService.ts
import JSZip from 'jszip';

interface FileToZip {
  filename: string;
  blob: Blob;
}

export async function createZip(files: FileToZip[]): Promise<Blob> {
  const zip = new JSZip();
  files.forEach(file => {
    zip.file(file.filename, file.blob);
  });
  return zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function triggerZipDownload(blob: Blob, zipFilename: string = 'cropped_images.zip') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = zipFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
