declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    constructor(buffer?: ArrayBuffer | null, numBytes?: number);
    /** Decodes a JPEG lossless frame; returns 8- or 16-bit samples depending on numBytes. */
    decode(buffer: ArrayBuffer, offset?: number, length?: number, numBytes?: number): Uint8Array | Uint16Array | Int16Array;
  }
}
