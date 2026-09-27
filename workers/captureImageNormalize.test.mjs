import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURE_IMAGE_MAX_DECODED_PIXELS,
  CAPTURE_IMAGE_MAX_EDGE,
  CaptureImageError,
  inspectCaptureImage,
  normalizeCaptureImage,
} from "./captureImageNormalize.mjs";

function jpegHeader(width, height) {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function imageData(width, height, pixels = new Uint8Array(width * height * 4)) {
  return { width, height, data: pixels };
}

test("capture image inspection accepts only matching JPEG/PNG signatures and bounded dimensions", () => {
  assert.deepEqual(inspectCaptureImage(jpegHeader(1200, 800), "image/jpeg"), {
    width: 1200,
    height: 800,
    contentType: "image/jpeg",
  });
  assert.deepEqual(inspectCaptureImage(pngHeader(900, 700), "image/png"), {
    width: 900,
    height: 700,
    contentType: "image/png",
  });
  assert.throws(() => inspectCaptureImage(jpegHeader(100, 100), "image/png"), CaptureImageError);
  assert.throws(() => inspectCaptureImage(jpegHeader(4000, 3000), "image/jpeg"), (error) => error.code === "dimensions");
  assert.equal(CAPTURE_IMAGE_MAX_DECODED_PIXELS, 8_000_000);
});

test("JPEG normalization preserves orientation, bounds long edge, and returns JPEG bytes", async () => {
  const input = jpegHeader(3000, 1500);
  const decoded = imageData(3000, 1500);
  const resized = imageData(2400, 1200);
  const calls = [];
  const output = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const result = await normalizeCaptureImage(input, "image/jpeg", {
    decodeJpeg: async (_bytes, options) => { calls.push(options); return decoded; },
    decodePng: async () => assert.fail("PNG decoder was not expected"),
    resize: async (image, options) => { calls.push(options); return resized; },
    encodeJpeg: async (image, options) => { calls.push(options); return output; },
  });

  assert.deepEqual(calls[0], { preserveOrientation: true });
  assert.equal(calls[1].width, CAPTURE_IMAGE_MAX_EDGE);
  assert.equal(calls[1].height, 1200);
  assert.equal(calls[2].quality, 82);
  assert.deepEqual(result, {
    bytes: output,
    width: 2400,
    height: 1200,
    contentType: "image/jpeg",
  });
});

test("PNG transparency is flattened on white and excessive output triggers bounded downscale", async () => {
  const input = pngHeader(1, 1);
  const rgba = new Uint8Array([100, 0, 0, 128]);
  const encodedSizes = [];
  const resizeSizes = [];
  const finalJpeg = new Uint8Array([0xff, 0xd8, 0, 0xff, 0xd9]);
  const result = await normalizeCaptureImage(input, "image/png", {
    decodeJpeg: async () => assert.fail("JPEG decoder was not expected"),
    decodePng: async () => imageData(1, 1, rgba),
    resize: async (image, options) => {
      resizeSizes.push([options.width, options.height]);
      return image;
    },
    encodeJpeg: async (image, options) => {
      encodedSizes.push([image.width, image.height, options.quality, image.data[0], image.data[3]]);
      return finalJpeg;
    },
  });

  assert.deepEqual(encodedSizes, [[1, 1, 82, 177, 255]]);
  assert.deepEqual(resizeSizes, []);
  assert.equal(result.contentType, "image/jpeg");
});

test("retries a large JPEG at smaller dimensions before failing the output-size cap", async () => {
  const input = jpegHeader(3000, 1500);
  const oversizedJpeg = new Uint8Array(5 * 1024 * 1024 + 1);
  oversizedJpeg.set([0xff, 0xd8], 0);
  oversizedJpeg.set([0xff, 0xd9], oversizedJpeg.length - 2);
  const finalJpeg = new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]);
  const resizedWidths = [];
  const encoded = [];
  const result = await normalizeCaptureImage(input, "image/jpeg", {
    decodeJpeg: async () => imageData(3000, 1500),
    decodePng: async () => assert.fail("PNG decoder was not expected"),
    resize: async (_image, options) => {
      resizedWidths.push(options.width);
      return imageData(options.width, options.height);
    },
    encodeJpeg: async (image, options) => {
      encoded.push([image.width, options.quality]);
      return image.width > 2000 ? oversizedJpeg : finalJpeg;
    },
  });

  assert.equal(result.bytes, finalJpeg);
  assert.deepEqual(resizedWidths, [2400, 1920]);
  assert.equal(encoded.length, 4);
  assert.deepEqual(encoded.at(-1), [1920, 82]);
});

test("decoder is never called for a source over the byte limit or decoded-pixel limit", async () => {
  const decode = async () => assert.fail("Oversized inputs must fail before decode");
  await assert.rejects(
    normalizeCaptureImage(new Uint8Array(6 * 1024 * 1024 + 1), "image/jpeg", {
      decodeJpeg: decode,
      decodePng: decode,
      resize: async () => null,
      encodeJpeg: async () => null,
    }),
    (error) => error instanceof CaptureImageError && error.code === "invalid",
  );
  await assert.rejects(
    normalizeCaptureImage(jpegHeader(4000, 3000), "image/jpeg", {
      decodeJpeg: decode,
      decodePng: decode,
      resize: async () => null,
      encodeJpeg: async () => null,
    }),
    (error) => error instanceof CaptureImageError && error.code === "dimensions",
  );
});
