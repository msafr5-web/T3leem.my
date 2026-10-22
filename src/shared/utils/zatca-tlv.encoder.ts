/**
 * ZATCA e-invoice QR payload: Tag-Length-Value records, concatenated, then Base64-encoded.
 *
 *   Tag 1  Seller name                 (UTF-8)
 *   Tag 2  Seller VAT registration no. (UTF-8, 15 digits)
 *   Tag 3  Invoice timestamp           (UTF-8, ISO 8601)
 *   Tag 4  Invoice total incl. VAT     (UTF-8, e.g. "1150.00")
 *   Tag 5  VAT total                   (UTF-8, e.g. "150.00")
 *   --- Phase 2 (integration) additionally requires: ---
 *   Tag 6  Invoice hash (SHA-256 of the canonical XML, Base64 text)
 *   Tag 7  ECDSA signature             (Base64 text)
 *   Tag 8  ECDSA public key            (raw bytes)
 *   Tag 9  Certificate signature       (raw bytes; simplified invoices only)
 *
 * The length field is a single byte, so a value longer than 255 bytes cannot be encoded.
 * The reference implementation silently truncated the length (`[valBuf.length]` wraps mod 256),
 * producing a corrupt QR; this version throws instead.
 */
export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
  invoiceHash?: string;
  ecdsaSignature?: string;
  ecdsaPublicKey?: Buffer;
  certificateSignature?: Buffer;
}

const MAX_TLV_VALUE_BYTES = 255;

export class ZatcaTlvEncoder {
  static encodeField(tag: number, value: string | Buffer): Buffer {
    if (!Number.isInteger(tag) || tag < 1 || tag > 255) {
      throw new RangeError(`Invalid TLV tag: ${tag}`);
    }
    const valBuf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    if (valBuf.length === 0) {
      throw new RangeError(`TLV tag ${tag} has an empty value`);
    }
    if (valBuf.length > MAX_TLV_VALUE_BYTES) {
      throw new RangeError(`TLV tag ${tag} value is ${valBuf.length} bytes; max is ${MAX_TLV_VALUE_BYTES}`);
    }
    return Buffer.concat([Buffer.from([tag]), Buffer.from([valBuf.length]), valBuf]);
  }

  /** Signature-compatible with the SWET reference: tags 1–5 (Phase 1 / pre-signing QR). */
  static generateQrCode(seller: string, vatNum: string, timestamp: string, total: string, vatTotal: string): string {
    return this.encode({ sellerName: seller, vatNumber: vatNum, timestamp, totalWithVat: total, vatTotal });
  }

  /** Full encoder. Optional Phase 2 tags are appended in order when present. */
  static encode(fields: ZatcaQrFields): string {
    const records: Buffer[] = [
      this.encodeField(1, fields.sellerName),
      this.encodeField(2, fields.vatNumber),
      this.encodeField(3, fields.timestamp),
      this.encodeField(4, fields.totalWithVat),
      this.encodeField(5, fields.vatTotal),
    ];
    if (fields.invoiceHash !== undefined) records.push(this.encodeField(6, fields.invoiceHash));
    if (fields.ecdsaSignature !== undefined) records.push(this.encodeField(7, fields.ecdsaSignature));
    if (fields.ecdsaPublicKey !== undefined) records.push(this.encodeField(8, fields.ecdsaPublicKey));
    if (fields.certificateSignature !== undefined) records.push(this.encodeField(9, fields.certificateSignature));
    return Buffer.concat(records).toString('base64');
  }

  /** Inverse of `encode`, used by tests and by the public invoice verification endpoint. */
  static decode(base64: string): Map<number, Buffer> {
    const buf = Buffer.from(base64, 'base64');
    const out = new Map<number, Buffer>();
    let offset = 0;
    while (offset < buf.length) {
      if (offset + 2 > buf.length) throw new Error('Truncated TLV header');
      const tag = buf.readUInt8(offset);
      const length = buf.readUInt8(offset + 1);
      const start = offset + 2;
      const end = start + length;
      if (end > buf.length) throw new Error(`Truncated TLV value for tag ${tag}`);
      out.set(tag, buf.subarray(start, end));
      offset = end;
    }
    return out;
  }
}
