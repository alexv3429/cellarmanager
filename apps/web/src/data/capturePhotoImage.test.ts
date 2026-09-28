import { describe, expect, it, vi } from "vitest"

vi.mock("./supabase", () => ({ supabase: {} }))

import { prepareCapturePhotoFile } from "./capturePhotoImage"

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ])
}

function fakePlatform(width: number, height: number) {
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["normalized"], { type: "image/jpeg" }))),
  } as unknown as HTMLCanvasElement
  const bitmap = { width, height, close: vi.fn() } as unknown as ImageBitmap
  const createBitmap = vi.fn().mockResolvedValue(bitmap)
  const createCanvas = vi.fn(() => canvas)
  return { platform: { createBitmap, createCanvas }, bitmap, canvas, context }
}

describe("local label photo preprocessing", () => {
  it("orients, downscales, composites on white, and emits a metadata-free JPEG before upload", async () => {
    const source = new File([jpegHeader(4000, 2000)], "family-cellar.jpg", { type: "image/jpeg" })
    const { platform, bitmap, canvas, context } = fakePlatform(4000, 2000)

    const prepared = await prepareCapturePhotoFile(source, platform)

    expect(platform.createBitmap).toHaveBeenCalledWith(source, { imageOrientation: "from-image" })
    expect(canvas.width).toBe(2400)
    expect(canvas.height).toBe(1200)
    expect(context.fillStyle).toBe("#fff")
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2400, 1200)
    expect(prepared).toMatchObject({ name: "capture.jpg", type: "image/jpeg", lastModified: 0 })
    expect(prepared.size).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it("rejects oversized dimensions before invoking a decoder", async () => {
    const source = new File([jpegHeader(6000, 5000)], "large.jpg", { type: "image/jpeg" })
    const { platform } = fakePlatform(6000, 5000)

    await expect(prepareCapturePhotoFile(source, platform)).rejects.toMatchObject({ kind: "dimensions" })
    expect(platform.createBitmap).not.toHaveBeenCalled()
  })

  it("uses the JPEG signature when a mobile picker reports a non-standard MIME type", async () => {
    const source = new File([jpegHeader(1000, 1000)], "family-photo.jpg", { type: "image/jpg" })
    const { platform, canvas } = fakePlatform(1000, 1000)

    const prepared = await prepareCapturePhotoFile(source, platform)

    expect(platform.createBitmap).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/jpeg" }),
      { imageOrientation: "from-image" },
    )
    expect(canvas.toBlob).toHaveBeenCalled()
    expect(prepared.type).toBe("image/jpeg")
  })

  it("also handles a valid JPEG with no picker-provided MIME type", async () => {
    const source = new File([jpegHeader(1000, 1000)], "IMG_1234.JPG", { type: "" })
    const { platform } = fakePlatform(1000, 1000)

    await expect(prepareCapturePhotoFile(source, platform)).resolves.toMatchObject({ type: "image/jpeg" })
    expect(platform.createBitmap).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/jpeg" }),
      { imageOrientation: "from-image" },
    )
  })

  it("rejects unsupported image bytes before invoking a decoder", async () => {
    const source = new File([jpegHeader(1000, 1000)], "wrong.png", { type: "image/png" })
    const unsupported = new File(["not an image"], "photo.heic", { type: "image/heic" })
    const { platform: mislabeledPlatform } = fakePlatform(1000, 1000)
    const { platform: unsupportedPlatform } = fakePlatform(1000, 1000)

    // A mislabeled but recognizable JPEG is safe to normalize based on its bytes.
    await expect(prepareCapturePhotoFile(source, mislabeledPlatform)).resolves.toMatchObject({ type: "image/jpeg" })
    await expect(prepareCapturePhotoFile(unsupported, unsupportedPlatform)).rejects.toMatchObject({ kind: "format" })
    expect(unsupportedPlatform.createBitmap).not.toHaveBeenCalled()
  })
})
