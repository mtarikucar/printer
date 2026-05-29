import { test, expect } from "@playwright/test";

/**
 * Customer-facing flows added across Faz 1–4, exercised on the real track page
 * with the backend mocked via page.route() (same approach as
 * payment-track.spec.ts — real components, no DB/Redis).
 *
 * Covers: order chat (Faz 1), KDV invoice (Faz 2), dispute/report-a-problem +
 * carrier tracking link (Faz 3).
 */

const REF = "FIG-E2E-FAZ";

function shippedOrderBody() {
  return {
    orderNumber: REF,
    status: "shipped",
    customerName: "Test User",
    trackingNumber: "1234567890",
    carrier: "yurtici",
    paidAt: new Date(Date.now() - 86_400_000).toISOString(),
    shippedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    isPublic: false,
    publicDisplayName: null,
    glbUrl: null,
    paymentMethod: "card",
    paymentStatus: "succeeded",
    amountKurus: 139900,
    giftCardAmountKurus: 0,
    havaleDiscountKurus: 0,
    failureReason: null,
    bankTransfer: null,
    bankTransferHistory: null,
  };
}

test.describe("Customer order flows (Faz 1–4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/track/${REF}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(shippedOrderBody()),
      })
    );
  });

  test("carrier tracking link points to the carrier site", async ({ page }) => {
    await page.route(`**/api/customer/orders/${REF}/messages`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
    );
    await page.route(`**/api/customer/orders/${REF}/dispute`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
    );

    await page.goto(`/track/${REF}`);

    const link = page.getByRole("link", { name: /Kargoyu takip et|Track shipment/i });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute("href", /yurticikargo\.com/);
    await expect(link).toHaveAttribute("href", /1234567890/);
  });

  test("order chat renders admin message and sends a reply (Faz 1)", async ({ page }) => {
    let posted = false;
    await page.route(`**/api/customer/orders/${REF}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        posted = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, id: "m2" }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              senderType: "admin",
              body: "Merhaba, siparişiniz yolda!",
              attachmentUrl: null,
              createdAt: new Date().toISOString(),
              mine: false,
            },
          ],
          unreadCount: 0,
          customerNote: "",
          noteEditable: true,
        }),
      });
    });
    await page.route(`**/api/customer/orders/${REF}/messages/read`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
    await page.route(`**/api/customer/orders/${REF}/dispute`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canOpen: true, dispute: null }) })
    );

    await page.goto(`/track/${REF}`);

    await expect(page.getByText("Merhaba, siparişiniz yolda!")).toBeVisible({ timeout: 15_000 });

    const box = page.getByPlaceholder(/mesaj yazın|Type a message/i);
    await box.fill("Teşekkürler!");
    await page.getByRole("button", { name: /^Gönder$|^Send$/i }).click();
    await expect.poll(() => posted, { timeout: 10_000 }).toBe(true);
  });

  test("invoice button reveals the KDV breakdown (Faz 2)", async ({ page }) => {
    await page.route(`**/api/customer/orders/${REF}/messages`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
    );
    await page.route(`**/api/customer/orders/${REF}/dispute`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
    );
    await page.route(`**/api/customer/orders/${REF}/invoice`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invoiceNumber: `FAT-${REF}`,
          subtotalKurus: 116583,
          kdvKurus: 23317,
          totalKurus: 139900,
          kdvRateBps: 2000,
        }),
      })
    );

    await page.goto(`/track/${REF}`);
    await page.getByRole("button", { name: /Faturayı gör|View invoice/i }).click();
    await expect(page.getByText(`FAT-${REF}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/KDV/i)).toBeVisible();
  });

  test("dispute: report-a-problem opens a form and submits (Faz 3)", async ({ page }) => {
    let posted = false;
    await page.route(`**/api/customer/orders/${REF}/messages`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
    );
    await page.route(`**/api/customer/orders/${REF}/dispute`, async (route) => {
      if (route.request().method() === "POST") {
        posted = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ canOpen: true, dispute: null }),
      });
    });

    await page.goto(`/track/${REF}`);
    await page.getByRole("button", { name: /Sorun bildir|Report a problem/i }).click();
    await page.getByPlaceholder(/Sorunu açıklayın|Describe the problem/i).fill("Ürün hasarlı geldi, kutusu ezikti.");
    await page.getByRole("button", { name: /^Gönder$|^Submit$/i }).click();
    await expect.poll(() => posted, { timeout: 10_000 }).toBe(true);
  });
});
