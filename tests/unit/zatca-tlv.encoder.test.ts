import { ZatcaTlvEncoder } from '../../src/shared/utils/zatca-tlv.encoder';

describe('ZatcaTlvEncoder', () => {
  // Worked example from ZATCA's QR code guideline.
  const sample = {
    seller: 'Bobs Records',
    vat: '310122393500003',
    timestamp: '2022-04-25T15:30:00Z',
    total: '1000.00',
    vatTotal: '150.00',
  };
  const expectedBase64 =
    'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==';

  it('matches the ZATCA reference encoding for tags 1–5', () => {
    expect(
      ZatcaTlvEncoder.generateQrCode(sample.seller, sample.vat, sample.timestamp, sample.total, sample.vatTotal),
    ).toBe(expectedBase64);
  });

  it('encodes a single field as [tag][length][utf8 bytes]', () => {
    expect([...ZatcaTlvEncoder.encodeField(4, '1150.00')]).toEqual([4, 7, ...Buffer.from('1150.00')]);
  });

  it('uses UTF-8 byte length, not character length, for Arabic seller names', () => {
    const name = 'أكاديمية الفيصل';
    const field = ZatcaTlvEncoder.encodeField(1, name);
    expect(field[1]).toBe(Buffer.byteLength(name, 'utf8'));
    expect(field[1]).toBeGreaterThan(name.length);
  });

  it('round-trips through decode, including Phase 2 binary tags', () => {
    const publicKey = Buffer.from([0x30, 0x56, 0x00, 0xff]);
    const certSig = Buffer.from([0x01, 0x02, 0x03]);
    const encoded = ZatcaTlvEncoder.encode({
      sellerName: 'أكاديمية الفيصل',
      vatNumber: '300000000000003',
      timestamp: '2026-10-22T19:40:00Z',
      totalWithVat: '1150.00',
      vatTotal: '150.00',
      invoiceHash: 'hash==',
      ecdsaSignature: 'sig==',
      ecdsaPublicKey: publicKey,
      certificateSignature: certSig,
    });

    const decoded = ZatcaTlvEncoder.decode(encoded);
    expect([...decoded.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(decoded.get(1)?.toString('utf8')).toBe('أكاديمية الفيصل');
    expect(decoded.get(4)?.toString('utf8')).toBe('1150.00');
    expect(decoded.get(8)).toEqual(publicKey);
    expect(decoded.get(9)).toEqual(certSig);
  });

  it('rejects values over 255 bytes instead of emitting a corrupt length byte', () => {
    expect(() => ZatcaTlvEncoder.encodeField(1, 'x'.repeat(256))).toThrow(RangeError);
    expect(() => ZatcaTlvEncoder.encodeField(1, 'x'.repeat(255))).not.toThrow();
  });

  it('rejects empty values and out-of-range tags', () => {
    expect(() => ZatcaTlvEncoder.encodeField(1, '')).toThrow(RangeError);
    expect(() => ZatcaTlvEncoder.encodeField(0, 'a')).toThrow(RangeError);
    expect(() => ZatcaTlvEncoder.encodeField(256, 'a')).toThrow(RangeError);
  });

  it('detects truncated payloads when decoding', () => {
    expect(() => ZatcaTlvEncoder.decode(Buffer.from([1]).toString('base64'))).toThrow('Truncated TLV header');
    expect(() => ZatcaTlvEncoder.decode(Buffer.from([1, 5, 65]).toString('base64'))).toThrow('Truncated TLV value');
  });
});
