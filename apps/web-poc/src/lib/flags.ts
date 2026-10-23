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

  lastStreakValue: () => parseInt(Flags.get('lastStreakValue') ?? '0', 10),
  setLastStreakValue: (n: number) => Flags.set('lastStreakValue', String(n)),
};
