import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectDropdown } from '../../src/components/SelectDropdown';

describe('SelectDropdown', () => {
  it('uses standard keyboard navigation and skips disabled options', async () => {
    const onChange = vi.fn();
    render(
      <SelectDropdown
        label="Type"
        value=""
        onChange={onChange}
        options={[
          { value: 'blocked', label: 'Blocked', disabled: true },
          { value: 'repeater', label: 'Repeater' },
        ]}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Type' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', code: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Repeater'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('repeater'));
    expect(trigger).toHaveFocus();
  });

  it('dismisses with Escape and restores focus to its trigger', async () => {
    render(
      <SelectDropdown
        label="Type"
        value=""
        onChange={() => {}}
        options={[{ value: 'repeater', label: 'Repeater' }]}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Type' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
