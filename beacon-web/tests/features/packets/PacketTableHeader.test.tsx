import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PacketTableHeader } from "../../../src/features/packets/PacketTableHeader";
import { GRID_TEMPLATE } from "../../../src/features/packets/packet-grid";

describe("PacketTableHeader", () => {
  it("uses the denser information architecture", () => {
    render(<PacketTableHeader />);
    for (const h of ["Hash", "Type", "Route", "Observer / Area", "Path", "Obs", "Hops · Hash", "Age"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.queryByText("IATA")).not.toBeInTheDocument();
    expect(screen.queryByText("Hash Size")).not.toBeInTheDocument();
  });

  it("is hidden below lg and shares the exact grid with rows", () => {
    const { container } = render(<PacketTableHeader />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("hidden");
    expect(el.className).toContain("lg:grid");
    expect(el.style.gridTemplateColumns).toBe(GRID_TEMPLATE);
    expect(el.children).toHaveLength(9);
  });

  it("uses only font-independent tracks so separate header/row grids align", () => {
    expect(GRID_TEMPLATE).not.toMatch(/\bch\b/);
    expect(GRID_TEMPLATE).not.toMatch(/auto|min-content|max-content|fit-content/);
  });

  it("does not exceed the previous 42.75rem minimum track width", () => {
    const minimumRem = [...GRID_TEMPLATE.matchAll(/(?:minmax\()?([\d.]+)rem/g)]
      .reduce((sum, match) => sum + Number(match[1]), 0);
    expect(minimumRem).toBeLessThanOrEqual(42.75);
  });

  it("leaves the leading chevron-alignment cell unlabeled", () => {
    const { container } = render(<PacketTableHeader />);
    const first = container.firstElementChild?.children[0];
    expect(first).toHaveAttribute("aria-hidden");
    expect(first?.textContent).toBe("");
  });
});
