import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePacketDetail } from "../../../src/features/packets/usePacketDetail";

const getPacketDetail = vi.fn();
vi.mock("../../../src/api/client", () => ({
  getPacketDetail: (hash: string) => getPacketDetail(hash),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => getPacketDetail.mockReset());

describe("usePacketDetail", () => {
  it("does not fetch when hash is null", () => {
    renderHook(() => usePacketDetail(null), { wrapper });
    expect(getPacketDetail).not.toHaveBeenCalled();
  });

  it("fetches the detail for a hash", async () => {
    getPacketDetail.mockResolvedValue({ packetHash: "AA11", observations: [] });
    const { result } = renderHook(() => usePacketDetail("AA11"), { wrapper });
    await waitFor(() => expect(result.current.data?.packetHash).toBe("AA11"));
    expect(getPacketDetail).toHaveBeenCalledWith("AA11");
  });
});
