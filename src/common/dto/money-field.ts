import { Matches } from 'class-validator';

export const IsMoney = () =>
  Matches(/^-?\d+(\.\d{1,2})?$/, { message: 'Amount must have at most 2 decimal places' });

export const IsQuantity = () =>
  Matches(/^-?\d+(\.\d{1,4})?$/, { message: 'Quantity must have at most 4 decimal places' });
