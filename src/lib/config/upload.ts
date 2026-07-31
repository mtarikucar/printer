// Photo upload size limit for source images (custom-figurine source photo,
// admin WhatsApp-order photos, etc.). Single source of truth: imported by the
// client dropzone (src/components/upload-dropzone.tsx) and the server routes so
// the enforced limit can never drift from what the UI advertises ("up to 20MB").
export const UPLOAD_MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// 3D models (STL/OBJ/GLB) have NO size limit: production print files routinely
// run to several hundred megabytes. They are uploaded in chunks and streamed
// straight to disk (src/lib/services/chunked-upload.ts), so neither the reverse
// proxy's body limit nor the server's memory is a ceiling.
// `null` = unlimited; kept as a named export so a future policy change has one
// place to live.
export const UPLOAD_MODEL_MAX_SIZE_BYTES: number | null = null;
export const UPLOAD_MODEL_FORMATS = ["stl", "obj"] as const;
export type UploadModelFormat = (typeof UPLOAD_MODEL_FORMATS)[number];

// Max print files (STL/OBJ parts) per product. Client-safe so the spec editor
// can enforce the cap during bulk/ZIP upload; the server (product-spec.ts)
// re-exports this as the authoritative gate.
export const MAX_PRODUCT_FILES = 12;
