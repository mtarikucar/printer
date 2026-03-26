"use client";

import { forwardRef, useMemo } from "react";
import { Cropper, type CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { type ImageAdjustments, getFilterStyle } from "./types";

interface EditorCanvasProps {
  imageSrc: string;
  aspectRatio?: number;
  adjustments: ImageAdjustments;
}

export const EditorCanvas = forwardRef<CropperRef, EditorCanvasProps>(
  function EditorCanvas({ imageSrc, aspectRatio, adjustments }, ref) {
    const filterStyle = useMemo(() => getFilterStyle(adjustments), [adjustments]);

    return (
      <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden" style={{ minHeight: 300 }}>
        {/* Apply CSS filter to cropper images for live preview */}
        <style>{`.editor-cropper img { filter: ${filterStyle}; }`}</style>
        <Cropper
          ref={ref}
          src={imageSrc}
          stencilProps={{
            aspectRatio: aspectRatio,
            grid: true,
          }}
          backgroundWrapperProps={{
            scaleImage: true,
            moveImage: true,
          }}
          style={{
            maxHeight: 500,
            width: "100%",
          }}
          className="editor-cropper"
        />
      </div>
    );
  }
);
