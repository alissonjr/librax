import type { ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { ROUTES } from '../lib/routes';
import { useT, withLinks } from '../i18n';

export type LegalPath = typeof ROUTES.privacy | typeof ROUTES.terms;

interface LinkProps {
  to: LegalPath;
  className?: string;
  children: ReactNode;
}

/**
 * Link para a Política de Privacidade ou os Termos de Uso. Dentro do roteador navega sem recarregar
 * (o voltar traz de volta à tela de origem); fora dele (tela renderizada sozinha nos testes) é um
 * link comum, que também abre a página porque as rotas existem.
 */
export function LegalLink({ to, className, children }: LinkProps) {
  const inRouter = useInRouterContext();
  return inRouter
    ? <Link to={to} className={className}>{children}</Link>
    : <a href={to} className={className}>{children}</a>;
}

/**
 * Frase de aceite com os dois links ("Ao criar a conta, você concorda com os Termos de Uso e a
 * Política de Privacidade"). Sem registro no servidor: só informa onde estão as regras.
 */
export function LegalConsent({ messageKey, className }: { messageKey: string; className?: string }) {
  const { t } = useT();
  return (
    <p className={className ?? 'legal-consent'}>
      {withLinks(t(messageKey), {
        terms: <LegalLink to={ROUTES.terms}>{t('legal.termsTitle')}</LegalLink>,
        privacy: <LegalLink to={ROUTES.privacy}>{t('legal.privacyTitle')}</LegalLink>,
      })}
    </p>
  );
}
