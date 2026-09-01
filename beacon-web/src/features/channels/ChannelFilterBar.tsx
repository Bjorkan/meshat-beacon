import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBar, type SearchFieldOption } from "../../components/SearchBar";
import { SelectDropdown } from "../../components/SelectDropdown";
import { FilterSheet, FiltersButton } from "../../components/FilterSheet";
import { useIsMobile } from "../../hooks/useMediaQuery";
import type { ChannelKeyFilter, ChannelHashtagFilter } from "./channel-filters";

interface ChannelFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  searchField: string;
  onSearchFieldChange: (f: string) => void;
  keyFilter: ChannelKeyFilter;
  onKeyChange: (v: ChannelKeyFilter) => void;
  hashtagFilter: ChannelHashtagFilter;
  onHashtagChange: (v: ChannelHashtagFilter) => void;
}

export function ChannelFilterBar({
  search,
  onSearchChange,
  searchField,
  onSearchFieldChange,
  keyFilter,
  onKeyChange,
  hashtagFilter,
  onHashtagChange,
}: ChannelFilterBarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  // close the sheet when leaving mobile — derive during render, not in an effect
  if (sheetOpen && !isMobile) setSheetOpen(false);

  const activeCount = [keyFilter, hashtagFilter].filter(Boolean).length;
  const searchFields: SearchFieldOption[] = [
    { value: "name", label: t("fields.name") },
    { value: "hash", label: t("fields.hash") },
  ];
  const keyOptions = [
    { value: "known", label: t("options.known") },
    { value: "unknown", label: t("options.unknown") },
  ];
  const hashtagOptions = [
    { value: "true", label: t("common.yes") },
    { value: "false", label: t("common.no") },
  ];
  const clearAll = () => {
    onKeyChange("");
    onHashtagChange("");
  };

  // shared by the desktop inline bar and the mobile filter sheet
  const controls = (fullWidth: boolean) => (
    <>
      <SelectDropdown label={t("filters.key")} options={keyOptions} allLabel={t("common.any")} value={keyFilter} onChange={(v) => onKeyChange(v as ChannelKeyFilter)} fullWidth={fullWidth} />
      <SelectDropdown label={t("filters.hashtag")} options={hashtagOptions} allLabel={t("common.any")} value={hashtagFilter} onChange={(v) => onHashtagChange(v as ChannelHashtagFilter)} fullWidth={fullWidth} />
    </>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border-subtle bg-bg-base shrink-0" role="toolbar" aria-label={t("filters.channel")}>
        <SearchBar value={search} onChange={onSearchChange} fields={searchFields} field={searchField} onFieldChange={onSearchFieldChange} />
        <FiltersButton activeCount={activeCount} onClick={() => setSheetOpen(true)} />
        {sheetOpen && (
          <FilterSheet onClose={() => setSheetOpen(false)} onClear={activeCount > 0 ? clearAll : undefined}>
            {controls(true)}
          </FilterSheet>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 gap-y-1.5 px-4 py-2 border-b border-border-subtle bg-bg-base shrink-0"
      role="toolbar"
      aria-label={t("filters.channel")}
    >
      <SearchBar
        value={search}
        onChange={onSearchChange}
        fields={searchFields}
        field={searchField}
        onFieldChange={onSearchFieldChange}
      />

      <span className="text-border text-sm mx-0.5" aria-hidden>│</span>

      {controls(false)}
    </div>
  );
}
