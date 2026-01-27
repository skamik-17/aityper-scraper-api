import { extractMultipleOverUnderLines } from './src/services/normalization/helpers/index.js';

const selections = [
  'Arsenal & Powyżej 1,5',
  'Arsenal & Poniżej 1,5',
  'Remis & Powyżej 1,5',
  'Remis & Poniżej 1,5',
  'Manchester United & Powyżej 1,5',
  'Manchester United & Poniżej 1,5',
  'Arsenal & Powyżej 2,5',
  'Arsenal & Poniżej 2,5',
  'Remis & Powyżej 2,5',
  'Remis & Poniżej 2,5',
  'Manchester United & Powyżej 2,5',
  'Manchester United & Poniżej 2,5',
  'Arsenal & Powyżej 3,5',
  'Arsenal & Poniżej 3,5',
  'Remis & Powyżej 3,5',
  'Remis & Poniżej 3,5',
  'Manchester United & Powyżej 3,5',
  'Manchester United & Poniżej 3,5',
  'Arsenal & Powyżej 4,5',
  'Arsenal & Poniżej 4,5',
  'Remis & Powyżej 4,5',
  'Remis & Poniżej 4,5',
  'Manchester United & Powyżej 4,5',
  'Manchester United & Poniżej 4,5',
];

const params = extractMultipleOverUnderLines(selections);
console.log('Parameters:', params);
