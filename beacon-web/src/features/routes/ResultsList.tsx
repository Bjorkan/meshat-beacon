import { useTranslation } from 'react-i18next';
import type { PlannedRoute } from '../../types/api';
import { RouteCard } from './RouteCard';

export function ResultsList({
  paths,
  active,
  onSelect,
  onOpenNode,
}: {
  paths: PlannedRoute[];
  active: number;
  onSelect: (index: number) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {paths.length > 0 && (
        <p className="rounded border border-border bg-bg-base px-3 py-2 text-xs leading-relaxed text-text-muted">
          {t('routes.rankingHint')}
        </p>
      )}
      {paths.map((route: PlannedRoute, i: number) => (
        <RouteCard
          key={route.nodes.map((n) => n.publicKey).join('-')}
          route={route}
          index={i}
          active={i === active}
          onSelect={() => onSelect(i)}
          onOpenNode={onOpenNode}
        />
      ))}
    </div>
  );
}
