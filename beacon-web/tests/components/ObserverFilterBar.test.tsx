import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObserverFilterBar } from '../../src/features/observers/ObserverFilterBar';

it('keeps an active type visible and clearable with no result-derived options', () => {
  const change = vi.fn();
  render(
    <ObserverFilterBar
      search=""
      onSearchChange={() => {}}
      searchField="name"
      onSearchFieldChange={() => {}}
      statusFilter=""
      onStatusChange={() => {}}
      typeFilter="meshcore"
      onTypeChange={change}
      typeOptions={[]}
      brokerFilter=""
      onBrokerChange={() => {}}
      brokerOptions={[]}
      scopeFilter=""
      onScopeChange={() => {}}
      scopeOptions={[]}
    />,
  );
  const trigger = screen.getByRole('combobox', { name: 'Type' });
  expect(trigger).toHaveTextContent('meshcore');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'All' }));
  expect(change).toHaveBeenCalledWith('');
});
