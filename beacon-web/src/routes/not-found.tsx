import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState';

// Rendered for unknown paths (router notFoundComponent). Offers a way back
// instead of a bare "404" with no action.
export function NotFoundView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <EmptyState
        title={t('stats.notFoundTitle')}
        subtitle={t('stats.notFoundSubtitle')}
        action={
          <button
            type="button"
            onClick={() =>
              navigate({
                to: '/packets',
                search: {
                  regions: [],
                  iata: [],
                  types: [],
                  routes: [],
                  obs: [],
                  scope: [],
                },
              })
            }
            className="mt-1 cursor-pointer rounded border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/20"
          >
            {t('stats.notFoundAction')}
          </button>
        }
      />
    </div>
  );
}
