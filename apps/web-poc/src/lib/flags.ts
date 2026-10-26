const PREFIX = 'librax_';

export const Flags = {
  get: (key: string): string | null => localStorage.getItem(PREFIX + key),
  set: (key: string, value: string = '1') => localStorage.setItem(PREFIX + key, value),
  has: (key: string): boolean => localStorage.getItem(PREFIX + key) !== null,

  firstCameraSuccess:   () => Flags.has('firstCameraSuccess'),
  setFirstCameraSuccess: () => Flags.set('firstCameraSuccess'),

  firstCameraExercise:   () => Flags.has('firstCameraExercise'),
  setFirstCameraExercise: () => Flags.set('firstCameraExercise'),

  dynamicIntroSeen:   () => Flags.has('dynamicIntroSeen'),
  setDynamicIntroSeen: () => Flags.set('dynamicIntroSeen'),

  nameFingerspellDone:   () => Flags.has('nameFingerspellDone'),
  setNameFingerspellDone: () => Flags.set('nameFingerspellDone'),

  streakBrokenShownDate: () => Flags.get('streakBrokenShownDate'),
  setStreakBrokenShownDate: (date: string) => Flags.set('streakBrokenShownDate', date),

  courseA1Completed:   () => Flags.has('courseA1Completed'),
  setCourseA1Completed: () => Flags.set('courseA1Completed'),

  // Regra antiga do convite de instalar (uma vez só). Hoje o estado fica em installInvite e
  // installBanner (lib/install.ts); a flag antiga só é lida, para contar como um convite já visto.
  installSuggested:   () => Flags.has('installSuggested'),

  // "Continuar sem conta" no convite do fim da lição (spec-02 12.2): dia em que foi dispensado
  accountOfferDismissedDate: () => Flags.get('accountOfferDismissedDate'),
  setAccountOfferDismissedDate: (date: string) => Flags.set('accountOfferDismissedDate', date),

  lastStreakValue:() => parseInt(Flags.get('lastStreakValue') ?? '0', 10),
  setLastStreakValue: (n: number) => Flags.set('lastStreakValue', String(n)),
};
