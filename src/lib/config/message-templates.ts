export interface MessageTemplate {
  key: string;
  labelKey: string; // i18n dictionary key for display name
  channel: "email";
  subjectKey?: string; // i18n key for email subject
  bodyKey: string; // i18n key for message body template
  variables: string[]; // e.g., ["customerName", "orderNumber"]
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "order_update",
    labelKey: "admin.messaging.tpl.orderUpdate",
    channel: "email",
    subjectKey: "admin.messaging.tpl.orderUpdate.subject",
    bodyKey: "admin.messaging.tpl.orderUpdate.body",
    variables: ["customerName", "orderNumber"],
  },
  {
    key: "payment_reminder",
    labelKey: "admin.messaging.tpl.paymentReminder",
    channel: "email",
    subjectKey: "admin.messaging.tpl.paymentReminder.subject",
    bodyKey: "admin.messaging.tpl.paymentReminder.body",
    variables: ["customerName", "orderNumber"],
  },
  {
    key: "shipping_update",
    labelKey: "admin.messaging.tpl.shippingUpdate",
    channel: "email",
    subjectKey: "admin.messaging.tpl.shippingUpdate.subject",
    bodyKey: "admin.messaging.tpl.shippingUpdate.body",
    variables: ["customerName", "orderNumber", "trackingNumber"],
  },
  {
    key: "custom",
    labelKey: "admin.messaging.tpl.custom",
    channel: "email",
    bodyKey: "",
    variables: [],
  },
];
