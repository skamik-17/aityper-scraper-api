const marketNames = [
  'Pierwsza drużyna, która zdobędzie gola',
  'Ostatnia drużyna, która zdobędzie gola',
  'Będzie wynik w trakcie meczu',
  'Wynik i suma goli (przedział)',
  '1. Połowa - Pierwsza drużyna, która strzeli gola',
  '2. Połowa - Pierwsza drużyna, która strzeli gola',
  'Suma goli w każdej z połów (przedziały)',
  'Remis przynajmniej w jednej z połów',
  'Mix szans',
  'Połowa z większą liczbą goli',
];

const patterns = [
  [/^pierwsza\s*drużyna.*zdobędzie\s*gola/i, 'First to score'],
  [/^ostatnia\s*drużyna.*zdobędzie\s*gola/i, 'Last to score'],
  [/^będzie\s*wynik\s*w\s*trakcie\s*meczu$/i, 'Score during match'],
  [/^wynik\s*i\s*suma\s*goli\s*\(przedział\)/i, 'Result and goals range'],
  [/^(1|2)\.\s*po[lł]owa\s*-?\s*pierwsza\s*drużyna.*strzeli\s*gola/i, 'Half first to score'],
  [/^suma\s*goli\s*w\s*każdej\s*z\s*po[lł]ow\s*\(przedzia[lł]\)/i, 'Goals each half range'],
  [/^remis\s*przynajmniej\s*w\s*jednej\s*z\s*po[lł]ow/i, 'Draw in one half'],
  [/^mix\s*szans$/i, 'Mix chances'],
  [/^po[lł]owa\s*z\s*wi[ęe]ksz.*liczb.*gol/i, 'Half with more goals'],
];

marketNames.forEach((name) => {
  let matched = false;
  patterns.forEach(([pat, label]) => {
    if (pat.test(name)) {
      console.log(`✓ '${name}' matched [${label}]`);
      matched = true;
    }
  });
  if (!matched) {
    console.log(`✗ '${name}' did NOT match any pattern`);
  }
});
