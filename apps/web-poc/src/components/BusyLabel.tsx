import { Icon } from './Icon';

/** Conteúdo de botão carregando (design system 11.1): spinner no lugar do texto e texto para leitor de tela. */
export function BusyLabel({ text }: { text: string }) {
  return (
    <>
      <Icon name="progress_activity" spin size="20px" />
      <span className="sr-only">{text}</span>
    </>
  );
}
