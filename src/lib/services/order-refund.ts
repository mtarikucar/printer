/** Public refund entry points. Actual transfer evidence is mandatory; cancellation
 * records a cash obligation without pretending that an external refund occurred.
 */
export { readOrderRefundView, recordOrderRefund, cancelPaidOrder } from "./order-refund-record";
export type { RecordRefundInput, RefundResult, RefundFailure, CancelPaidOrderInput, CancelPaidOrderResult } from "@/lib/config/order-refund";
