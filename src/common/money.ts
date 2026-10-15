import { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | string | number;

export function money(value: DecimalLike): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

export function rate(value: DecimalLike): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(4);
}

export function zero(): Prisma.Decimal {
  return money(0);
}

export function sum(values: DecimalLike[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(money(value)), zero());
}

export function subtract(left: DecimalLike, right: DecimalLike): Prisma.Decimal {
  return money(left).minus(money(right));
}

export function percentRatio(numerator: DecimalLike, denominator: DecimalLike): Prisma.Decimal | null {
  const base = money(denominator);
  if (base.isZero()) {
    return null;
  }
  return money(numerator).div(base).times(100).toDecimalPlaces(4);
}

export function jsonMoney(value: Prisma.Decimal | null): string | null {
  return value == null ? null : value.toFixed(2);
}
