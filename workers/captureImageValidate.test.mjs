import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURE_IMAGE_MAX_EDGE,
  CAPTURE_IMAGE_MAX_PIXELS,
  CaptureImageError,
  validatePreparedCaptureImage,
} from "./captureImageValidate.mjs";

function segment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function jfif() {
  return segment(0xe0, [
    0x4a, 0x46, 0x49, 0x46, 0,
    1, 1, 0,
    0, 1, 0, 1,
    0, 0,
  ]);
}

function sof0(width, height) {
  return segment(0xc0, [
    8,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    3,
    1, 0x11, 0,
    2, 0x11, 0,
    3, 0x11, 0,
  ]);
}

function sos() {
  return segment(0xda, [
    3,
    1, 0,
    2, 0x11,
    3, 0x11,
    0, 63, 0,
  ]);
}

function jpeg(width = 1200, height = 800, extra = []) {
  return new Uint8Array([
    0xff, 0xd8,
    ...jfif(),
    ...extra,
    ...sof0(width, height),
    ...sos(),
    0x11, 0xff, 0x00, 0x22,
    0xff, 0xd9,
  ]);
}

test("accepts bounded baseline JPEGs already prepared by the browser without decoding them", () => {
  const bytes = jpeg();
  const prepared = validatePreparedCaptureImage(bytes, "image/jpeg");
  assert.deepEqual(prepared, {
    bytes,
    width: 1200,
    height: 800,
    contentType: "image/jpeg",
  });
  assert.equal(prepared.bytes, bytes);
  assert.equal(CAPTURE_IMAGE_MAX_PIXELS, 8_000_000);
  assert.equal(CAPTURE_IMAGE_MAX_EDGE, 2_400);
});

test("rejects metadata, non-JPEG input, malformed scans, and trailing bytes", () => {
  const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0]);
  assert.throws(() => validatePreparedCaptureImage(jpeg(1200, 800, exif), "image/jpeg"),
    (error) => error instanceof CaptureImageError && error.code === "invalid");
  assert.throws(() => validatePreparedCaptureImage(jpeg(), "image/png"), CaptureImageError);
  assert.throws(() => validatePreparedCaptureImage(jpeg().slice(0, -2), "image/jpeg"), CaptureImageError);
  assert.throws(() => validatePreparedCaptureImage(new Uint8Array([...jpeg(), 0]), "image/jpeg"), CaptureImageError);
});

test("rejects images above the pixel or edge limits before storage promotion", () => {
  assert.throws(() => validatePreparedCaptureImage(jpeg(3000, 1000), "image/jpeg"),
    (error) => error instanceof CaptureImageError && error.code === "dimensions");
  assert.equal(validatePreparedCaptureImage(jpeg(2400, 2400), "image/jpeg").width, 2400);
  assert.throws(() => validatePreparedCaptureImage(jpeg(2401, 1), "image/jpeg"),
    (error) => error instanceof CaptureImageError && error.code === "dimensions");
});
