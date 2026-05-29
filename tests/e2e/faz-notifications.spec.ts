import { test, expect } from "@playwright/test";

/**
 * Customer notification bell (Faz 4) on the account page. Backend mocked via
 * page.route(); the real NotificationBell component is exercised.
 */

test.describe("Notification bell (Faz 4)", () => {
  test("shows the unread badge and marks read on open", async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "u1", email: "test@example.com", fullName: "Test User", phone: "05321234567" },
        }),
      })
    );
    await page.route("**/api/customer/previews**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ previews: [], nextCursor: null }) })
    );
    await page.route("**/api/customer/orders", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [] }) })
    );

    let readPosted = false;
    await page.route("**/api/customer/notifications", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            { id: "n1", type: "order_shipped", title: "Siparişiniz kargolandı", body: "FIG-1 kargoya verildi.", read: false, createdAt: new Date().toISOString() },
            { id: "n2", type: "order_delivered", title: "Siparişiniz teslim edildi", body: "FIG-1 teslim edildi.", read: false, createdAt: new Date().toISOString() },
          ],
          unreadCount: 2,
        }),
      })
    );
    await page.route("**/api/customer/notifications/read", (route) => {
      readPosted = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await page.goto("/account");

    // Unread badge "2" on the bell.
    await expect(page.getByText("2", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Open the bell → notifications listed + read POST fired.
    await page.getByRole("button", { name: /Bildirimler|Notifications/i }).click();
    await expect(page.getByText("Siparişiniz kargolandı")).toBeVisible();
    await expect.poll(() => readPosted, { timeout: 10_000 }).toBe(true);
  });
});
