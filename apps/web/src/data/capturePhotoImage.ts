import { CapturePhotoError } from "./capturePhotos"

export const CAPTURE_PHOTO_MAX_PIXELS = 24_000_000
export const CAPTURE_PHOTO_MAX_EDGE = 2_400
export const CAPTURE_PHOTO_MAX_PREPARED_BYTES = 5 * 1024 * 1024

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

interface ImageDimensions {
  width: number
  height: number
}

interface ImagePreparationPlatform {
  createBitmap: (image: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>
  createCanvas: () => HTMLCanvasElement
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1) return null
  return { width, height }
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
      || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
      || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return validDimensions(view.getUint32(16), view.getUint32(20))
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) return null
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      return validDimensions(width, height)
    }
    offset += segmentLength
  }
  return null
}

function inspectPhoto(bytes: Uint8Array, contentType: string): ImageDimensions {
  const dimensions = contentType === "image/jpeg"
    ? jpegDimensions(bytes)
    : contentType === "image/png"
      ? pngDimensions(bytes)
      : null
  if (!dimensions) throw new CapturePhotoError("invalid")
  if (dimensions.width * dimensions.height > CAPTURE_PHOTO_MAX_PIXELS) {
    throw new CapturePhotoError("dimensions")
  }
  return dimensions
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/jpeg" || blob.size < 1) {
        reject(new CapturePhotoError("processing"))
      } else {
        resolve(blob)
      }
    }, "image/jpeg", quality)
  })
}

function targetSize(width: number, height: number, scale: number): ImageDimensions {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function prepareCapturePhotoFile(
  file: File,
  platform: ImagePreparationPlatform = {
    createBitmap: (image, options) => createImageBitmap(image, options),
    createCanvas: () => document.createElement("canvas"),
  },
): Promise<File> {
  if (file.size < 1 || file.size > 6 * 1024 * 1024
      || (file.type !== "image/jpeg" && file.type !== "image/png")) {
    throw new CapturePhotoError("invalid")
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  inspectPhoto(bytes, file.type)
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await platform.createBitmap(file, { imageOrientation: "from-image" })
    const dimensions = validDimensions(bitmap.width, bitmap.height)
    if (!dimensions) throw new CapturePhotoError("dimensions")
    if (dimensions.width * dimensions.height > CAPTURE_PHOTO_MAX_PIXELS) {
      throw new CapturePhotoError("dimensions")
    }

    let scale = Math.min(1, CAPTURE_PHOTO_MAX_EDGE / Math.max(dimensions.width, dimensions.height))
    const minimumScale = Math.min(1, 1_200 / Math.max(dimensions.width, dimensions.height))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const size = targetSize(dimensions.width, dimensions.height, scale)
      const canvas = platform.createCanvas()
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext("2d", { alpha: false })
      if (!context) throw new CapturePhotoError("processing")
      context.fillStyle = "#fff"
      context.fillRect(0, 0, size.width, size.height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = "high"
      context.drawImage(bitmap, 0, 0, size.width, size.height)

      for (const quality of [0.84, 0.74, 0.64]) {
        const blob = await canvasBlob(canvas, quality)
        if (blob.size <= CAPTURE_PHOTO_MAX_PREPARED_BYTES) {
          return new File([blob], "capture.jpg", { type: "image/jpeg", lastModified: 0 })
        }
      }
      if (scale <= minimumScale) break
      scale = Math.max(minimumScale, scale * 0.8)
    }
    throw new CapturePhotoError("dimensions")
  } catch (error) {
    if (error instanceof CapturePhotoError) throw error
    throw new CapturePhotoError("processing")
  } finally {
    bitmap?.close()
  }
}
