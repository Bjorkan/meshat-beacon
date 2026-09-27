import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const catalogue = JSON.parse(
  readFileSync(
    new URL('../../../beacon-server/internal/meshcoreregion/catalog.json', import.meta.url),
    'utf8',
  ),
) as Array<{ token: string; displayName: string; parentToken: string; level: string }>;

for (const width of [1440, 390]) {
  test(`MeshCore hierarchy sends the real region token at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('beacon-language', 'en');
      sessionStorage.setItem('meshat-splash-shown', '1');
    });
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json =
        path === '/api/v1/nodes/meshcore-regions'
          ? catalogue.map((region) => ({ ...region, nodeCount: 0 }))
          : path === '/api/v1/scopes'
            ? catalogue.filter((region) => region.token !== '*').map((region) => region.token)
            : path === '/api/v1/packets'
              ? { items: [], nextCursor: null, hasMore: false }
              : [];
      await route.fulfill({ json });
    });
    await page.goto('/packets');
    if (width < 640) await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByRole('button', { name: 'Scope', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(3);
    await page.getByRole('button', { name: 'se · Sverige', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(22);
    await page.getByRole('button', { name: 'se06 · Jönköpings län', exact: true }).click();
    const municipality = page.getByRole('checkbox', {
      name: 'se0680 · Jönköpings kommun',
      exact: true,
    });
    await expect(municipality).toBeVisible();
    const request = page.waitForRequest((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/v1/packets' && url.searchParams.get('scopes') === 'se0680';
    });
    await municipality.check();
    await request;
    expect(new URL(page.url()).searchParams.get('scope')).toContain('se0680');
    await expect(municipality).toBeChecked();
    await expect(page.getByRole('navigation', { name: 'Region levels' })).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'se06 · Jönköpings län', exact: true }),
    ).toBeVisible();
    const popup = page.getByRole('dialog').last();
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: `/tmp/beacon-meshcore-regions-${width}.png` });
  });
}
