import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SplashScreen } from "../../src/components/SplashScreen";

describe("SplashScreen branding", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("uses the icon-only Meshat mark with outward radio waves", () => {
    render(<SplashScreen />);

    expect(screen.getByTestId("meshat-splash-icon")).toBeInTheDocument();
    expect(screen.getByTestId("meshat-radio-wave-inner")).toHaveClass("meshat-radio-wave-inner");
    expect(screen.getByTestId("meshat-radio-wave-outer")).toHaveClass("meshat-radio-wave-outer");
  });

  it("calls the product Meshat.se and preserves its analyzer attribution", () => {
    render(<SplashScreen />);

    expect(screen.getByText("Meshat.se")).toBeInTheDocument();
    expect(screen.getByText("MeshCore Network Analyzer")).toBeInTheDocument();
    expect(screen.queryByText("BEACON")).toBeNull();
  });
});
