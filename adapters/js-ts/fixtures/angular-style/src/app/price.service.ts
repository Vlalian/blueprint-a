import { Injectable } from './injectable';

@Injectable({ providedIn: 'root' })
export class PriceService {
  constructor(private readonly vatRate = 0.25) {}

  withVat(net: number): number {
    return Math.round(net * (1 + this.vatRate) * 100) / 100;
  }

  isFree(price: number): boolean {
    return price === 0;
  }
}
