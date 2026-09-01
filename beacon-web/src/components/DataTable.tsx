import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";
import { SkeletonRows } from "./SkeletonRows";
import { useIsMobile } from "../hooks/useMediaQuery";

export interface Column<T> {
  header: string;
  label?: string;
  cell: (row: T) => ReactNode;
  className?: string | ((row: T) => string);
  sortValue?: (row: T) => string | number | null | undefined;
  // Percentage of the available desktop width. Unspecified columns share the remainder.
  size?: number;
}

export type SortDirection = "asc" | "desc";
export interface SortState {
  header: string;
  direction: SortDirection;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onRowIntent?: (key: string) => void;
  isLoading?: boolean;
  emptyLabel: string;
  defaultSort?: { header: string; direction?: SortDirection };
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  // Server mode keeps API order while TanStack retains the sortable header state.
  sortMode?: "client" | "server";
  // A paged client table does not sort until all pages are ready.
  sortReady?: boolean;
  onEndReached?: () => void;
  virtualize?: boolean;
  // Without a custom card, the TanStack cells become a labelled responsive card automatically.
  renderCard?: (row: T) => ReactNode;
}

const END_REACHED_THRESHOLD_PX = 200;

function sortStateToTanStack(sort: SortState): SortingState {
  return sort.header ? [{ id: sort.header, desc: sort.direction === "desc" }] : [];
}

// TanStack owns the column, row and sorting models. Desktop and mobile are two presentations of the
// same model, avoiding a second hand-written list implementation that can drift out of sync.
export function DataTable<T>({
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
  sortMode = "client",
  sortReady = true,
  onEndReached,
  virtualize = false,
  renderCard,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [internalSort, setInternalSort] = useState<SortState>(() => ({
    header: defaultSort?.header ?? "",
    direction: defaultSort?.direction ?? "asc",
  }));
  const sort = controlledSort ?? internalSort;
  const sorting = useMemo(() => sortStateToTanStack(sort), [sort]);

  const tableColumns = useMemo<ColumnDef<T>[]>(
    () => columns.map((column) => ({
      id: column.header,
      header: column.label ?? column.header,
      accessorFn: column.sortValue,
      cell: (context) => column.cell(context.row.original),
      enableSorting: !!column.sortValue,
      sortDescFirst: false,
      sortUndefined: "last",
      meta: { className: column.className },
    })),
    [columns],
  );

  // React Compiler deliberately skips components using TanStack Table's imperative API.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows ?? [],
    columns: tableColumns,
    state: { sorting },
    getRowId: (row) => rowKey(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: sortMode === "server" || !sortReady,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const nextSort: SortState = next[0]
        ? { header: next[0].id, direction: next[0].desc ? "desc" : "asc" }
        : sort;
      if (onSortChange) onSortChange(nextSort);
      else setInternalSort(nextSort);
    },
  });

  const modelRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: virtualize ? modelRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? 84 : 42),
    overscan: 8,
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

  const sortableHeaders = table.getFlatHeaders().filter((header) => header.column.getCanSort());

  if (isMobile) {
    const virtualItems = virtualizer.getVirtualItems();
    const renderedRows = virtualize
      ? virtualItems.map((item) => ({ row: modelRows[item.index]!, item }))
      : modelRows.map((row) => ({ row, item: null }));

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-bg-base">
        {sortableHeaders.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-wider" aria-label={t("common.sort")}>
            {sortableHeaders.map((header) => {
              const direction = header.column.getIsSorted();
              return (
                <button
                  key={header.id}
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  aria-busy={sortMode === "client" && direction !== false && !sortReady ? true : undefined}
                  className={`flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 transition-colors ${
                    direction
                      ? "border-primary-dim bg-primary/10 text-text-normal"
                      : "border-border text-text-muted hover:border-primary-dim hover:text-text-normal"
                  }`}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  <span aria-hidden className={direction ? "text-primary" : "text-text-dim/50"}>
                    {direction === "desc" ? "▼" : "▲"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={handleScroll} data-virtualized={virtualize || undefined}>
          {modelRows.length > 0 ? (
            <div
              className={virtualize ? "relative" : "flex flex-col divide-y divide-border/50"}
              style={virtualize ? { height: virtualizer.getTotalSize() } : undefined}
            >
              {renderedRows.map(({ row, item }) => {
                const isSelected = row.id === selectedKey;
                return (
                  <button
                    key={row.id}
                    ref={item ? virtualizer.measureElement : undefined}
                    data-index={item?.index}
                    type="button"
                    className={`w-full cursor-pointer border-l-2 px-3 py-3 text-left transition-colors ${virtualize ? "border-b border-b-border/50" : ""} ${
                      isSelected
                        ? "border-l-primary bg-primary/10"
                        : "border-l-transparent hover:border-l-primary/50 hover:bg-primary/5"
                    }`}
                    style={item ? { position: "absolute", top: 0, left: 0, transform: `translateY(${item.start}px)` } : undefined}
                    onMouseEnter={() => onRowIntent?.(row.id)}
                    onFocus={() => onRowIntent?.(row.id)}
                    onTouchStart={() => onRowIntent?.(row.id)}
                    onClick={() => onSelect(isSelected ? null : row.id)}
                  >
                    {renderCard ? renderCard(row.original) : (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
                        {row.getVisibleCells().map((cell, index) => {
                          const header = table.getFlatHeaders().find((candidate) => candidate.column.id === cell.column.id);
                          return (
                            <div key={cell.id} className={index === 0 ? "col-span-2 min-w-0" : "min-w-0"}>
                              <dt className="mb-0.5 text-[9px] uppercase tracking-wider text-text-dim">
                                {header ? flexRender(cell.column.columnDef.header, header.getContext()) : cell.column.id}
                              </dt>
                              <dd className={`min-w-0 ${typeof cell.column.columnDef.meta?.className === "function"
                                ? cell.column.columnDef.meta.className(row.original)
                                : (cell.column.columnDef.meta?.className ?? "")}`}>
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
  const bottomPadding = virtualItems.length > 0
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
    : 0;
  const renderedRows = virtualize
    ? virtualItems.map((item) => ({ row: modelRows[item.index]!, item }))
    : modelRows.map((row) => ({ row, item: null }));

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-auto" onScroll={handleScroll} data-virtualized={virtualize || undefined}>
      {modelRows.length > 0 ? (
        <table className="h-fit w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-bg-surface">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="h-9 border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                {headerGroup.headers.map((header, index) => {
                  const direction = header.column.getIsSorted();
                  const sourceColumn = columns[index];
                  return (
                    <th
                      key={header.id}
                      className="whitespace-nowrap px-4 py-2 text-left font-medium"
                      style={sourceColumn?.size ? { width: `${sourceColumn.size}%` } : undefined}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex cursor-pointer items-center gap-1 transition-colors hover:text-text-normal"
                          aria-busy={sortMode === "client" && direction !== false && !sortReady ? true : undefined}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span className={direction ? "text-primary" : "text-text-dim/40"} aria-hidden>
                            {direction === "desc" ? "▼" : "▲"}
                          </span>
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
              <tr aria-hidden><td colSpan={columns.length} style={{ height: topPadding, padding: 0, border: 0 }} /></tr>
            )}
            {renderedRows.map(({ row, item }) => {
              const isSelected = row.id === selectedKey;
              return (
                <tr
                  key={row.id}
                  ref={item ? virtualizer.measureElement : undefined}
                  data-index={item?.index}
                  className={`h-10 cursor-pointer border-b border-l-2 border-b-border/50 transition-colors ${
                    isSelected
                      ? "border-l-primary bg-primary/10"
                      : "border-l-transparent hover:border-l-primary/50 hover:bg-primary/5"
                  }`}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onMouseEnter={() => onRowIntent?.(row.id)}
                  onFocus={() => onRowIntent?.(row.id)}
                  onTouchStart={() => onRowIntent?.(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(isSelected ? null : row.id);
                    }
                  }}
                  onClick={() => onSelect(isSelected ? null : row.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const metaClass = cell.column.columnDef.meta?.className;
                    const cellClass = typeof metaClass === "function" ? metaClass(row.original) : (metaClass ?? "");
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
              <tr aria-hidden><td colSpan={columns.length} style={{ height: bottomPadding, padding: 0, border: 0 }} /></tr>
            )}
          </tbody>
        </table>
      ) : (
        <EmptyState title={emptyLabel} />
      )}
    </div>
  );
}

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    className?: string | ((row: TData) => string);
  }
}
