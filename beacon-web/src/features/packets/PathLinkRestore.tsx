// Restores a shared "?path" link once its detail arrives. A copied path link carries ?hash without
// ?analyze (PacketPathMapModal's Copy Link strips it), so this can't reuse the analyzer drawer's
// fetch and needs its own — sharing packetQueries.detail's cache means that costs nothing extra
// when both params are present.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { packetQueries } from "../../api/queries";
import type { PacketDetail } from "../../types/api";

export function PathLinkRestore({ initialPath, hash, analyzerDetail, onRestore }: {
  initialPath: string | null;
  hash: string | null;
  analyzerDetail: PacketDetail | undefined;
  onRestore: (detail: PacketDetail, key: string) => void;
}) {
  const { data: pathLinkDetail } = useQuery(packetQueries.detail(initialPath && !analyzerDetail ? hash : null));
  const handledRef = useRef(false);

  useEffect(() => {
    const detail = analyzerDetail ?? pathLinkDetail;
    if (!initialPath || !detail || handledRef.current) return;
    handledRef.current = true;
    onRestore(detail, initialPath);
  }, [initialPath, analyzerDetail, pathLinkDetail, onRestore]);

  return null;
}
