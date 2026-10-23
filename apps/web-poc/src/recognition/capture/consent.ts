/** Versão do texto abaixo; vai em cada amostra (campo consent). Mudou o texto, sobe a versão. */
export const CONSENT_VERSION = 'coleta-v1';

export const CONSENT_TITLE = 'Coleta de dados para o reconhecimento de Libras';

export const CONSENT_PARAGRAPHS: string[] = [
  'O Librax está ensinando o computador a reconhecer as letras do alfabeto manual. Para isso, pedimos que você faça algumas letras na frente da câmera.',
  'O que é guardado: só a posição de 21 pontos da sua mão (números), a letra, o código que você escolher, o tipo de aparelho e o navegador. Nenhuma foto ou vídeo é gravado nem enviado.',
  'Onde fica: neste aparelho, até você exportar o arquivo e entregar para a equipe do Librax.',
  'Para que serve: treinar e testar o reconhecimento das letras. Os dados não são vendidos nem usados para identificar você.',
  'É voluntário: você pode parar quando quiser e apagar tudo deste aparelho no botão "Apagar tudo". Depois de entregar o arquivo, peça a exclusão para a equipe informando o seu código.',
];

/** Letras sem movimento do alfabeto manual (H, J, K, X, Z e Ç têm movimento e ficam para o modelo temporal). */
export const CAPTURE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y'];

/** Primeiras letras da fase W1 (plano mobile web). */
export const W1_LETTERS = new Set(['A', 'B', 'C', 'L', 'O', 'U']);

/** Meta de amostras por letra e pessoa (duas gravações de 3 s). */
export const TARGET_PER_LETTER = 60;
