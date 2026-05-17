import { test, expect } from "@playwright/test";

/**
 * Track-page payment-recovery flow.
 *
 * Covers the scenario that motivated Wave A/B/C/7/8: a customer pays via
 * PayTR test mode, lands back on `/track/[ref]?payment=success`, and the
 * webhook hasn't (yet or ever) fired. The page must:
 *   1. Fire the verify-payment effect once on mount.
 *   2. Hide the "Ödemeyi tekrar dene" retry CTA while verify is in flight
 *      (so the customer doesn't see two contradictory CTAs).
 *   3. Re-fetch /api/track after verify and reflect the new (succeeded)
 *      state in the UI.
 *
 * We mock both `/api/customer/orders/[ref]/verify-payment` and `/api/track/[ref]`
 * with page.route() so the test doesn't touch the DB or PayTR. The page
 * itself is rendered by the real Next.js dev server (so the test exercises
 * the actual production component code, not a mock).
 */

const REF = "FIG-E2E-CARD";

test.describe("Track page — PayTR card payment recovery", () => {
  test("auto-verifies on return from PayTR and flips UI to succeeded", async ({ page }) => {
    // Mock the verify-payment endpoint — simulates PayTR confirming success.
    let verifyHits = 0;
    await page.route(
      `**/api/customer/orders/${REF}/verify-payment`,
      async (route) => {
        verifyHits += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ state: "confirmed", orderNumber: REF }),
        });
      }
    );

    // First call: pending (mirrors the initial fetch on mount).
    // Subsequent calls: succeeded (post-verify-payment refetch).
    let trackHits = 0;
    await page.route(`**/api/track/${REF}`, async (route) => {
      trackHits += 1;
      const succeeded = trackHits > 1;
      const body = succeeded
        ? {
            orderNumber: REF,
            status: "paid",
            customerName: "Test User",
            trackingNumber: null,
            paidAt: new Date().toISOString(),
            shippedAt: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
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
          }
        : {
            orderNumber: REF,
            status: "pending_payment",
            customerName: "Test User",
            trackingNumber: null,
            paidAt: null,
            shippedAt: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
            isPublic: false,
            publicDisplayName: null,
            glbUrl: null,
            paymentMethod: "card",
            paymentStatus: "pending",
            amountKurus: 139900,
            giftCardAmountKurus: 0,
            havaleDiscountKurus: 0,
            failureReason: null,
            bankTransfer: null,
            bankTransferHistory: null,
          };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    await page.goto(`/track/${REF}?payment=success`);

    // The success banner appears once the post-verify refetch returns
    // paymentStatus="succeeded". Use a generous timeout because the
    // verify-payment promise resolves on its own clock.
    await expect(
      page.getByText(/Ödemeniz alındı|Payment successful/i)
    ).toBeVisible({ timeout: 15_000 });

    // CRITICAL: retry-payment CTA must NOT be on screen — Wave 7 fix.
    // While verify is in flight `verifying` suppresses it, and after verify
    // succeeded paymentStatus !== "pending"/"failed" so the card stays hidden.
    await expect(
      page.getByRole("button", { name: /Ödemeyi tekrar dene|Retry payment/i })
    ).toHaveCount(0);

    // Verify our mocks were exercised: one verify call, ≥2 track fetches.
    expect(verifyHits).toBe(1);
    expect(trackHits).toBeGreaterThanOrEqual(2);

    // The order number is rendered on the page.
    await expect(page.getByText(REF)).toBeVisible();
  });

  test("retry CTA appears when verify reports failed", async ({ page }) => {
    // verify-payment returns "failed" — track then reports paymentStatus="failed".
    await page.route(
      `**/api/customer/orders/${REF}/verify-payment`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "failed",
            reason: "Test failure (mocked)",
          }),
        });
      }
    );

    let trackHits = 0;
    await page.route(`**/api/track/${REF}`, async (route) => {
      trackHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          orderNumber: REF,
          status: "pending_payment",
          customerName: "Test User",
          trackingNumber: null,
          paidAt: null,
          shippedAt: null,
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          isPublic: false,
          publicDisplayName: null,
          glbUrl: null,
          paymentMethod: "card",
          // After verify marks the draft failed, paymentStatus is "failed".
          paymentStatus: trackHits > 1 ? "failed" : "pending",
          amountKurus: 139900,
          giftCardAmountKurus: 0,
          havaleDiscountKurus: 0,
          failureReason: "Test failure (mocked)",
          bankTransfer: null,
          bankTransferHistory: null,
        }),
      });
    });

    await page.goto(`/track/${REF}?payment=success`);

    // After verify settles, the retry CTA becomes visible (no longer suppressed
    // by `verifying`, and paymentStatus is "failed").
    await expect(
      page.getByRole("button", { name: /Ödemeyi tekrar dene|Retry payment/i })
    ).toBeVisible({ timeout: 15_000 });
  });
});
