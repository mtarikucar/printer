import { test, expect } from "@playwright/test";

/**
 * Marketing attribution capture (edge middleware).
 *
 * Every visitor must get first-party measurement cookies so a paid order can be
 * traced back to the campaign that drove it — independent of any third-party
 * pixel or consent. This exercises the real middleware against the dev server:
 *
 *   1. A landing URL with UTM/click params writes first-touch + last-touch
 *      attribution cookies (`fig_ft`, `fig_lt`) plus a stable visitor id
 *      (`fig_vid`) and a session id (`fig_sid`).
 *   2. First-touch is write-once: a later visit with a *different* campaign
 *      updates last-touch but leaves first-touch intact.
 *
 * No DB/pixels involved — this only asserts middleware cookie behaviour.
 */

function cookie(cookies: { name: string; value: string }[], name: string) {
  return cookies.find((c) => c.name === name);
}

test.describe("Attribution — middleware cookie capture", () => {
  test("captures first/last touch + visitor + session on a UTM landing", async ({
    page,
    context,
  }) => {
    await page.goto(
      "/?utm_source=google&utm_medium=cpc&utm_campaign=launch&gclid=abc123"
    );

    const cookies = await context.cookies();
    const ft = cookie(cookies, "fig_ft");
    const lt = cookie(cookies, "fig_lt");

    expect(cookie(cookies, "fig_vid")?.value, "visitor id set").toBeTruthy();
    expect(cookie(cookies, "fig_sid")?.value, "session id set").toBeTruthy();
    expect(ft?.value, "first-touch set").toBeTruthy();
    expect(lt?.value, "last-touch set").toBeTruthy();

    const ftJson = JSON.parse(decodeURIComponent(ft!.value));
    expect(ftJson.utmSource).toBe("google");
    expect(ftJson.utmCampaign).toBe("launch");
    expect(ftJson.gclid).toBe("abc123");
    // gclid is present → derived channel is paid_search.
    expect(ftJson.channel).toBe("paid_search");
  });

  test("first-touch is write-once; last-touch updates on a new campaign", async ({
    page,
    context,
  }) => {
    await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=first");
    const firstTouch = cookie(await context.cookies(), "fig_ft")!.value;

    await page.goto("/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=second");
    const cookies = await context.cookies();

    expect(cookie(cookies, "fig_ft")!.value, "first-touch unchanged").toBe(
      firstTouch
    );
    const lt = JSON.parse(decodeURIComponent(cookie(cookies, "fig_lt")!.value));
    expect(lt.utmCampaign, "last-touch updated").toBe("second");
    expect(lt.utmSource).toBe("tiktok");
  });
});
