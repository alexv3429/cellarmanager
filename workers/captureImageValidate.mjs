export const CAPTURE_IMAGE_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const CAPTURE_IMAGE_MAX_PIXELS = 8_000_000;
export const CAPTURE_IMAGE_MAX_EDGE = 2_400;

const JPEG_SOF0 = 0xc0;
const JPEG_SOS = 0xda;
const JPEG_APP0 = 0xe0;
const JPEG_APP15 = 0xef;
const JPEG_COM = 0xfe;
const JPEG_HEADER_SCAN_LIMIT = 64 * 1024;

export class CaptureImageError extends Error {
  constructor(code) {
    super(code);
    this.name = "CaptureImageError";
    this.code = code;
  }
}

function invalid() {
  throw new CaptureImageError("invalid");
}

function isSafeJfifApp0(bytes, offset, segmentLength) {
  // Retain only the fixed, metadata-free JFIF header emitted by canvas encoders.
  // JFXX thumbnails and arbitrary APP0 payloads are stripped like other metadata.
  return segmentLength === 16
    && bytes[offset + 2] === 0x4a
    && bytes[offset + 3] === 0x46
    && bytes[offset + 4] === 0x49
    && bytes[offset + 5] === 0x46
    && bytes[offset + 6] === 0
    && bytes[offset + 14] === 0
    && bytes[offset + 15] === 0;
}

function concatenate(parts, tail) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, tail.length));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  result.set(tail, offset);
  return result;
}

function validateSingleScan(bytes, scanOffset) {
  if (scanOffset >= bytes.length - 2
      || bytes[bytes.length - 2] !== 0xff
      || bytes[bytes.length - 1] !== 0xd9) {
    invalid();
  }

  // Baseline, browser-reencoded JPEGs have one scan. Inspect marker escapes
  // without decoding pixels; this also rejects metadata markers after SOS.
  for (let index = bytes.indexOf(0xff, scanOffset); index >= 0 && index < bytes.length - 2;) {
    let markerOffset = index + 1;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
    const marker = bytes[markerOffset];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      index = bytes.indexOf(0xff, markerOffset + 1);
      continue;
    }
    if (marker === 0xd9 && markerOffset === bytes.length - 1) return;
    // The only unescaped marker allowed in image data is the final EOI.
    invalid();
  }
}

export function validatePreparedCaptureImage(bytes, contentType) {
  if (!(bytes instanceof Uint8Array)
      || bytes.length < 16
      || bytes.length > CAPTURE_IMAGE_MAX_SOURCE_BYTES
      || contentType !== "image/jpeg"
      || bytes[0] !== 0xff
      || bytes[1] !== 0xd8
      || bytes[bytes.length - 2] !== 0xff
      || bytes[bytes.length - 1] !== 0xd9) {
    invalid();
  }

  let offset = 2;
  let dimensions = null;
  const retainedHeader = [bytes.subarray(0, 2)];
  let strippedMetadata = false;
  const headerLimit = Math.min(bytes.length - 2, JPEG_HEADER_SCAN_LIMIT);
  while (offset + 4 <= headerLimit) {
    const markerStart = offset;
    if (bytes[offset] !== 0xff) invalid();
    while (offset < headerLimit && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || marker === 0xd9) invalid();

    if (marker === JPEG_SOS) {
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 8 || offset + segmentLength > headerLimit || !dimensions) invalid();
      const scanOffset = offset + segmentLength;
      validateSingleScan(bytes, scanOffset);
      retainedHeader.push(bytes.subarray(markerStart, scanOffset));
      return {
        bytes: strippedMetadata ? concatenate(retainedHeader, bytes.subarray(scanOffset)) : bytes,
        ...dimensions,
        contentType,
      };
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > headerLimit) invalid();

    const isApplicationMetadata = marker >= JPEG_APP0 && marker <= JPEG_APP15;
    const retainJfif = marker === JPEG_APP0 && isSafeJfifApp0(bytes, offset, segmentLength);
    if (retainJfif) {
      retainedHeader.push(bytes.subarray(markerStart, offset + segmentLength));
    } else if (isApplicationMetadata || marker === JPEG_COM) {
      strippedMetadata = true;
    } else {
      retainedHeader.push(bytes.subarray(markerStart, offset + segmentLength));
    }

    if (marker === JPEG_SOF0) {
      if (segmentLength < 11 || dimensions) invalid();
      const precision = bytes[offset + 2];
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (precision !== 8 || components < 1 || segmentLength !== 8 + 3 * components) invalid();
      if (!Number.isSafeInteger(width * height) || width < 1 || height < 1
          || width * height > CAPTURE_IMAGE_MAX_PIXELS
          || Math.max(width, height) > CAPTURE_IMAGE_MAX_EDGE) {
        throw new CaptureImageError("dimensions");
      }
      dimensions = { width, height };
    }

    offset += segmentLength;
  }
  invalid();
}
