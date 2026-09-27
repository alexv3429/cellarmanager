export const CAPTURE_IMAGE_MAX_SOURCE_BYTES = 6 * 1024 * 1024;
export const CAPTURE_IMAGE_MAX_DECODED_PIXELS = 8_000_000;
export const CAPTURE_IMAGE_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const CAPTURE_IMAGE_MAX_EDGE = 2_400;

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class CaptureImageError extends Error {
  constructor(code) {
    super(code);
    this.name = "CaptureImageError";
    this.code = code;
  }
}

function dimensionsAreSafe(width, height) {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width * height <= CAPTURE_IMAGE_MAX_DECODED_PIXELS;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  if (bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
      || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return dimensionsAreSafe(width, height) ? { width, height } : { width, height, unsafe: true };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return dimensionsAreSafe(width, height) ? { width, height } : { width, height, unsafe: true };
    }
    offset += segmentLength;
  }
  return null;
}

export function inspectCaptureImage(bytes, contentType) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > CAPTURE_IMAGE_MAX_SOURCE_BYTES) {
    throw new CaptureImageError("invalid");
  }
  const jpeg = contentType === "image/jpeg" ? jpegDimensions(bytes) : null;
  const png = contentType === "image/png" ? pngDimensions(bytes) : null;
  const dimensions = jpeg ?? png;
  if (!dimensions) throw new CaptureImageError("invalid");
  if (dimensions.unsafe) throw new CaptureImageError("dimensions");
  return { ...dimensions, contentType };
}

function targetDimensions(width, height, scale) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function makeOpaqueOnWhite(image) {
  if (!image || !ArrayBuffer.isView(image.data) || image.data.BYTES_PER_ELEMENT !== 1
      || image.data.length !== image.width * image.height * 4) {
    throw new CaptureImageError("invalid");
  }
  const pixels = image.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0;
    if (alpha < 255) {
      const opacity = alpha / 255;
      pixels[offset] = Math.round((pixels[offset] ?? 0) * opacity + 255 * (1 - opacity));
      pixels[offset + 1] = Math.round((pixels[offset + 1] ?? 0) * opacity + 255 * (1 - opacity));
      pixels[offset + 2] = Math.round((pixels[offset + 2] ?? 0) * opacity + 255 * (1 - opacity));
      pixels[offset + 3] = 255;
    }
  }
  return image;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new CaptureImageError("invalid");
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

export async function normalizeCaptureImage(bytes, contentType, codecs) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  inspectCaptureImage(source, contentType);
  if (!codecs || typeof codecs.decodeJpeg !== "function" || typeof codecs.decodePng !== "function"
      || typeof codecs.resize !== "function" || typeof codecs.encodeJpeg !== "function") {
    throw new CaptureImageError("unavailable");
  }

  let decoded;
  try {
    decoded = contentType === "image/jpeg"
      ? await codecs.decodeJpeg(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), { preserveOrientation: true })
      : await codecs.decodePng(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  } catch {
    throw new CaptureImageError("invalid");
  }
  if (!decoded || !dimensionsAreSafe(decoded.width, decoded.height)
      || !ArrayBuffer.isView(decoded.data)
      || decoded.data.BYTES_PER_ELEMENT !== 1
      || decoded.data.length !== decoded.width * decoded.height * 4) {
    throw new CaptureImageError("dimensions");
  }

  makeOpaqueOnWhite(decoded);
  let scale = Math.min(1, CAPTURE_IMAGE_MAX_EDGE / Math.max(decoded.width, decoded.height));
  const minimumScale = Math.min(1, 1_200 / Math.max(decoded.width, decoded.height));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const size = targetDimensions(decoded.width, decoded.height, scale);
    let prepared = decoded;
    if (size.width !== decoded.width || size.height !== decoded.height) {
      try {
        prepared = await codecs.resize(decoded, {
          ...size,
          fitMethod: "stretch",
          method: "lanczos3",
        });
      } catch {
        throw new CaptureImageError("unavailable");
      }
    }
    for (const quality of [82, 72, 62]) {
      let output;
      try {
        output = asBytes(await codecs.encodeJpeg(prepared, { quality }));
      } catch {
        throw new CaptureImageError("unavailable");
      }
      if (isJpeg(output) && output.length <= CAPTURE_IMAGE_MAX_OUTPUT_BYTES) {
        return {
          bytes: output,
          width: size.width,
          height: size.height,
          contentType: "image/jpeg",
        };
      }
    }
    if (scale <= minimumScale) break;
    scale = Math.max(minimumScale, scale * 0.8);
  }
  throw new CaptureImageError("too_large");
}
