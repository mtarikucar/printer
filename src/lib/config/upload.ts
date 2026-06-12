// Photo upload size limit for the custom-figurine source image.
// Single source of truth: imported by both the client dropzone
// (src/components/upload-dropzone.tsx) and the server route
// (src/app/api/upload/route.ts) so the enforced limit can never drift
// from what the UI advertises (the landing hint says "up to 10MB").
export const UPLOAD_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Faz 3: customer-uploaded 3D model (STL/OBJ) limit + allowed formats. Single
// source for the model dropzone (client) and /api/upload/model (server).
export const UPLOAD_MODEL_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const UPLOAD_MODEL_FORMATS = ["stl", "obj"] as const;
export type UploadModelFormat = (typeof UPLOAD_MODEL_FORMATS)[number];

// Max print files (STL/OBJ parts) per product. Client-safe so the spec editor
// can enforce the cap during bulk/ZIP upload; the server (product-spec.ts)
// re-exports this as the authoritative gate.
export const MAX_PRODUCT_FILES = 12;
