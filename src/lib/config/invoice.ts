/** Customer sale price, before applying payment tender (including gift cards). */
export function invoiceBasisKurus(order: {
  amountKurus: number;
  havaleDiscountKurus: number;
}): number {
  return order.amountKurus - order.havaleDiscountKurus;
}
