import { beforeEach, describe, expect, it, vi } from "vitest"

const { createWorker, recognize, terminate } = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock("tesseract.js", () => ({
  default: { OEM: { LSTM_ONLY: 1 }, createWorker },
}))

import { recognizeCapturePhotosLocally } from "./captureOcr"

const firstBlob = new Blob(["private image 1"], { type: "image/jpeg" })
const secondBlob = new Blob(["private image 2"], { type: "image/jpeg" })
const photos = [
  { objectName: "550e8400-e29b-41d4-a716-446655440000", blob: firstBlob },
  { objectName: "f47ac10b-58cc-4372-a567-0e02b2c3d479", blob: secondBlob },
]

beforeEach(() => {
  vi.clearAllMocks()
  createWorker.mockResolvedValue({ recognize, terminate })
  recognize
    .mockResolvedValueOnce({ data: { text: "  Domaine Exemple\n", confidence: 87.6 } })
    .mockResolvedValueOnce({ data: { text: " Bourgogne blanc 2022 ", confidence: 110 } })
})

describe("private on-device label OCR", () => {
  it("uses the local worker, engine and language assets, and returns bounded text only", async () => {
    const onProgress = vi.fn()
    const pages = await recognizeCapturePhotosLocally(photos, {
      origin: "https://cellarmanager.example",
      onProgress,
    })

    expect(createWorker).toHaveBeenCalledOnce()
    expect(createWorker.mock.calls[0]?.[0]).toBe("fra+eng")
    expect(createWorker.mock.calls[0]?.[1]).toBe(1)
    const options = createWorker.mock.calls[0]?.[2]
    expect(options).toMatchObject({
      workerPath: "https://cellarmanager.example/ocr/7.0.0/worker.min.js",
      workerBlobURL: false,
      corePath: "https://cellarmanager.example/ocr/7.0.0/core",
      langPath: "https://cellarmanager.example/ocr/1.0.0/lang",
      gzip: true,
    })
    expect(options.workerPath).toContain("https://cellarmanager.example/")
    expect(options.corePath).not.toContain("cdn")
    expect(options.langPath).not.toContain("cdn")
    expect(recognize).toHaveBeenNthCalledWith(1, firstBlob)
    expect(recognize).toHaveBeenNthCalledWith(2, secondBlob)
    expect(pages).toEqual([
      { objectName: photos[0]?.objectName, text: "Domaine Exemple", confidence: 88 },
      { objectName: photos[1]?.objectName, text: "Bourgogne blanc 2022", confidence: 100 },
    ])
    expect(onProgress).toHaveBeenLastCalledWith({ page: 2, pageCount: 2, progress: 1 })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it("keeps a blank scan retryable and always releases its worker", async () => {
    recognize.mockReset().mockResolvedValue({ data: { text: " \n ", confidence: 0 } })

    await expect(recognizeCapturePhotosLocally([photos[0]!], { origin: "https://cellarmanager.example" })).rejects.toMatchObject({
      name: "CaptureOcrEmptyError",
    })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it("rejects selections outside the private capture size limit before creating a worker", async () => {
    await expect(recognizeCapturePhotosLocally([...photos, photos[0]!])).rejects.toThrow("one or two")
    expect(createWorker).not.toHaveBeenCalled()
  })
})
