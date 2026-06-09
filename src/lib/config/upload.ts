// Photo upload size limit for the custom-figurine source image.
// Single source of truth: imported by both the client dropzone
// (src/components/upload-dropzone.tsx) and the server route
// (src/app/api/upload/route.ts) so the enforced limit can never drift
// from what the UI advertises (the landing hint says "up to 10MB").
export const UPLOAD_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
