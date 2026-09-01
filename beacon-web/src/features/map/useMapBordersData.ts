import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { iataQueries } from "../../api/queries";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from "geojson";
import type { IataBorder } from "../../api/client";

export type BorderProps = { iata: string; [key: string]: unknown };
export type BorderFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  BorderProps
>;

// Merge each IATA's border into one collection, dropping the ones with no border and stamping the
// IATA code onto every feature so the layer can style/label per region.
export function mergeBorders(
  entries: { iata: string; border: IataBorder | null }[],
): BorderFeatureCollection {
  const features = entries.flatMap((e) =>
    e.border
      ? [
          {
            ...e.border,
            properties: { ...(e.border.properties ?? {}), iata: e.iata },
          } as Feature<Polygon | MultiPolygon, BorderProps>,
        ]
      : [],
  );
  return { type: "FeatureCollection", features };
}

// Fetch the border for each active IATA (only while `enabled`), then merge into one collection.
// Borders are static, so each is cached indefinitely and most IATAs simply have none (204 -> null).
export function useMapBordersData(
  iataCodes: string[],
  enabled: boolean,
): BorderFeatureCollection {
  const results = useQueries({
    queries: iataCodes.map((iata) => ({
      ...iataQueries.border(iata),
      enabled,
    })),
  });

  // useQueries returns a fresh array each render; a border is immutable once fetched, so a signature
  // of which IATAs have resolved one is enough to keep the collection reference stable between renders.
  const sig = iataCodes
    .map((iata, i) => `${iata}:${results[i]?.data ? 1 : 0}`)
    .join("|");
  return useMemo(
    () =>
      mergeBorders(
        iataCodes.map((iata, i) => ({
          iata,
          border: results[i]?.data ?? null,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig captures iataCodes + which borders loaded
    [sig],
  );
}
