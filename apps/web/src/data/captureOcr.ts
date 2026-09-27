import Tesseract from "tesseract.js"

import { CAPTURE_OCR_LANGUAGE_CODE } from "./captureOcrConstants"
import type { PreparedCapturePhoto } from "./capturePhotos"

export interface CaptureOcrPage {
  objectName: string
  text: string
  confidence: number
}

export interface CaptureOcrProgress {
  page: number
  pageCount: number
  progress: number
}

export interface CaptureOcrOptions {
  onProgress?: (progress: CaptureOcrProgress) => void
  createWorker?: typeof Tesseract.createWorker
  workerPath?: string
  origin?: string
}

export async function recognizeCapturePhotosLocally(
  photos: readonly PreparedCapturePhoto[],
  options: CaptureOcrOptions = {},
): Promise<CaptureOcrPage[]> {
  if (photos.length < 1 || photos.length > 2) throw new Error("OCR requires one or two prepared photos")
  const origin = options.origin ?? window.location.origin
  const createWorker = options.createWorker ?? Tesseract.createWorker
  let currentPage = 1
  const worker = await createWorker(CAPTURE_OCR_LANGUAGE_CODE, Tesseract.OEM.LSTM_ONLY, {
    workerPath: options.workerPath ?? new URL("/ocr/7.0.0/worker.min.js", origin).href,
    workerBlobURL: false,
    corePath: new URL("/ocr/7.0.0/core", origin).href,
    langPath: new URL("/ocr/1.0.0/lang", origin).href,
    gzip: true,
    logger: ({ progress }) => {
      if (Number.isFinite(progress)) {
        options.onProgress?.({
          page: currentPage,
          pageCount: photos.length,
          progress: Math.max(0, Math.min(1, ((currentPage - 1) + progress) / photos.length)),
        })
      }
    },
  })

  try {
    const pages: CaptureOcrPage[] = []
    for (const [index, photo] of photos.entries()) {
      currentPage = index + 1
      const { data } = await worker.recognize(photo.blob)
      const confidence = Number.isFinite(data.confidence)
        ? Math.max(0, Math.min(100, Math.round(data.confidence)))
        : 0
      pages.push({ objectName: photo.objectName, text: data.text.trim().slice(0, 10000), confidence })
      options.onProgress?.({ page: currentPage, pageCount: photos.length, progress: currentPage / photos.length })
    }
    if (!pages.some((page) => page.text.trim().length > 0)) {
      const error = new Error("No text recognized")
      error.name = "CaptureOcrEmptyError"
      throw error
    }
    return pages
  } finally {
    await worker.terminate()
  }
}
