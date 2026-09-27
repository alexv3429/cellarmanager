import decodeJpeg, { init as initJpegDecoder } from "@jsquash/jpeg/decode";
import encodeJpeg, { init as initJpegEncoder } from "@jsquash/jpeg/encode";
import decodePng, { init as initPngDecoder } from "@jsquash/png/decode";
import resizeImage, { initResize } from "@jsquash/resize";

// Wrangler imports these as compiled WebAssembly modules. Supplying them
// explicitly avoids runtime URL loading inside the Worker.
import JPEG_DECODE_WASM from "../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import JPEG_ENCODE_WASM from "../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";
import PNG_DECODE_WASM from "../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import RESIZE_WASM from "../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm";

import { normalizeCaptureImage } from "./captureImageNormalize.mjs";

let codecsReady;

function initializeCodecs() {
  if (!codecsReady) {
    codecsReady = Promise.all([
      initJpegDecoder(JPEG_DECODE_WASM),
      initJpegEncoder(JPEG_ENCODE_WASM),
      initPngDecoder(PNG_DECODE_WASM),
      initResize(RESIZE_WASM),
    ]);
  }
  return codecsReady;
}

export async function preprocessCaptureImage(bytes, contentType) {
  await initializeCodecs();
  return normalizeCaptureImage(bytes, contentType, {
    decodeJpeg,
    decodePng,
    resize: resizeImage,
    encodeJpeg,
  });
}
