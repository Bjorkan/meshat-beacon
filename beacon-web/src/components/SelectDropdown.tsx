import * as Select from '@radix-ui/react-select';
import { useTranslation } from 'react-i18next';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectDropdownProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  align?: 'left' | 'right';
  allLabel?: string;
  hideAll?: boolean;
  fullWidth?: boolean;
}

const ALL_VALUE = '__beacon_all__';

export function SelectDropdown({
  label,
  options,
  value,
  onChange,
  align = 'right',
  allLabel,
  hideAll = false,
  fullWidth = false,
}: SelectDropdownProps) {
  const { t } = useTranslation();
  const visibleAllLabel = allLabel ?? t('common.all');
  const active = value !== '';
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <Select.Root
      value={value || ALL_VALUE}
      onValueChange={(next) => onChange(next === ALL_VALUE ? '' : next)}
      disabled={hideAll && options.length === 0}
    >
      <Select.Trigger
        aria-label={label}
        className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-sm border font-mono cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-primary ${
          fullWidth ? 'w-full justify-between' : ''
        } ${
          active
            ? 'border-primary-dim bg-primary/6 text-primary'
            : 'border-border bg-bg-surface text-text-muted hover:border-text-dim hover:text-text-normal'
        }`}
      >
        <span>{label}</span>
        <Select.Value aria-label={active ? selectedLabel : visibleAllLabel}>
          <span className={active ? 'text-primary' : 'text-text-dim'}>
            {active ? selectedLabel : visibleAllLabel}
          </span>
        </Select.Value>
        <Select.Icon className="text-text-dim text-[9px]">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          align={align === 'left' ? 'start' : 'end'}
          collisionPadding={12}
          className="z-50 w-52 max-w-[calc(100vw-1.5rem)] bg-bg-raised border border-border rounded-md shadow-lg overflow-hidden focus:outline-none"
        >
          <Select.Viewport className="py-1 max-h-80">
            {!hideAll && (
              <Select.Item
                value={ALL_VALUE}
                className="relative w-full px-2.5 py-1 text-xs font-mono text-text-muted data-[highlighted]:text-text-normal data-[highlighted]:bg-text-normal/3 data-[state=checked]:text-text-bright data-[state=checked]:bg-primary/10 outline-none cursor-pointer"
              >
                <Select.ItemText>{visibleAllLabel}</Select.ItemText>
              </Select.Item>
            )}
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative w-full px-2.5 py-1 text-xs font-mono text-text-muted data-[highlighted]:text-text-normal data-[highlighted]:bg-text-normal/3 data-[state=checked]:text-text-bright data-[state=checked]:bg-primary/10 data-[disabled]:opacity-40 outline-none cursor-pointer"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
