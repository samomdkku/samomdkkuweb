// ==============================================
// `npm run setup` — the transcription step, removed.
//
// The guide used to ask a contributor to copy a file and retype four values
// into it, and its own troubleshooting section listed the three ways that goes
// wrong: wrong folder, a value wrapped onto two lines, a placeholder left
// behind. Owner, 2026-09-06: *"input each key manually is bug prone"*. Correct
// — so the step is gone, and what replaces it accepts a paste in whatever shape
// it arrived in.
//
// These assert the two things that make that safe to run:
//   1. it understands the messy shapes (each case below is a real one);
//   2. it MERGES — a maintainer running it must not lose production
//      credentials, which is the only way this tool could do real damage.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePaste, mergeEnvFile, productionNames, opensAssignment } from '../../tools/setup-env.mjs';
import { REQUIRED } from '../../tools/env-check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const EXAMPLE = readFileSync(join(ROOT, '.env.local.example'), 'utf8');

const URL = 'https://devprojectref1234.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInBsYXVzaWJsZSI6dHJ1ZX0';

describe('the shapes a pasted credential block actually arrives in', () => {
  const cases = {
    'plain, as sent': `SUPABASE_DEV_URL=${URL}\nSUPABASE_DEV_ANON_KEY=${KEY}`,
    'wrapped in a markdown code fence (chat apps, one-time-secret pages)':
      `\`\`\`\nSUPABASE_DEV_URL=${URL}\nSUPABASE_DEV_ANON_KEY=${KEY}\n\`\`\``,
    'shell-flavoured, with export':
      `export SUPABASE_DEV_URL=${URL}\nexport SUPABASE_DEV_ANON_KEY=${KEY}`,
    'quoted values': `SUPABASE_DEV_URL="${URL}"\nSUPABASE_DEV_ANON_KEY='${KEY}'`,
    'spaces around the =': `SUPABASE_DEV_URL = ${URL}\nSUPABASE_DEV_ANON_KEY = ${KEY}`,
    'Windows line endings': `SUPABASE_DEV_URL=${URL}\r\nSUPABASE_DEV_ANON_KEY=${KEY}\r\n`,
    'a long key wrapped onto a second line by a chat client':
      `SUPABASE_DEV_URL=${URL}\nSUPABASE_DEV_ANON_KEY=${KEY.slice(0, 20)}\n${KEY.slice(20)}`,
    'with a covering note around it':
      `hi! here are the two lines, dont share them\n\nSUPABASE_DEV_URL=${URL}\n`
      + `SUPABASE_DEV_ANON_KEY=${KEY}\n\nlet me know if it works`,
    'with a comment line': `# practice database\nSUPABASE_DEV_URL=${URL}\nSUPABASE_DEV_ANON_KEY=${KEY}`,
  };

  for (const [name, text] of Object.entries(cases)) {
    it(`understands: ${name}`, () => {
      const got = parsePaste(text);
      expect(got.SUPABASE_DEV_URL).toBe(URL);
      expect(got.SUPABASE_DEV_ANON_KEY).toBe(KEY);
    });
  }

  it('the separator rules env:share prints do not get glued onto a key', () => {
    // ⛔ A REAL BUG, found by a test written for env:pull. The continuation rule
    // (for keys a chat client wraps) fired on the `─────` rule that
    // `npm run env:share` draws around its block — so pasting exactly what you
    // were shown produced a key wrong by thirteen invisible characters, and the
    // failure would have surfaced as "the database refused the key (401)".
    const block = `  ─────────────\nSUPABASE_DEV_URL=${URL}\nSUPABASE_DEV_ANON_KEY=${KEY}\n  ─────────────\n  Not by LINE, Discord...`;
    const got = parsePaste(block);
    expect(got.SUPABASE_DEV_ANON_KEY).toBe(KEY);
    expect(got.SUPABASE_DEV_URL).toBe(URL);
  });

  it('still joins a genuinely wrapped key, which is why the rule exists', () => {
    const got = parsePaste(`SUPABASE_DEV_ANON_KEY=${KEY.slice(0, 15)}\n${KEY.slice(15)}`);
    expect(got.SUPABASE_DEV_ANON_KEY).toBe(KEY);
  });

  it('does not continue on Thai, emoji, box drawing or a rule of punctuation', () => {
    for (const junk of ['─────', 'ส่งให้แล้วนะ', '🎉', '***', '---', '===', '...']) {
      const got = parsePaste(`SUPABASE_DEV_URL=${URL}\n${junk}`);
      expect(got.SUPABASE_DEV_URL, `continued onto ${junk}`).toBe(URL);
    }
  });

  it('control: prose with no NAME=value yields nothing', () => {
    // Without this, a parser that returned junk for everything would pass all
    // nine cases above by accident.
    expect(parsePaste('sorry, forgot to attach them! sending in a sec')).toEqual({});
  });

  it('does not glue a following sentence onto a value', () => {
    // The continuation rule exists for wrapped keys. A line containing spaces
    // is prose, and appending it would silently corrupt the value.
    const got = parsePaste(`SUPABASE_DEV_URL=${URL}\nlet me know if it works`);
    expect(got.SUPABASE_DEV_URL).toBe(URL);
  });
});

describe('where the paste ENDS — the half the parser tests could not see', () => {
  // ⛔ FOUND BY RUNNING IT, NOT BY READING IT. Every parsePaste case above
  // passed while the real command was broken, because the bug was in the READ
  // loop: it stopped at the first blank line after any non-empty line, and
  // people send a covering note. "hey, here you go" + blank ended the paste
  // before one credential arrived, and it then blamed the reader for pasting
  // nothing. A guard that exercises only the pure function cannot see this.
  it('a greeting does not end the paste — only an assignment arms the blank line', () => {
    expect(opensAssignment('hey! here you go, dont share these')).toBe(false);
    expect(opensAssignment('ping me if it does not work')).toBe(false);
    expect(opensAssignment('```')).toBe(false);
    expect(opensAssignment(`SUPABASE_DEV_URL=${URL}`)).toBe(true);
    expect(opensAssignment(`export SUPABASE_DEV_URL = ${URL}`)).toBe(true);
  });

  it('does not arm on a sentence that happens to contain an =', () => {
    expect(opensAssignment('use the one = sign version')).toBe(false);
    expect(opensAssignment('= something')).toBe(false);
  });
});

describe('merging into an existing .env.local', () => {
  it('keeps every line it is not setting — including production credentials', () => {
    // ⛔ The failure this prevents: a maintainer runs `npm run setup` to try it
    // and loses the VM sudo password and the production keys.
    const before = [
      '# my notes',
      'VITE_SUPABASE_URL=https://production.supabase.co',
      'SUPABASE_ACCESS_TOKEN=sbp_secret',
      'SAMO_VM_SUDO_PASSWORD=hunter2',
      '',
    ].join('\n');
    const { text } = mergeEnvFile(before, { SUPABASE_DEV_URL: URL });
    for (const line of before.split('\n').filter(Boolean)) {
      expect(text, `merging dropped: ${line.split('=')[0]}`).toContain(line);
    }
    expect(text).toContain(`SUPABASE_DEV_URL=${URL}`);
  });

  it('replaces in place rather than appending a duplicate', () => {
    const { text } = mergeEnvFile('SUPABASE_DEV_URL=old\n', { SUPABASE_DEV_URL: URL });
    const hits = [...text.matchAll(/^SUPABASE_DEV_URL=/gm)];
    expect(hits.length, 'the name appears twice — loadEnvLocal takes the last '
      + 'and a reader takes the first, so the file means two things').toBe(1);
    expect(text).toContain(`SUPABASE_DEV_URL=${URL}`);
    expect(text).not.toContain('SUPABASE_DEV_URL=old');
  });

  it('writes a usable file from nothing at all', () => {
    const values = Object.fromEntries(REQUIRED.map((n) => [n, 'x']));
    const { text, added } = mergeEnvFile('', values);
    expect(added.sort()).toEqual([...REQUIRED].sort());
    for (const n of REQUIRED) expect(text).toMatch(new RegExp(`^${n}=x$`, 'm'));
  });
});

describe('a paste containing production credentials is refused', () => {
  it('knows the production names, read from the example not retyped here', () => {
    const names = productionNames(EXAMPLE);
    expect(names, 'the sweep of the example\'s "Maintainers only" block found nothing')
      .toContain('SUPABASE_ACCESS_TOKEN');
    expect(names).toContain('SAMO_VM_SUDO_PASSWORD');
    // Control: the names a contributor is SUPPOSED to receive must not be here,
    // or setup would refuse every correct paste.
    for (const n of REQUIRED) expect(names).not.toContain(n);
  });
});
