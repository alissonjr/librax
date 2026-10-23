import { useT } from '../i18n';
import { Icon, type IconName } from './Icon';
import { Wordmark } from './Brand';

export type NavSection = 'aprender' | 'praticar' | 'social' | 'perfil';

interface NavItem {
  id: NavSection;
  labelKey: string;
  icon: IconName;
}

// Ícones da seção 8 da proposta: school / sign_language / group / person
const ITEMS: NavItem[] = [
  { id: 'aprender', labelKey: 'nav.learn',    icon: 'school'        },
  { id: 'praticar', labelKey: 'nav.practice', icon: 'sign_language' },
  { id: 'social',   labelKey: 'nav.social',   icon: 'group'         },
  { id: 'perfil',   labelKey: 'nav.profile',  icon: 'person'        },
];

interface NavProps {
  active: NavSection;
  onNavigate: (section: NavSection) => void;
}

export function Nav({ active, onNavigate }: NavProps) {
  const { t } = useT();
  return (
    <nav className="nav-sidebar" aria-label={t('nav.ariaLabel')}>
      <div className="nav-logo">
        <Wordmark size={24} />
      </div>
      {ITEMS.map(item => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            className={`nav-item${isActive ? ' nav-item--active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? 'page' : undefined}
          >
            {/* Aba ativa: ícone preenchido sobre a pílula; inativa: contorno */}
            <span className="nav-item-indicator">
              <Icon name={item.icon} filled={isActive} size="24px" className="nav-item-icon" />
            </span>
            <span className="nav-item-label">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
