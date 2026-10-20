import { describe, expect, it } from '@jest/globals';
import { PriceService } from './price.service';

describe('PriceService', () => {
  const service = new PriceService();

  it('adds 25% VAT by default, rounded to cents', () => {
    expect(service.withVat(10)).toBe(12.5);
    expect(service.withVat(0.333)).toBe(0.42);
  });

  it('takes another VAT rate', () => {
    expect(new PriceService(0.1).withVat(10)).toBe(11);
  });

  it('calls a zero price free', () => {
    expect(service.isFree(0)).toBe(true);
  });

  it('calls any other price not free', () => {
    expect(service.isFree(1)).toBe(false);
    expect(service.isFree(-1)).toBe(false);
  });
});
