import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyButton } from '../../src/components/CopyButton';

const writeText = vi.fn();

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    writable: true,
    configurable: true,
  });
  writeText.mockReset().mockResolvedValue(undefined);
});

describe('CopyButton', async () => {
  it("shows the default 'Copy' label", async () => {
    render(<CopyButton value="deadbeef" />);
    expect(screen.getByRole('button')).toHaveTextContent('Copy');
  });

  it('writes the full value to the clipboard on click', async () => {
    const key = '0123456789abcdef0123456789abcdef';
    render(<CopyButton value={key} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(writeText).toHaveBeenCalledWith(key);
  });

  it("swaps to 'Copied' after clicking, then reverts", async () => {
    vi.useFakeTimers();
    try {
      render(<CopyButton value="deadbeef" />);
      const button = screen.getByRole('button');
      await act(async () => {
        fireEvent.click(button);
      });
      expect(button).toHaveTextContent('Copied');
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(button).toHaveTextContent('Copy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the provided aria-label for the accessible name', async () => {
    render(<CopyButton value="deadbeef" ariaLabel="Copy public key" />);
    expect(screen.getByRole('button', { name: 'Copy public key' })).toBeInTheDocument();
  });
});

it('reports clipboard denial and can retry successfully', async () => {
  writeText.mockRejectedValueOnce(new Error('permission denied'));
  render(<CopyButton value="abc" />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
  expect(screen.getByRole('button')).toHaveTextContent('Copy failed');
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
  expect(screen.getByRole('button')).toHaveTextContent('Copied');
});

it('does not report success while the clipboard write is pending', async () => {
  let resolve!: () => void;
  writeText.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  render(<CopyButton value="abc" />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  await act(async () => {
    resolve();
  });
  expect(screen.getByRole('button')).toHaveTextContent('Copied');
});
