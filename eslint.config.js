import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Lint for the faults that BREAK A PAGE, not for style.
 *
 * WHY THIS EXISTS
 * On 10 September an effect was added to OpdModule beside the other filter
 * state — fifty lines above the `const [doctors]` it depended on. A dependency
 * array is evaluated DURING render, so every visit threw
 *
 *     ReferenceError: Cannot access 'doctors' before initialization
 *
 * and the page went to the error boundary, for every role, until it was noticed.
 * `npm run build` passed it: a temporal dead zone is a runtime fault and a
 * bundler has nothing to say about it. There was no lint config in the repo, so
 * nothing else looked either.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * Style rules. A lint run that reports three hundred opinions about quotes is a
 * lint run nobody reads, and the next real error hides in the noise. Every rule
 * below is one whose violation means the code is WRONG, not untidy.
 *
 * Run: npm run lint
 */

// Errors that throw, silently drop code, or mean the author wrote something
// other than what they meant. Shared by both halves of the repo.
const runtimeFaults = {
  'no-undef': 'error',              // a typo'd identifier throws on the line it runs
  'no-const-assign': 'error',       // assigning to a const throws
  'no-dupe-keys': 'error',          // the second key silently wins
  'no-dupe-args': 'error',
  'no-unreachable': 'error',        // code that cannot run is a mistake about control flow
  'no-cond-assign': ['error', 'always'], // `if (x = 1)` is a typo'd `===`
  'no-self-assign': 'error',
  'no-unsafe-negation': 'error',
  'valid-typeof': 'error',          // typeof x === 'strng' is always false

  // The rule that would have caught the crash above.
  //
  // WARN, not error, and the reason matters. It flags two different shapes and
  // cannot tell them apart:
  //
  //   used in a dependency array   → evaluated during render → THROWS
  //   used inside a function body  → runs after render       → fine
  //
  // Today the repo has 29 of the second kind and none of the first (checked one
  // by one): module-level `const styles` read inside a component below it,
  // helpers called from an effect body, backend handlers dispatched by name.
  // All safe. Making this an error would paint the run red on day one, which is
  // how a lint gets ignored — so it warns, and a NEW one shows up in a list
  // short enough to read.
  'no-use-before-define': ['warn', {
    functions: false,
    classes: true,
    variables: true,
    allowNamedExports: true,
  }],
}

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'backend/node_modules/**',
      'public/**',
      '**/*.min.js',
    ],
  },

  // ── The browser app ──────────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...runtimeFaults,

      // Calling a hook conditionally, or from something that is not a
      // component, corrupts React's hook order — a real fault, not a style.
      'react-hooks/rules-of-hooks': 'error',

      // exhaustive-deps stays OFF. It is frequently wrong about intent here
      // (effects that deliberately run once, refs held across renders), and the
      // codebase already carries disable comments for it. Left off rather than
      // suppressed line by line.
      'react-hooks/exhaustive-deps': 'off',
    },
  },

  // ── The API ──────────────────────────────────────────────────────────────
  {
    files: ['backend/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: runtimeFaults,
  },
]
