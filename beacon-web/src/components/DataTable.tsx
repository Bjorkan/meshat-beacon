import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  columnVisibilityFeature,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState';
import { SkeletonRows } from './SkeletonRows';
import { useIsMobile } from '../hooks/useMediaQuery';

// TanStack v9 registers features and row-model factories on the instance. Static so the feature
// types stay stable across renders.
const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
});

export interface Column<T extends RowData> {
  // Stable identity, independent of displayed or translated text.
  id?: string;
  header: string;
  label?: string;
  cell: (row: T) => ReactNode;
  className?: string | ((row: T) => string);
  sortValue?: (row: T) => string | number | null | undefined;
  // Percentage of the available desktop width. Unspecified columns share the remainder.
  size?: number;
  // Sort-only columns (e.g. a leaderboard total with no visible desktop column) are hidden
  // from desktop headers but remain sortable and addressable by mobile options.
  hidden?: boolean;
}

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

// One semantic mobile sort action: a user-facing label plus the desktop column + direction it
// drives. Mobile renders only these explicit options — adding sortValue to a desktop column never
// creates a mobile action by itself. Both presentations share the same underlying sort state.
export interface MobileSortOption {
  id: string;
  label: string;
  sort: {
    columnId: string;
    direction: SortDirection;
  };
}

interface DataTableProps<T extends RowData> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onRowIntent?: (key: string) => void;
  isLoading?: boolean;
  emptyLabel: string;
  defaultSort?: { columnId: string; direction?: SortDirection };
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  // Server mode keeps API order while TanStack retains the sortable header state.
  sortMode?: 'client' | 'server';
  // A paged client table does not sort until all pages are ready.
  sortReady?: boolean;
  // Explicit semantic mobile sort actions. When provided, mobile renders only these options
  // (selected = the option matching the current sort state); otherwise no mobile sort bar
  // is shown. Desktop headers keep sorting normally on shared state.
  mobileSortOptions?: MobileSortOption[];
  onEndReached?: () => void;
  virtualize?: boolean;
  // Without a custom card, the TanStack cells become a labelled responsive card automatically.
  renderCard?: (row: T) => ReactNode;
}

const END_REACHED_THRESHOLD_PX = 200;
// TanStack treats a new data reference as a change and schedules a state reset.
// A fresh [] during loading makes that reset trigger another reset indefinitely.
const EMPTY_ROWS: never[] = [];

function sortStateToTanStack(sort: SortState): SortingState {
  return sort.columnId ? [{ id: sort.columnId, desc: sort.direction === 'desc' }] : [];
}

// TanStack owns the column, row and sorting models. Desktop and mobile are two presentations of the
// same model, avoiding a second hand-written list implementation that can drift out of sync.
export function DataTable<T extends RowData>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  onRowIntent,
  isLoading,
  emptyLabel,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  sortMode = 'client',
  sortReady = true,
  mobileSortOptions,
  onEndReached,
  virtualize = false,
  renderCard,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Cell className classes live on our own columns; no need to route them through TanStack meta.
  const classNameById = useMemo(
    () => new Map(columns.map((column) => [column.id ?? column.header, column.className])),
    [columns],
  );
  const cellClassName = (columnId: string, row: T) => {
    const className = classNameById.get(columnId);
    return typeof className === 'function' ? className(row) : (className ?? '');
  };
  const [internalSort, setInternalSort] = useState<SortState>(() => ({
    columnId: defaultSort?.columnId ?? '',
    direction: defaultSort?.direction ?? 'asc',
  }));
  const sort = controlledSort ?? internalSort;
  const sorting = useMemo(() => sortStateToTanStack(sort), [sort]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id ?? column.header, !column.hidden])),
    [columns],
  );
  const visibleColumnCount = columns.filter((column) => !column.hidden).length;

  const tableColumns = useMemo<ColumnDef<typeof dataTableFeatures, T>[]>(
    () =>
      columns
        .filter((column) => !column.hidden)
        .map((column) => ({
          id: column.id ?? column.header,
          header: column.label ?? column.header,
          accessorFn: column.sortValue,
          cell: (context) => column.cell(context.row.original),
          enableSorting: !!column.sortValue,
          sortDescFirst: false,
          sortUndefined: 'last',
        })),
    [columns],
  );
  // Hidden sort-only columns never render a desktop header, but TanStack still needs their
  // accessor so mobile semantic options can sort by them. They are appended after visible ones.
  const hiddenSortColumns = useMemo<ColumnDef<typeof dataTableFeatures, T>[]>(
    () =>
      columns
        .filter((column) => column.hidden && column.sortValue)
        .map((column) => ({
          id: column.id ?? column.header,
          header: column.label ?? column.header,
          accessorFn: column.sortValue,
          cell: () => null,
          enableSorting: true,
          sortDescFirst: false,
          sortUndefined: 'last',
        })),
    [columns],
  );

  const table = useTable({
    features: dataTableFeatures,
    data: rows ?? EMPTY_ROWS,
    columns: [...tableColumns, ...hiddenSortColumns],
    state: { sorting, columnVisibility },
    getRowId: (row) => rowKey(row),
    manualSorting: sortMode === 'server' || !sortReady,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const nextSort: SortState = next[0]
        ? { columnId: next[0].id, direction: next[0].desc ? 'desc' : 'asc' }
        : sort;
      if (onSortChange) onSortChange(nextSort);
      else setInternalSort(nextSort);
    },
  });

  const modelRows = table.getRowModel().rows;

  // Fixed estimate: dynamic measurement reflows the whole scroll region on every
  // row mount (200 trace rows with variable path heights), which blocks the main thread
  // on filter swaps in Firefox. Overflow is clipped by the cell, so rows stay one line.
  // measureElement stays OFF for desktop rows: with ~11k px of variable-height content
  // the measure pass itself is the long task. Lanes force a constant row height so the
  // estimate is exact and only viewport + overscan ever mounts.
  // React Compiler skips the virtualizer (its measure/scroll callbacks resist memoization),
  // which is safe here: memoized children receive plain data, not the returned functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualize ? modelRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? 84 : 40),
    overscan: 8,
    enabled: virtualize,
    getItemKey: (index) => modelRows[index]?.id ?? index,
  });

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!onEndReached) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < END_REACHED_THRESHOLD_PX) onEndReached();
  }

  if (isLoading) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <SkeletonRows />
      </div>
    );
  }

  // Explicit semantic mobile sort: the selected option mirrors the shared sort state; tapping an
  // option drives the same state (and server query mapping) as tapping a desktop header.
  function applyMobileSort(option: MobileSortOption) {
    const nextSort: SortState = {
      columnId: option.sort.columnId,
      direction: option.sort.direction,
    };
    if (onSortChange) onSortChange(nextSort);
    else setInternalSort(nextSort);
  }

  if (isMobile) {
    const virtualItems = virtualizer.getVirtualItems();
    const renderedRows = virtualize
      ? virtualItems.map((item) => ({ row: modelRows[item.index]!, item }))
      : modelRows.map((row) => ({ row, item: null }));

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-bg-base">
        {mobileSortOptions && mobileSortOptions.length > 0 ? (
          <div
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-bg-surface px-3 py-2 font-mono text-size-10 uppercase tracking-wider"
            aria-label={t('common.sort')}
          >
            {mobileSortOptions.map((option) => {
              const selected =
                sort.columnId === option.sort.columnId && sort.direction === option.sort.direction;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => applyMobileSort(option)}
                  aria-pressed={selected}
                  aria-busy={sortMode === 'client' && selected && !sortReady ? true : undefined}
                  className={`flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-sm border px-2 py-1 text-left [overflow-wrap:anywhere] transition-colors ${
                    selected
                      ? 'border-primary-dim bg-primary/10 text-text-normal'
                      : 'border-border text-text-muted hover:border-primary-dim hover:text-text-normal'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={handleScroll}
          data-virtualized={virtualize || undefined}
        >
          {modelRows.length > 0 ? (
            <div
              className={
                virtualize
                  ? 'relative h-(--virtual-total-height)'
                  : 'flex flex-col divide-y divide-border/50'
              }
              style={
                virtualize
                  ? ({
                      '--virtual-total-height': `${virtualizer.getTotalSize()}px`,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {renderedRows.map(({ row, item }) => {
                const isSelected = row.id === selectedKey;
                return (
                  <button
                    key={row.id}
                    ref={item ? virtualizer.measureElement : undefined}
                    data-index={item?.index}
                    type="button"
                    className={`w-full cursor-pointer border-l-2 px-3 py-3 text-left transition-colors ${item ? 'absolute left-0 top-0 translate-y-(--virtual-row-start)' : ''} ${virtualize ? 'border-b border-b-border/50' : ''} ${
                      isSelected
                        ? 'border-l-primary bg-primary/10'
                        : 'border-l-transparent hover:border-l-primary/50 hover:bg-primary/5'
                    }`}
                    style={
                      item
                        ? ({
                            '--virtual-row-start': `${item.start}px`,
                          } as React.CSSProperties)
                        : undefined
                    }
                    onMouseEnter={() => onRowIntent?.(row.id)}
                    onFocus={() => onRowIntent?.(row.id)}
                    onTouchStart={() => onRowIntent?.(row.id)}
                    onClick={() => onSelect(isSelected ? null : row.id)}
                  >
                    {renderCard ? (
                      renderCard(row.original)
                    ) : (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
                        {row.getVisibleCells().map((cell, index) => {
                          const header = table
                            .getFlatHeaders()
                            .find((candidate) => candidate.column.id === cell.column.id);
                          return (
                            <div
                              key={cell.id}
                              className={index === 0 ? 'col-span-2 min-w-0' : 'min-w-0'}
                            >
                              <dt className="mb-0.5 text-size-9 uppercase tracking-wider text-text-dim">
                                {header
                                  ? flexRender(cell.column.columnDef.header, header.getContext())
                                  : cell.column.id}
                              </dt>
                              <dd
                                className={`min-w-0 ${cellClassName(cell.column.id, row.original)}`}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title={emptyLabel} />
          )}
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const topPadding = virtualItems[0]?.start ?? 0;
  const bottomPadding =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0;
  const renderedRows = virtualize
    ? virtualItems.map((item) => ({ row: modelRows[item.index]!, item }))
    : modelRows.map((row) => ({ row, item: null }));

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-x-auto overflow-y-auto"
      onScroll={handleScroll}
      data-virtualized={virtualize || undefined}
    >
      {modelRows.length > 0 ? (
        <table className="h-fit w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-bg-surface">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="h-9 border-b border-border text-size-11 uppercase tracking-wider text-text-muted"
              >
                {headerGroup.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const sourceColumn = columns.find((c) => (c.id ?? c.header) === header.column.id);
                  return (
                    <th
                      key={header.id}
                      className={`whitespace-nowrap px-4 py-2 text-left font-medium ${sourceColumn?.size ? 'w-(--column-width)' : ''}`}
                      style={
                        sourceColumn?.size
                          ? ({ '--column-width': `${sourceColumn.size}%` } as React.CSSProperties)
                          : undefined
                      }
                      aria-sort={
                        direction === 'asc'
                          ? 'ascending'
                          : direction === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex cursor-pointer items-center gap-1 transition-colors hover:text-text-normal"
                          aria-busy={
                            sortMode === 'client' && direction !== false && !sortReady
                              ? true
                              : undefined
                          }
                          aria-label={`${flexRender(header.column.columnDef.header, header.getContext())}${
                            direction === 'asc'
                              ? ` (${t('common.sortedAscending')})`
                              : direction === 'desc'
                                ? ` (${t('common.sortedDescending')})`
                                : ''
                          }`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {/* Only the active sort column shows an arrow; inactive sortable
                              columns show nothing so the sort state reads unambiguously. */}
                          {direction ? (
                            <span className="text-primary" aria-hidden>
                              {direction === 'desc' ? '▼' : '▲'}
                            </span>
                          ) : (
                            <span className="w-[9px] shrink-0" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualize && topPadding > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={visibleColumnCount}
                  className="h-(--virtual-spacer-height) border-0 p-0"
                  style={{ '--virtual-spacer-height': `${topPadding}px` } as React.CSSProperties}
                />
              </tr>
            )}
            {renderedRows.map(({ row, item }) => {
              const isSelected = row.id === selectedKey;
              return (
                <tr
                  key={row.id}
                  data-index={item?.index}
                  className={`h-10 cursor-pointer overflow-hidden border-b border-l-2 border-b-border/50 transition-colors ${
                    isSelected
                      ? 'border-l-primary bg-primary/10'
                      : 'border-l-transparent hover:border-l-primary/50 hover:bg-primary/5'
                  }`}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onMouseEnter={() => onRowIntent?.(row.id)}
                  onFocus={() => onRowIntent?.(row.id)}
                  onTouchStart={() => onRowIntent?.(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(isSelected ? null : row.id);
                    }
                  }}
                  onClick={() => onSelect(isSelected ? null : row.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const cellClass = cellClassName(cell.column.id, row.original);
                    return (
                      <td key={cell.id} className={`px-4 py-2 align-middle ${cellClass}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {virtualize && bottomPadding > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={visibleColumnCount}
                  className="h-(--virtual-spacer-height) border-0 p-0"
                  style={{ '--virtual-spacer-height': `${bottomPadding}px` } as React.CSSProperties}
                />
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <EmptyState title={emptyLabel} />
      )}
    </div>
  );
}
