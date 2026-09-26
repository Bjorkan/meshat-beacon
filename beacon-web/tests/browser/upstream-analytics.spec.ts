import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`upstream analytics keep Swedish labels, regional queries and comparison deep links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('beacon-language', 'sv');
      localStorage.setItem(
        'beacon-region-selection',
        JSON.stringify({ regions: [], iatas: ['STO'] }),
      );
      sessionStorage.setItem('meshat-splash-shown', '1');
    });
    await page.routeWebSocket('**/ws', () => {});
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requested: URL[] = [];
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      requested.push(url);
      const endpoint = url.pathname.split('/').at(-1);
      let json: unknown = [];
      if (endpoint === 'signal')
        json = {
          since: Number(url.searchParams.get('since')),
          until: Number(url.searchParams.get('until')),
          receptions: 0,
          snr: { samples: 0, average: null, histogram: [] },
          rssi: { samples: 0, average: null, histogram: [] },
          hourly: [],
        };
      if (endpoint === 'paths')
        json = {
          since: Number(url.searchParams.get('since')),
          until: Number(url.searchParams.get('until')),
          receptions: 0,
          hashed: 0,
          empty: 0,
          trace: 0,
          unclassified: 0,
          hashWidths: [],
          pathLengths: [],
          hourly: [],
        };
      if (endpoint === 'observers') json = { items: [], hasMore: false };
      if (url.pathname.startsWith('/api/v1/observers/'))
        json = {
          id: endpoint,
          publicKey: 'aa',
          displayName: endpoint?.startsWith('1') ? 'Tak' : 'Kulle',
          iata: 'STO',
          firstSeen: 0,
          lastSeen: 0,
          observationCount: 0,
          brokers: [],
        };
      if (endpoint === 'observer-comparison')
        json = {
          observerA: url.searchParams.get('observerA'),
          observerB: url.searchParams.get('observerB'),
          since: 1000,
          until: 2000,
          totalPackets: 4,
          onlyA: 1,
          onlyB: 2,
          both: 1,
        };
      await route.fulfill({ json });
    });
    for (const [tab, title, endpoint] of [
      ['traffic', 'Trafik', 'observations'],
      ['signal', 'RF / Signal', 'signal'],
      ['paths', 'Vägar och hashar', 'paths'],
      ['scopes', 'Transportområden', 'scopes'],
    ]) {
      await page.goto(`/analytics?statsTab=${tab}&range=24h`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect
        .poll(() =>
          requested.some(
            (url) =>
              url.pathname === `/api/v1/stats/${endpoint}` &&
              url.searchParams.get('iatas') === 'STO',
          ),
        )
        .toBe(true);
    }
    await page.goto(
      '/analytics?statsTab=compare&compareA=11111111-1111-1111-1111-111111111111&compareB=22222222-2222-2222-2222-222222222222&compareSince=1000&compareUntil=2000',
    );
    await expect(page.getByRole('table', { name: 'Jämförelse av flood-paket' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Endast A.*1.*25.0%/ })).toBeVisible();
    expect(
      requested
        .find((url) => url.pathname.endsWith('/observer-comparison'))
        ?.searchParams.get('since'),
    ).toBe('1000');
    expect(errors).toEqual([]);
  });
}
